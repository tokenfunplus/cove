import { readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output) throw new Error("Expected --output PATH");

function command(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout.trim();
}

async function notices(directory) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice)([._-]|$)/i.test(entry.name))
    .map((entry) => entry.name).sort();
  const texts = await Promise.all(files.map(async (file) => `${file}\n\n${await readFile(path.join(directory, file), "utf8")}`));
  return texts.length ? texts.join("\n\n") : "No standalone license text was included in this package; consult its upstream distribution.";
}

const sections = ["Cove third-party dependency notices", "This file includes installed production dependency license texts. Each component retains its own license."];
const packages = Object.values(JSON.parse(command("pnpm", ["licenses", "list", "--prod", "--json"]))).flat();
for (const pkg of packages.sort((a, b) => a.name.localeCompare(b.name))) {
  for (const directory of pkg.paths) {
    const metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    sections.push(`${metadata.name}@${metadata.version}\nLicense: ${pkg.license}\n${pkg.homepage ?? ""}\n\n${await notices(directory)}`);
  }
}

if (process.argv.includes("--include-go")) {
  const go = path.join(root, "scripts/go");
  const modules = command(go, ["list", "-deps", "-f", "{{with .Module}}{{if not .Main}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}{{end}}", "./cmd/cove-local-service"], path.join(root, "services/local-service"));
  for (const line of [...new Set(modules.split("\n").filter(Boolean))].sort()) {
    const [name, version, directory] = line.split("|");
    if (!directory) throw new Error(`Go module not downloaded: ${name}; run go mod download`);
    sections.push(`${name}@${version}\n\n${await notices(directory)}`);
  }
  const goRoot = command(go, ["env", "GOROOT"]);
  // Homebrew keeps LICENSE next to libexec rather than inside GOROOT.
  let goLicense;
  for (const directory of [goRoot, path.dirname(goRoot)]) {
    try { goLicense = await readFile(path.join(directory, "LICENSE"), "utf8"); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!goLicense) throw new Error("Go standard library license was not found");
  sections.push(`Go standard library\n\n${goLicense}`);
}

await writeFile(output, `${sections.join(`\n\n${"=".repeat(72)}\n\n`)}\n`);
console.log(`Collected third-party notices in ${path.relative(root, path.resolve(output))}`);
