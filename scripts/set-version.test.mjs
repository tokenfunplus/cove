import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setReleaseVersion } from "./set-version.mjs";

const files = ["package.json", "apps/web/package.json", "packages/api-contract/package.json", "apps/macos/Resources/Info.plist"];

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "cove-version-test-"));
  try {
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      const contents = file.endsWith(".json")
        ? JSON.stringify({ name: "fixture", version: "0.1.0", private: true })
        : '<plist><dict><key>CFBundleIdentifier</key><string>fixture.cove</string><key>CoveReleaseVersion</key><string>0.1.0</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>4</string></dict></plist>';
      await writeFile(path.join(root, file), contents);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a beta version synchronizes all packages and macOS metadata", () => fixture(async root => {
  assert.deepEqual(await setReleaseVersion(root, "0.2.0-beta.1", "5"), {
    version: "0.2.0-beta.1", marketingVersion: "0.2.0", build: "5", tag: "v0.2.0-beta.1",
  });
  for (const file of files.slice(0, 3)) {
    const metadata = JSON.parse(await readFile(path.join(root, file), "utf8"));
    assert.equal(metadata.version, "0.2.0-beta.1");
    assert.equal(metadata.private, true);
  }
  const plist = await readFile(path.join(root, files[3]), "utf8");
  assert.match(plist, /<key>CoveReleaseVersion<\/key><string>0\.2\.0-beta\.1<\/string>/);
  assert.match(plist, /<key>CFBundleShortVersionString<\/key><string>0\.2\.0<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key><string>5<\/string>/);
  assert.match(plist, /<key>CFBundleIdentifier<\/key><string>fixture\.cove<\/string>/);
}));

test("the build number increments automatically when omitted", () => fixture(async root => {
  assert.equal((await setReleaseVersion(root, "0.1.1")).build, "5");
}));

test("invalid release versions and build numbers leave metadata untouched", () => fixture(async root => {
  const before = await Promise.all(files.map(file => readFile(path.join(root, file), "utf8")));
  for (const version of ["", "v0.1.0", "0.1", "01.1.0", "0.1.0-beta.01", "0.1.0-nightly.1"]) {
    await assert.rejects(setReleaseVersion(root, version, "5"));
  }
  for (const build of ["0", "-1", "01", "1.2", "9007199254740992"]) {
    await assert.rejects(setReleaseVersion(root, "0.1.0-beta.1", build));
  }
  assert.deepEqual(await Promise.all(files.map(file => readFile(path.join(root, file), "utf8"))), before);
}));

test("missing macOS metadata is rejected before changing workspace versions", () => fixture(async root => {
  const plistPath = path.join(root, files[3]);
  await writeFile(plistPath, '<plist><dict><key>CFBundleVersion</key><string>4</string></dict></plist>');
  await assert.rejects(setReleaseVersion(root, "0.2.0", "5"), /Missing string value/);
  for (const file of files.slice(0, 3)) {
    assert.equal(JSON.parse(await readFile(path.join(root, file), "utf8")).version, "0.1.0");
  }
}));
