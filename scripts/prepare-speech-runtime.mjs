import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.log("Skipping the optional Apple Silicon speech runtime on this build host.");
  process.exit(0);
}
const destination = path.join(root, ".artifacts/speech");
await mkdir(destination, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed while preparing speech runtime`);
}
async function verifiedFile(filename, url, digest, seed) {
  const target = path.join(destination, filename);
  for (const source of [target, path.join(root, ".artifacts/speech-research", seed ?? filename)]) {
    try {
      const bytes = await readFile(source);
      if (createHash("sha256").update(bytes).digest("hex") === digest) {
        if (source !== target) await copyFile(source, target);
        return target;
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const partial = target + ".partial";
  run("curl", ["--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "300", "--output", partial, url]);
  const bytes = await readFile(partial);
  if (createHash("sha256").update(bytes).digest("hex") !== digest) {
    await rm(partial); throw new Error("Speech runtime SHA-256 mismatch");
  }
  await copyFile(partial, target); await rm(partial);
  return target;
}
const sherpa = await verifiedFile("sherpa-onnx-v1.12.40-osx-arm64-shared-lib.tar.bz2", "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.40/sherpa-onnx-v1.12.40-osx-arm64-shared-lib.tar.bz2", "9e2cc320490fc30b4dd9e07045d578bb537989a070bbc5f2c47b4a3b8b03d277");
run("tar", ["-xjf", sherpa, "-C", destination]);
const lib = path.join(destination, "sherpa-onnx-v1.12.40-osx-arm64-shared-lib/lib");
for (const name of await readdir(lib)) {
  if (name.startsWith("libonnxruntime") || name === "libsherpa-onnx-c-api.dylib") await copyFile(path.join(lib, name), path.join(destination, name));
}
await verifiedFile("c-api.h", "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v1.12.40/sherpa-onnx/c-api/c-api.h", "437b1279047877167d8fadc74a60d47f3df514d703fdac1c1b6851da9bc2fdb4", "stable-c-api.h");
run("xcrun", ["clang++", "-std=c++17", "-O2", "-arch", "arm64", "-mmacosx-version-min=13.3", "-I", destination, "-L", destination, "-Wl,-rpath,@executable_path", "-lsherpa-onnx-c-api", path.join(root, "scripts/native/speech-worker.cpp"), "-o", path.join(destination, "cove-speech-worker")]);
const pocket = await verifiedFile("pocket-tts-3.3.0-aarch64-apple-darwin.tar.gz", "https://github.com/kyutai-labs/pocket-tts/releases/download/v4.0.1/pocket-tts-3.3.0-aarch64-apple-darwin.tar.gz", "ee9ca6c7c000ee72c5846e3a8ba01d08f56636d94a614d2259c3f12b8fd69afa");
const pocketDirectory = path.join(destination, "pocket-extracted");
await mkdir(pocketDirectory, { recursive: true });
run("tar", ["-xzf", pocket, "-C", pocketDirectory]);
async function findPocket(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === "pocket-tts") return file;
    if (entry.isDirectory()) { const found = await findPocket(file); if (found) return found; }
  }
}
const executable = await findPocket(pocketDirectory);
if (!executable) throw new Error("Pocket speech executable is missing");
await copyFile(executable, path.join(destination, "pocket-tts"));
await chmod(path.join(destination, "pocket-tts"), 0o755);
// Kitten 0.8 uses the newer voice layout and accepts precomputed IPA phonemes.
const kittenDirectory = path.join(destination, "kitten");
await mkdir(kittenDirectory, { recursive: true });
const kitten = await verifiedFile("sherpa-onnx-v2.0.3-osx-arm64-shared-lib.tar.bz2", "https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.3/sherpa-onnx-v2.0.3-osx-arm64-shared-lib.tar.bz2", "632ea83f617d9995f01a889cc61f19579e64b0964f67e84a3526a94a049d0c70", "sherpa-runtime.tar.bz2");
run("tar", ["-xjf", kitten, "-C", kittenDirectory]);
const kittenLib = path.join(kittenDirectory, "sherpa-onnx-v2.0.3-osx-arm64-shared-lib/lib");
for (const name of await readdir(kittenLib)) {
  if (name.startsWith("libonnxruntime") || name === "libsherpa-onnx-c-api.dylib") await copyFile(path.join(kittenLib, name), path.join(kittenDirectory, name));
}
// ONNX Runtime's C API is backward compatible. Share the pinned 1.28.2
// build (macOS 11+) instead of the older bundle's macOS 15.5-only library.
await copyFile(path.join(kittenDirectory, "libonnxruntime.dylib"), path.join(destination, "libonnxruntime.dylib"));
await rm(path.join(destination, "libonnxruntime.1.24.4.dylib"), {force:true});
run("install_name_tool", ["-change", "@rpath/libonnxruntime.1.24.4.dylib", "@rpath/libonnxruntime.dylib", path.join(destination, "libsherpa-onnx-c-api.dylib")]);
run("codesign", ["--force", "--sign", "-", "--timestamp=none", path.join(destination, "libsherpa-onnx-c-api.dylib")]);
const kittenHeader = await verifiedFile("kitten-c-api.h", "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v2.0.3/sherpa-onnx/c-api/c-api.h", "1f738de63a206328253ff471edda96b011fa1bd6f2a028f82967a7761abc2edd", "c-api.h");
await copyFile(kittenHeader, path.join(kittenDirectory, "c-api.h"));
// Build eSpeak from source: the upstream macOS phonemizer archive contains Intel binaries.
const cmakeArchive = await verifiedFile("cmake-3.31.6-macos-universal.tar.gz", "https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-macos-universal.tar.gz", "330b9514f5112e5ed4fb08b8b05803b776fd9b539a6ae12927d14dcc0ee2ba8d");
const cmakeDirectory = path.join(destination, "cmake-3.31.6-cli");
await mkdir(cmakeDirectory, {recursive:true});
const cmake = path.join(cmakeDirectory, "bin/cmake");
try { await access(cmake); } catch { run("tar", ["-xzf", cmakeArchive, "--strip-components", "3", "-C", cmakeDirectory, "cmake-3.31.6-macos-universal/CMake.app/Contents/bin", "cmake-3.31.6-macos-universal/CMake.app/Contents/share"]); }
const espeakArchive = await verifiedFile("espeak-ng-1.52.0.tar.gz", "https://codeload.github.com/espeak-ng/espeak-ng/tar.gz/refs/tags/1.52.0", "bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23");
run("tar", ["-xzf", espeakArchive, "-C", destination]);
const espeakSource = path.join(destination, "espeak-ng-1.52.0");
const dependencies = path.join(espeakSource, "cmake/deps.cmake");
await writeFile(dependencies, (await readFile(dependencies, "utf8")).replace("else()\n  FetchContent_Declare", "elseif(NOT DEFINED USE_LIBSONIC OR USE_LIBSONIC)\n  FetchContent_Declare"));
const espeakBuild = path.join(destination, "espeak-build");
run(cmake, ["-S", espeakSource, "-B", espeakBuild, "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_OSX_ARCHITECTURES=arm64", "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.3", "-DBUILD_SHARED_LIBS=ON", "-DBUILD_TESTING=OFF", "-DUSE_LIBSONIC=OFF", "-DUSE_LIBPCAUDIO=OFF", "-DUSE_MBROLA=OFF", "-DUSE_ASYNC=OFF"]);
run(cmake, ["--build", espeakBuild, "--target", "espeak-ng", "--parallel", "4"]);
for (const name of ["libespeak-ng.dylib", "libespeak-ng.1.dylib"]) await copyFile(path.join(espeakBuild, "src/libespeak-ng/libespeak-ng.dylib"), path.join(kittenDirectory, name));
run("install_name_tool", ["-id", "@rpath/libespeak-ng.1.dylib", path.join(kittenDirectory, "libespeak-ng.dylib")]);
run("install_name_tool", ["-id", "@rpath/libespeak-ng.1.dylib", path.join(kittenDirectory, "libespeak-ng.1.dylib")]);
run("xcrun", ["clang++", "-std=c++17", "-O2", "-DCOVE_KITTEN_V8", "-arch", "arm64", "-mmacosx-version-min=13.3", "-I", kittenDirectory, "-I", path.join(espeakSource, "src/include"), "-L", kittenDirectory, "-Wl,-rpath,@executable_path", "-lsherpa-onnx-c-api", "-lespeak-ng", path.join(root, "scripts/native/speech-worker.cpp"), "-o", path.join(kittenDirectory, "cove-speech-worker")]);
const sourceDirectory = path.join(destination, "source");
await mkdir(sourceDirectory, { recursive: true });
for (const [name, url, digest] of [
 ["sherpa-source-1.12.40.tar.gz", "https://codeload.github.com/k2-fsa/sherpa-onnx/tar.gz/refs/tags/v1.12.40", "a7975f0239142a73e71d9069551f09b6509fde9278ee91fd6287ee8814e694cd"],
 ["sherpa-source-2.0.3.tar.gz", "https://codeload.github.com/k2-fsa/sherpa-onnx/tar.gz/refs/tags/v2.0.3", "40e2ded061e16eda9750a49d1dee78ba308d5c37fc544108d8a660611d3b4c8d"],
 ["piper-source.zip", "https://github.com/csukuangfj/piper-phonemize/archive/78a788e0b719013401572d70fef372e77bff8e43.zip", "89641a46489a4898754643ce57bda9c9b54b4ca46485fdc02bf0dc84b866645d"],
 ["espeak-fork-source.zip", "https://github.com/csukuangfj/espeak-ng/archive/7251208ee427ef87e94f39d0e99b15d287224ed6.zip", "909375fe289133fea765ee2e2369834b78b6ebc49d3fbeb4eaf3aa9d7fd685d4"],
]) {
 const source = await verifiedFile(name, url, digest);
 await copyFile(source, path.join(sourceDirectory, name));
}
await copyFile(espeakArchive, path.join(sourceDirectory, "espeak-ng-1.52.0.tar.gz"));
await copyFile(path.join(root, "scripts/native/speech-worker.cpp"), path.join(sourceDirectory, "speech-worker.cpp"));
await copyFile(fileURLToPath(import.meta.url), path.join(sourceDirectory, "prepare-speech-runtime.mjs"));
await copyFile(path.join(espeakSource, "COPYING"), path.join(destination, "GPL-3.0.txt"));
await copyFile(path.join(path.dirname(executable), "LICENSE"), path.join(destination, "POCKET_LICENSE.txt"));
const apacheLicense = spawnSync("tar", ["-xOf", path.join(sourceDirectory, "sherpa-source-1.12.40.tar.gz"), "sherpa-onnx-1.12.40/LICENSE"], { encoding: "utf8" });
if (apacheLicense.status !== 0) throw new Error("The sherpa-onnx license is missing");
await writeFile(path.join(destination, "SHERPA_LICENSE.txt"), apacheLicense.stdout);
const ortNotices = await verifiedFile("onnxruntime-1.28.2.zip", "https://github.com/csukuangfj/onnxruntime-libs/releases/download/v1.28.2/onnxruntime-osx-arm64-1.28.2.zip", "d9e5c0c79929e201f5b8eb095e6809a91ce78be9866a1bca0dfab7e20b40ae40");
for (const [source, name] of [["LICENSE", "ONNX_LICENSE.txt"], ["ThirdPartyNotices.txt", "ONNX_THIRD_PARTY_NOTICES.txt"]]) {
 const result = spawnSync("tar", ["-xOf", ortNotices, `onnxruntime-osx-arm64-1.28.2/${source}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
 if (result.status !== 0) throw new Error("The ONNX Runtime notices are missing");
 await writeFile(path.join(destination, name), result.stdout);
}
await copyFile(path.join(root, "scripts/native/SPEECH_NOTICES.md"), path.join(destination, "SPEECH_NOTICES.md"));
await writeFile(path.join(destination, "runtime-version.json"), JSON.stringify({ sherpa: "1.12.40", onnxRuntime: "1.28.2", kittenSherpa: "2.0.3", espeak: "1.52.0", pocket: "4.0.1" }) + "\n");
for (const directory of [destination, kittenDirectory]) {
 for (const name of await readdir(directory)) {
  if (!name.endsWith(".dylib") && !["cove-speech-worker", "pocket-tts"].includes(name)) continue;
  const binary = path.join(directory, name);
  const info = spawnSync("otool", ["-l", binary], {encoding:"utf8"});
  const minimum = info.stdout?.match(/\bminos\s+(\d+)\.(\d+)/) ?? info.stdout?.match(/LC_VERSION_MIN_MACOSX[\s\S]*?version\s+(\d+)\.(\d+)/);
  if (info.status !== 0 || !minimum || Number(minimum[1]) > 13 || (Number(minimum[1]) === 13 && Number(minimum[2]) > 3)) throw new Error(`Speech binary exceeds the macOS 13.3 minimum: ${name}`);
 }
}
console.log("Prepared local speech runtimes for Apple Silicon (macOS 13.3+).");
