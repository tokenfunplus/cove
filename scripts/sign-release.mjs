import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const releaseTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;
const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function selectReleaseAssets(release, tag) {
  if (!releaseTag.test(tag) || release.tag_name !== tag || release.draft || !release.published_at) {
    throw new Error("Expected an existing published Cove release tag");
  }
  const dmg = `Cove-${tag.slice(1)}-arm64.dmg`;
  return [dmg, `${dmg}.sha256`, "update.json"].map((name) => {
    const matches = release.assets.filter((asset) => asset.name === name);
    if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest)
      || !Number.isSafeInteger(matches[0].size) || matches[0].size < 1 || matches[0].size > (512 << 20)) {
      throw new Error(`Missing or invalid release asset metadata: ${name}`);
    }
    return matches[0];
  });
}

export function verifyReleaseAssets(release, tag, repository, files) {
  if (!repositoryName.test(repository)) throw new Error("Invalid GitHub repository name");
  const assets = selectReleaseAssets(release, tag);
  for (const asset of assets) {
    const bytes = files.get(asset.name);
    if (!Buffer.isBuffer(bytes) || bytes.length !== asset.size || `sha256:${sha256(bytes)}` !== asset.digest) {
      throw new Error(`Release asset digest or size does not match GitHub: ${asset.name}`);
    }
  }
  const [dmg, checksum] = assets;
  const expectedChecksum = `${sha256(files.get(dmg.name))}  ${dmg.name}`;
  if (files.get(checksum.name).toString("utf8").trimEnd() !== expectedChecksum) {
    throw new Error("Release checksum does not match the DMG");
  }
  const manifest = JSON.parse(files.get("update.json").toString("utf8"));
  if (manifest.version !== tag.slice(1)
    || manifest.download_url !== `https://github.com/${repository}/releases/download/${tag}/${dmg.name}`) {
    throw new Error("Release update manifest does not match the release tag and repository");
  }
  return assets;
}

export function signatureIdentity(repository, tag) {
  if (!repositoryName.test(repository) || !releaseTag.test(tag)) throw new Error("Invalid signing identity");
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escape(`https://github.com/${repository}/.github/workflows/release-signatures.yml@refs/`)}(heads/main|tags/${escape(tag)})$`;
}

function command(executable, args) {
  return execFileSync(executable, args, { encoding: "utf8", maxBuffer: 4 << 20 });
}

async function signRelease(repository, tag) {
  signatureIdentity(repository, tag);
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== repository) {
    throw new Error("Keyless release signing must run in the repository's GitHub Actions workflow");
  }
  const loadRelease = () => JSON.parse(command("gh", ["api", `repos/${repository}/releases/tags/${tag}`]));
  const release = loadRelease();
  const assets = selectReleaseAssets(release, tag);
  const directory = await mkdtemp(path.join(tmpdir(), "cove-release-signatures-"));
  try {
    const files = new Map();
    const download = (name) => command("gh", ["release", "download", tag, "--repo", repository, "--dir", directory, "--pattern", name]);
    for (const asset of assets) {
      download(asset.name);
      files.set(asset.name, await readFile(path.join(directory, asset.name)));
    }
    verifyReleaseAssets(release, tag, repository, files);
    const bundles = [];
    for (const asset of assets) {
      const name = `${asset.name}.sigstore.json`;
      const bundle = path.join(directory, name);
      const file = path.join(directory, asset.name);
      const existing = release.assets.some((item) => item.name === name);
      if (existing) {
        download(name);
      } else {
        command("cosign", ["sign-blob", "--yes", "--bundle", bundle, file]);
      }
      command("cosign", ["verify-blob", "--bundle", bundle,
        "--certificate-identity-regexp", signatureIdentity(repository, tag),
        "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com", file]);
      if (!existing) bundles.push(bundle);
    }
    // A concurrent release edit must not turn a signature of old bytes into a current endorsement.
    const current = loadRelease();
    const latest = verifyReleaseAssets(current, tag, repository, files);
    if (latest.some((asset, index) => asset.id !== assets[index].id)) throw new Error("Release assets changed during signing");
    if (bundles.length) command("gh", ["release", "upload", tag, ...bundles, "--repo", repository]);
    console.log(`Verified signatures for ${assets.length} release assets; added ${bundles.length} bundles without replacing downloads.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    await signRelease(...process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
