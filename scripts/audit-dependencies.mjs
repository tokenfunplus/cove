import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const patchedAdvisory = "GHSA-fc5q-39xc-vjpf";
export const patchedAdvisoryUpdated = "2026-11-17T15:56:44.000Z";
export const patchedLockSha256 = "3fca93101d3a6e300187a044dadba14fe94963c3ab33704f713e429922fe6434";
export const patchedPackages = {
  picomatch: { version: "4.0.7", files: {
    "lib/parse.js": "b75bd0fa8314f1243488fb1344bf3e9971c198c7282a064b112eeeedda1b2324",
  } },
  rollup: { version: "4.63.1", files: {
    "dist/es/shared/node-entry.js": "d1b5b9c9759959f366fd93a97869252234f6ace4d55a46da746cf550f61101b8",
    "dist/es/shared/watch.js": "963f5c8b2668095d32fa046efa9e39fc89ee4fb9ab38ab3785e6c643fb4aa0a0",
    "dist/shared/index.js": "45a0f441b698ba693a8a53d0de777f7d72f23dc0d4f0a8341cd7d05a6ed0f7cc",
    "dist/shared/rollup.js": "82641aba64c96f586477c1321e777f71e97949df2b5f6300af8edc52ff6e58f7",
  } },
};
const verifiedPatch = Symbol("verified dependency inventory");
const levels = ["info", "low", "moderate", "high", "critical"];

// Follow installed consumer edges, not unused packages left in pnpm's cache.
export function findPatchedPackages(directory = root) {
  const pending = [{ manifest: path.join(directory, "package.json"), workspace: true }];
  for (const folder of ["apps", "packages"]) {
    const parent = path.join(directory, folder);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const manifest = path.join(parent, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(manifest)) pending.push({ manifest, workspace: true });
    }
  }
  const seen = new Set();
  const copies = [];
  while (pending.length) {
    const { manifest: candidate, workspace, expectedName } = pending.pop();
    const manifest = realpathSync(candidate);
    const metadata = JSON.parse(readFileSync(manifest, "utf8"));
    if (expectedName && metadata.name !== expectedName) throw new Error("A patched dependency has unexpected package metadata");
    if (seen.has(manifest)) continue;
    seen.add(manifest);
    if (Object.hasOwn(patchedPackages, metadata.name)) copies.push({ name: metadata.name, directory: path.dirname(manifest) });
    const dependencies = {
      ...metadata.dependencies, ...metadata.optionalDependencies,
      ...metadata.peerDependencies, ...(workspace ? metadata.devDependencies : {}),
    };
    const require = createRequire(manifest);
    for (const [name, specification] of Object.entries(dependencies)) {
      const expectedName = Object.keys(patchedPackages).find(candidate => name === candidate || (typeof specification === "string" && specification.startsWith(`npm:${candidate}@`)));
      const resolved = require.resolve.paths(name)?.map(base => path.join(base, name, "package.json"))
        .find(file => existsSync(file));
      if (resolved) pending.push({ manifest: resolved, workspace: false, expectedName });
      else if (expectedName) throw new Error("A patched dependency is missing; install the frozen lockfile first");
    }
  }
  return copies;
}

export function verifyDependencyPatches(directory = root) {
  const lock = readFileSync(path.join(directory, "pnpm-lock.yaml"), "utf8");
  if (createHash("sha256").update(lock).digest("hex") !== patchedLockSha256) {
    throw new Error("The dependency inventory changed; review bundled copies, patches and advisory handling before updating its checksum");
  }
  const copies = findPatchedPackages(directory);
  if (Object.keys(patchedPackages).some(name => !copies.some(copy => copy.name === name))) throw new Error("The patched dependency inventory is incomplete");
  for (const copy of copies) {
    const expected = patchedPackages[copy.name];
    const metadata = JSON.parse(readFileSync(path.join(copy.directory, "package.json"), "utf8"));
    if (metadata.version !== expected.version) throw new Error("An installed patched dependency has an unexpected version");
    for (const [file, checksum] of Object.entries(expected.files)) {
      const digest = createHash("sha256").update(readFileSync(path.join(copy.directory, file))).digest("hex");
      if (digest !== checksum) throw new Error("An installed parser is unpatched or unexpected; refusing the advisory exception");
    }
  }
  return Object.freeze({ copies, [verifiedPatch]: true });
}

// The registry knows release versions, not local patch contents. This exception
// is considered only after every reachable copy passes the integrity check.
export function reviewAuditReport(report, verification) {
  if (!report || report.error || !report.advisories || Array.isArray(report.advisories) || typeof report.advisories !== "object") {
    throw new Error("The registry did not return a complete audit report");
  }
  if (report.muted && Object.keys(report.muted).length) throw new Error("Audit findings were muted before patch verification");
  const advisories = Object.values(report.advisories);
  const counts = Object.fromEntries(levels.map(level => [level, 0]));
  for (const advisory of advisories) {
    if (!advisory || !levels.includes(advisory.severity) || typeof advisory.module_name !== "string" || typeof advisory.url !== "string") {
      throw new Error("The registry returned an unsupported advisory");
    }
    counts[advisory.severity] += 1;
  }
  if (levels.some(level => report.metadata?.vulnerabilities?.[level] !== counts[level])) {
    throw new Error("The audit summary does not match its advisory records");
  }
  const patched = [], remaining = [];
  for (const advisory of advisories) {
    if (verification?.[verifiedPatch] && advisory.module_name === "picomatch" && advisory.url === `https://github.com/advisories/${patchedAdvisory}` &&
      advisory.github_advisory_id === patchedAdvisory && advisory.updated === patchedAdvisoryUpdated &&
      advisory.vulnerable_versions === "<=4.0.7" && advisory.patched_versions === "<0.0.0" &&
      advisory.cves?.includes("CVE-2026-112366") && advisory.findings?.length &&
      advisory.findings.every(finding => finding.version === "4.0.7")) patched.push(advisory);
    else remaining.push(advisory);
  }
  return { patched, remaining, blocking: remaining.filter(advisory => levels.indexOf(advisory.severity) >= levels.indexOf("moderate")) };
}

export function auditDependencies(directory = root) {
  const verification = verifyDependencyPatches(directory);
  const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["audit", "--json"], {
    cwd: directory, encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error("The dependency registry audit failed");
  let source;
  try { source = JSON.parse(result.stdout); }
  catch { throw new Error("The dependency registry returned invalid audit JSON"); }
  const report = reviewAuditReport(source, verification);
  console.log(`Verified picomatch and bundled Rollup parser patches in ${verification.copies.length} installed package(s).`);
  for (const advisory of report.patched) console.log(`Locally patched: ${patchedAdvisory} (${advisory.module_name}).`);
  for (const advisory of report.remaining) console.log(`${advisory.severity}: ${advisory.module_name} — ${advisory.url}`);
  console.log(`${report.blocking.length} unpatched moderate-or-higher advisories.`);
  return report.blocking.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = auditDependencies(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
