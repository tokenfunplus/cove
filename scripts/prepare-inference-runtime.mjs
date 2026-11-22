import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, readdir, copyFile, symlink, readlink, rm, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const version = "b12606";
const digest = "8d277d8a1289202e0553cf6489801303624973807ae6d07c666a61ea70a0e1c4";
if (process.platform !== "darwin" || process.arch !== "arm64") { console.log("Skipping the optional Apple Silicon inference runtime on this build host."); process.exit(0); }
const directory = path.join(root, ".artifacts/inference");
const archive = path.join(directory, `llama-${version}-macos-arm64.tar.gz`);
await mkdir(directory, { recursive: true });
function run(command, args) { const result = spawnSync(command, args, { stdio: "inherit" }); if (result.status !== 0) throw new Error(`${command} failed`); }
let bytes;
try { bytes = await readFile(archive); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (!bytes || createHash("sha256").update(bytes).digest("hex") !== digest) {
  const partial = archive + ".partial";
  run("curl", ["--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "300", "--output", partial, `https://github.com/ggml-org/llama.cpp/releases/download/${version}/llama-${version}-bin-macos-arm64.tar.gz`]);
  bytes = await readFile(partial);
  if (createHash("sha256").update(bytes).digest("hex") !== digest) { await rm(partial); throw new Error("Inference runtime SHA-256 mismatch"); }
  await copyFile(partial, archive); await rm(partial);
}
run("tar", ["-xzf", archive, "-C", directory]);
const extracted = path.join(directory, `llama-${version}`);
for (const entry of await readdir(extracted, { withFileTypes: true })) {
  if (entry.name !== "llama-server" && entry.name !== "LICENSE" && !entry.name.endsWith(".dylib")) continue;
  const from = path.join(extracted, entry.name); const to = path.join(directory, entry.name);
  await rm(to, { force: true });
  if (entry.isSymbolicLink()) await symlink(await readlink(from), to); else await copyFile(from, to);
}
await chmod(path.join(directory, "llama-server"), 0o755);
console.log(`Prepared llama.cpp ${version} for Apple Silicon (macOS 13.3+).`);
