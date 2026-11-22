import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const native = process.platform === "darwin" && process.arch === "arm64";

async function rejectedPackage(prepare, environment = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-notary-preflight-"));
  try {
    const app = path.join(directory, "Cove.app");
    const info = path.join(app, "Contents/Info.plist");
    const output = path.join(directory, "output");
    await mkdir(path.join(app, "Contents/MacOS"), { recursive: true });
    await mkdir(path.join(app, "Contents/Resources"), { recursive: true });
    await copyFile(path.join(root, "apps/macos/Resources/Info.plist"), info);
    await prepare({ app, info });
    const result = spawnSync("sh", [path.join(root, "scripts/notarize-macos-package.sh"), app, output], {
      encoding: "utf8",
      env: {
        ...process.env,
        COVE_SIGNING_IDENTITY: "Nonexistent fixture identity",
        COVE_NOTARY_PROFILE: "nonexistent-fixture-profile",
        ...environment,
      },
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    await assert.rejects(access(output), { code: "ENOENT" });
    return result.stderr;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a distributable package cannot select ad-hoc signing", { skip: !native }, async () => {
  const error = await rejectedPackage(async () => {}, { COVE_SIGNING_IDENTITY: "-" });
  assert.match(error, /must select a Developer ID Application certificate/);
});

test("a package from another release is rejected before signing", { skip: !native }, async () => {
  const error = await rejectedPackage(async ({ info }) => {
    const result = spawnSync("plutil", ["-replace", "CoveReleaseVersion", "-string", "0.0.0-fixture", info]);
    assert.equal(result.status, 0);
  });
  assert.match(error, /CoveReleaseVersion does not match/);
});

test("a plaintext Secret Store fixture cannot enter the release flow", { skip: !native }, async () => {
  const error = await rejectedPackage(async ({ info }) => {
    const result = spawnSync("plutil", ["-insert", "CoveInsecureFileSecretStore", "-bool", "true", info]);
    assert.equal(result.status, 0);
  });
  assert.match(error, /test app with file-based Provider secrets cannot be published/);
});

test("an app containing local data is rejected before signing or submission", { skip: !native }, async () => {
  const error = await rejectedPackage(async ({ app }) => {
    await copyFile("/usr/bin/true", path.join(app, "Contents/MacOS/Cove"));
    await copyFile("/usr/bin/true", path.join(app, "Contents/Resources/cove-local-service"));
    await writeFile(path.join(app, "Contents/Resources/THIRD_PARTY_LICENSES.txt"), "Fixture notices\n");
    await writeFile(path.join(app, "Contents/Resources/fixture.sqlite"), "fixture");
  });
  assert.match(error, /contains local state or credential files/);
});

test("binary deployment targets cannot exceed the advertised minimum OS", { skip: !native }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-deployment-guard-"));
  try {
    await writeFile(path.join(directory, "otool"), '#!/bin/sh\nprintf "cmd LC_BUILD_VERSION\\nminos 99.0\\n"\n', { mode: 0o700 });
    const error = await rejectedPackage(async ({ app }) => {
      await copyFile("/usr/bin/true", path.join(app, "Contents/MacOS/Cove"));
      await copyFile("/usr/bin/true", path.join(app, "Contents/Resources/cove-local-service"));
    }, { PATH: directory + path.delimiter + process.env.PATH });
    assert.match(error, /requires macOS 99\.0 instead of the advertised/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local notarization signs native workers and libraries before the enclosing service", { skip: !native }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-notary-workers-"));
  try {
    const app = path.join(directory, "Cove.app");
    const resources = path.join(app, "Contents/Resources");
    const bin = path.join(directory, "bin");
    const log = path.join(directory, "signing.log");
    await mkdir(path.join(app, "Contents/MacOS"), { recursive: true });
    await mkdir(path.join(resources, "speech/kitten"), { recursive: true });
    await mkdir(path.join(resources, "inference"), { recursive: true });
    await mkdir(bin);
    await copyFile(path.join(root, "apps/macos/Resources/Info.plist"), path.join(app, "Contents/Info.plist"));
    await copyFile("/usr/bin/true", path.join(app, "Contents/MacOS/Cove"));
    await copyFile("/usr/bin/true", path.join(resources, "cove-local-service"));
    await writeFile(path.join(resources, "THIRD_PARTY_LICENSES.txt"), "Fixture notices\n");
    const workers = ["inference/llama-server", "inference/libggml.dylib", "speech/cove-speech-worker", "speech/pocket-tts", "speech/libonnxruntime.dylib", "speech/kitten/cove-speech-worker", "speech/kitten/libespeak-ng.dylib"];
    for (const file of [...workers, "inference/LICENSE", "speech/SPEECH_NOTICES.md"]) {
      await writeFile(path.join(resources, file), "Fixture native file\n");
    }
    await writeFile(path.join(bin, "otool"), '#!/bin/sh\nprintf "cmd LC_BUILD_VERSION\\nminos 13.0\\n"\n', { mode: 0o700 });
    // Stop at the service signature, before any notarization or disk-image work.
    await writeFile(path.join(bin, "codesign"), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$COVE_FIXTURE_SIGN_LOG"\nfor argument do\n case "$argument" in\n  */cove-local-service) exit 1;;\n  */Contents/Resources/inference/*|*/Contents/Resources/speech/*) printf "Signed fixture\\n" >> "$argument";;\n esac\ndone\nexit 0\n', { mode: 0o700 });
    const result = spawnSync("sh", [path.join(root, "scripts/notarize-macos-package.sh"), app, path.join(directory, "output")], {
      encoding: "utf8",
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, COVE_SIGNING_IDENTITY: "Fixture Developer ID", COVE_NOTARY_PROFILE: "unused-fixture-profile", COVE_FIXTURE_SIGN_LOG: log },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    for (const worker of workers) assert(calls.some(argument => argument.endsWith("/Contents/Resources/" + worker)), worker);
    assert(calls.at(-1).endsWith("/Contents/Resources/cove-local-service"));
    assert(!calls.some(argument => argument.endsWith("/inference/LICENSE") || argument.endsWith("/speech/SPEECH_NOTICES.md")));
    assert.equal(await readFile(path.join(resources, workers[0]), "utf8"), "Fixture native file\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
