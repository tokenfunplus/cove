import { test } from "node:test";
import assert from "node:assert/strict";
import { updateManifest } from "./write-update-manifest.mjs";

test("update manifest matches the Launcher's version and download_url contract", () => {
  assert.deepEqual(updateManifest("0.1.0", "https://github.com/tokenfunplus/cove/releases/download/v0.1.0/Cove-0.1.0-arm64.dmg"), {
    version: "0.1.0",
    download_url: "https://github.com/tokenfunplus/cove/releases/download/v0.1.0/Cove-0.1.0-arm64.dmg"
  });
});

test("malformed release versions and insecure download URLs fail before writing", () => {
  for (const version of ["", "v0.1.0", "0.1", "00.1.0", "0.1.0-rc.01"]) {
    assert.throws(() => updateManifest(version, "https://example.test/Cove.dmg"));
  }
  for (const url of ["http://example.test/Cove.dmg", "file:///tmp/Cove.dmg", "https://user:password@example.test/Cove.dmg"]) {
    assert.throws(() => updateManifest("0.1.0", url));
  }
  assert.equal(updateManifest("0.1.0-rc.1", "https://example.test/Cove.dmg").version, "0.1.0-rc.1");
});
