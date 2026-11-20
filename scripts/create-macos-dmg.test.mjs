import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 180_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}`);
  return result.stdout + result.stderr;
}

test("the DMG preserves the signed app and opens with a Retina drag-to-install layout", {
  skip: process.platform !== "darwin",
  timeout: 240_000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-dmg-layout-"));
  const app = path.join(directory, "source with spaces", "Cove.app");
  const image = path.join(directory, "Cove test.dmg");
  const mount = path.join(directory, "mount");
  let attached = false;
  try {
    await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
    await copyFile("/usr/bin/true", path.join(app, "Contents", "MacOS", "Cove"));
    await writeFile(path.join(app, "Contents", "Info.plist"), `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.tokenfunplus.cove.dmg-test</string>
<key>CFBundleExecutable</key><string>Cove</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CoveReleaseVersion</key><string>0.0.0-test</string>
</dict></plist>
`);
    run("codesign", ["--force", "--sign", "-", "--timestamp=none", app]);
    const sourceSignature = await readFile(path.join(app, "Contents", "_CodeSignature", "CodeResources"));
    run(path.join(root, "scripts/create-macos-dmg.sh"), [app, image]);
    assert.match(run("hdiutil", ["imageinfo", image]), /^Format: UDZO$/m);
    await mkdir(mount);
    run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, image]);
    attached = true;
    assert.equal(await readlink(path.join(mount, "Applications")), "/Applications");
    assert.deepEqual(await readFile(path.join(mount, "Cove.app", "Contents", "_CodeSignature", "CodeResources")), sourceSignature);
    run("codesign", ["--verify", "--deep", "--strict", path.join(mount, "Cove.app")]);
    run(path.join(root, ".artifacts/dmg-tools/bin/python"), ["-c", `
import os, sys
from ds_store import DSStore
from mac_alias import Alias
with DSStore.open(os.path.join(sys.argv[1], ".DS_Store"), "r") as store:
    layout = store["."]["bwsp"]
    assert layout["WindowBounds"] == "{{180, 140}, {720, 440}}", layout
    assert not any(layout[key] for key in ["ShowToolbar", "ShowSidebar", "ShowStatusBar", "ShowPathbar"])
    assert store["."]["icvl"] == (b"type", b"icnv")
    icons = store["."]["icvp"]
    assert icons["backgroundType"] == 2
    assert icons["iconSize"] == 112
    assert store["Cove.app"]["Iloc"][:2] == (180, 218)
    assert store["Applications"]["Iloc"][:2] == (540, 218)
    alias = Alias.from_bytes(icons["backgroundImageAlias"])
    assert alias.target.filename == ".background.tiff"
`, mount]);
    const retina = run("tiffutil", ["-info", path.join(mount, ".background.tiff")]);
    assert.match(retina, /720/);
    assert.match(retina, /1440/);
    run("codesign", ["--verify", "--deep", "--strict", app]);
  } finally {
    if (attached) run("hdiutil", ["detach", mount]);
    await rm(directory, { recursive: true, force: true });
  }
});
