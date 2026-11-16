import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { selectReleaseAssets, signatureIdentity, verifyReleaseAssets } from "./sign-release.mjs";

const tag = "v0.1.0-beta.3";
const repository = "tokenfunplus/cove";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const name = "Cove-0.1.0-beta.3-arm64.dmg";
  const dmg = Buffer.from("Synthetic release bytes");
  const files = new Map([
    [name, dmg],
    [`${name}.sha256`, Buffer.from(`${digest(dmg)}  ${name}\n`)],
    ["update.json", Buffer.from(JSON.stringify({ version: tag.slice(1), download_url: `https://github.com/${repository}/releases/download/${tag}/${name}` }))],
  ]);
  const release = { tag_name: tag, draft: false, published_at: "2026-11-16T12:00:00Z", assets: [] };
  for (const [name, bytes] of files) {
    release.assets.push({ id: release.assets.length + 1, name, size: bytes.length, digest: `sha256:${digest(bytes)}` });
  }
  return { release, files, name };
}

function replaceAsset(release, files, name, bytes) {
  files.set(name, bytes);
  const asset = release.assets.find((item) => item.name === name);
  asset.size = bytes.length;
  asset.digest = `sha256:${digest(bytes)}`;
}

test("release signing accepts exact published bytes without changing the asset manifest", () => {
  const { release, files } = fixture();
  const before = structuredClone(release);
  assert.equal(verifyReleaseAssets(release, tag, repository, files).length, 3);
  assert.deepEqual(release, before);
});

test("release signing refuses drafts, absent digests, duplicate assets, and untrusted tag syntax", () => {
  for (const value of ["--help", "v0.1.0/../other", "v0.1.0; command", "v0.1.0-beta.01"]) {
    assert.throws(() => selectReleaseAssets(fixture().release, value));
  }
  for (const mutate of [
    (release) => { release.draft = true; },
    (release) => { release.published_at = null; },
    (release) => { release.tag_name = "v0.1.0"; },
    (release) => { release.assets[0].digest = null; },
    (release) => { release.assets[0].size = 513 << 20; },
    (release) => { release.assets.push({ ...release.assets[0] }); },
    (release) => { release.assets.pop(); },
  ]) {
    const { release } = fixture();
    mutate(release);
    assert.throws(() => selectReleaseAssets(release, tag));
  }
});

test("release signing detects modified downloads and inconsistent checksums", () => {
  const { release, files, name } = fixture();
  files.get(name)[0] ^= 0xff;
  assert.throws(() => verifyReleaseAssets(release, tag, repository, files), /digest or size/);
  replaceAsset(release, files, name, files.get(name));
  assert.throws(() => verifyReleaseAssets(release, tag, repository, files), /checksum/);
});

test("release signing rejects mismatched versions and external update destinations", () => {
  for (const manifest of [
    { version: "0.1.0", download_url: "https://example.test/Cove.dmg" },
    { version: tag.slice(1), download_url: "https://example.test/Cove.dmg" },
    { version: tag.slice(1), download_url: `https://github.com/${repository}/releases/download/v0.1.0/Cove.dmg` },
  ]) {
    const { release, files } = fixture();
    replaceAsset(release, files, "update.json", Buffer.from(JSON.stringify(manifest)));
    assert.throws(() => verifyReleaseAssets(release, tag, repository, files), /manifest/);
  }
});

test("signature verification binds the repository, workflow, and allowed signing refs", () => {
  const pattern = new RegExp(signatureIdentity("owner.name/repo.name", tag));
  const prefix = "https://github.com/owner.name/repo.name/.github/workflows/release-signatures.yml@refs/";
  assert.ok(pattern.test(`${prefix}heads/main`));
  assert.ok(pattern.test(`${prefix}tags/${tag}`));
  for (const identity of [`${prefix}heads/other`, `${prefix}tags/v0.1.0`, `${prefix}heads/main/extra`,
    `${prefix}heads/main`.replace("owner.name", "ownerXname"), `${prefix}heads/main`.replace("release-signatures.yml", "other.yml")]) {
    assert.equal(pattern.test(identity), false);
  }
});
