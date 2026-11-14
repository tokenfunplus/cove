import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, access, rm } from "node:fs/promises";
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
