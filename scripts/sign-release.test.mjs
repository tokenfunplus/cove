import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { selectReleaseAssets, signRelease, signatureIdentity, verifyReleaseAssets } from "./sign-release.mjs";

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
    const { release } = fixture();
    release.tag_name = value;
    assert.throws(() => selectReleaseAssets(release, value), /Expected an existing published Cove release tag/);
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
    { version: "0.1.0", download_url: `https://github.com/${repository}/releases/download/${tag}/Cove-${tag.slice(1)}-arm64.dmg` },
    { version: "0.1.0", download_url: "https://example.test/Cove.dmg" },
    { version: tag.slice(1), download_url: "https://example.test/Cove.dmg" },
    { version: tag.slice(1), download_url: `https://github.com/${repository}/releases/download/v0.1.0/Cove.dmg` },
  ]) {
    const { release, files } = fixture();
    replaceAsset(release, files, "update.json", Buffer.from(JSON.stringify(manifest)));
    assert.throws(() => verifyReleaseAssets(release, tag, repository, files), /manifest/);
  }
});

function signingFixture({ existing = 0, changeOnRead = 0, invalidSignature = false } = {}) {
  const { release, files } = fixture();
  const calls = [];
  let reads = 0;
  for (const asset of [...release.assets].slice(0, existing)) {
    const name = `${asset.name}.sigstore.json`;
    const bytes = Buffer.from("Existing signature fixture");
    files.set(name, bytes);
    release.assets.push({ id: release.assets.length + 1, name, size: bytes.length, digest: `sha256:${digest(bytes)}` });
  }
  const run = (executable, args) => {
    calls.push({ executable, args });
    if (executable === "gh" && args[0] === "api") {
      if (++reads === changeOnRead) release.assets[0].id += 100;
      return JSON.stringify(release);
    }
    if (executable === "gh" && args[1] === "download") {
      const name = args[args.indexOf("--pattern") + 1];
      writeFileSync(path.join(args[args.indexOf("--dir") + 1], name), files.get(name));
      return "";
    }
    if (executable === "cosign" && args[0] === "sign-blob") {
      writeFileSync(args[args.indexOf("--bundle") + 1], "New signature fixture");
      return "";
    }
    if (executable === "cosign" && args[0] === "verify-blob") {
      if (invalidSignature) throw new Error("Signature verification failed");
      return "";
    }
    if (executable === "gh" && args[1] === "upload") {
      assert.ok(!args.includes("--clobber"));
      for (const file of args.slice(3, args.indexOf("--repo"))) {
        const name = path.basename(file);
        assert.ok(!files.has(name), "Published files must not be replaced");
        const bytes = readFileSync(file);
        files.set(name, bytes);
        release.assets.push({ id: release.assets.length + 1, name, size: bytes.length, digest: `sha256:${digest(bytes)}` });
      }
      return "";
    }
    throw new Error(`Unexpected signing command: ${executable} ${args[0]}`);
  };
  return { release, files, calls, options: {
    run, environment: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: repository }, log: () => {},
  } };
}

test("release signing verifies existing bundles, adds only missing bundles, and is safe to rerun", async () => {
  const { release, files, calls, options } = signingFixture({ existing: 1 });
  const original = new Map([...files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  await signRelease(repository, tag, options);
  assert.equal(calls.filter(({ args }) => args[0] === "sign-blob").length, 2);
  assert.equal(calls.filter(({ args }) => args[0] === "verify-blob").length, 3);
  assert.equal(calls.filter(({ args }) => args[1] === "upload").length, 1);
  assert.equal(release.assets.length, 6);
  for (const [name, bytes] of original) assert.deepEqual(files.get(name), bytes);
  calls.length = 0;
  await signRelease(repository, tag, options);
  assert.equal(calls.filter(({ args }) => args[0] === "sign-blob" || args[1] === "upload").length, 0);
  assert.equal(calls.filter(({ args }) => args[0] === "verify-blob").length, 3);
});

test("an invalid existing signature stops signing without uploading replacements", async () => {
  const { calls, options } = signingFixture({ existing: 3, invalidSignature: true });
  await assert.rejects(signRelease(repository, tag, options), /Signature verification failed/);
  assert.ok(!calls.some(({ args }) => args[0] === "sign-blob" || args[1] === "upload"));
});

test("release asset edits before upload prevent publication and edits during upload fail the run", async () => {
  for (const changeOnRead of [2, 3]) {
    const { calls, options } = signingFixture({ changeOnRead });
    await assert.rejects(signRelease(repository, tag, options), /Release assets changed during signing/);
    assert.equal(calls.filter(({ args }) => args[1] === "upload").length, changeOnRead === 2 ? 0 : 1);
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
