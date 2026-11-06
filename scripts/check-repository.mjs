import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules", ".build", ".swiftpm", ".artifacts", ".scratch", "dist", "coverage", ".idea", ".vscode"]);
const errors = [];

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isDirectory()) {
      await inspect(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\p{Script=Han}/u.test(relative)) errors.push(`${relative}: use English filenames`);
    if (entry.name === ".DS_Store") {
      errors.push(`${relative}: remove machine-specific metadata`);
      continue;
    }
    const bytes = await readFile(absolute);
    if (bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    if (/\p{Script=Han}/u.test(content)) errors.push(`${relative}: project text must use English`);
    if (/\/Users\/[\w.-]+\//.test(content)) errors.push(`${relative}: replace machine-specific paths`);
    if (entry.name.endsWith(".md")) {
      for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
        const target = match[1];
        if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("#")) continue;
        try {
          await access(path.resolve(directory, decodeURIComponent(target.split("#")[0])));
        } catch {
          errors.push(`${relative}: missing local link target ${target}`);
        }
      }
    }
  }
}

await inspect(root);
const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const plist = await readFile(path.join(root, "apps/macos/Resources/Info.plist"), "utf8");
const release = plist.match(/<key>CoveReleaseVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
if (metadata.version !== release) errors.push("Root package and macOS release versions must match");
for (const workspace of ["apps/web", "packages/api-contract"]) {
  const pkg = JSON.parse(await readFile(path.join(root, workspace, "package.json"), "utf8"));
  if (pkg.version !== metadata.version) errors.push(`${workspace}: version must match root package`);
  if (pkg.license !== "MIT") errors.push(`${workspace}: expected MIT license metadata`);
}
for (const entry of await readdir(path.join(root, "scripts"))) {
  if (entry.endsWith(".mjs")) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, "scripts", entry)], { encoding: "utf8" });
    if (result.error || result.status !== 0) errors.push(`${entry}: ${result.error?.message ?? result.stderr}`);
    continue;
  }
  if (!entry.endsWith(".sh") && entry !== "go") continue;
  const result = spawnSync("sh", ["-n", path.join(root, "scripts", entry)], { encoding: "utf8" });
  if (result.error || result.status !== 0) errors.push(`${entry}: ${result.error?.message ?? result.stderr}`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Repository text, links, release metadata, and script syntax checks passed.");
}
