// Build static CoveWeb package pages and a signed index into a new directory.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const [output, pem, ...files] = process.argv.slice(2);
if (!output || !pem || !files.length || files.length > 128) {
  throw new Error(
    "Usage: node scripts/build-mini-app-catalog.mjs NEW_DIRECTORY ED25519_PRIVATE_PEM APP.coveapp [...]",
  );
}
const destination = resolve(output);
if (
  await lstat(destination).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  })
) {
  throw new Error("Choose a new catalog output directory.");
}
const key = createPrivateKey(await readFile(pem));
if (key.asymmetricKeyType !== "ed25519")
  throw new Error("An Ed25519 signing key is required.");
const escaped = (text) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
const pages = new Map();
const packages = [];
for (const file of files) {
  const data = await readFile(file);
  const check = spawnSync(
    join(root, "scripts/go"),
    ["run", "./cmd/coveapp", "validate", "/dev/stdin"],
    {
      cwd: join(root, "services/local-service"),
      encoding: "utf8",
      input: data,
    },
  );
  if (check.status !== 0)
    throw new Error(check.stderr.trim() || "Package validation failed.");
  const app = JSON.parse(data);
  const id = app.publisher + "/" + app.app;
  const releases = pages.get(id) ?? [];
  if (releases.some((release) => release.version === app.version))
    throw new Error("Duplicate release: " + id + " " + app.version);
  releases.push(app);
  pages.set(id, releases);
  packages.push(data.toString("base64"));
}
const payload = Buffer.from(JSON.stringify({ format: 1, packages }));
const envelope = JSON.stringify({
  payload: payload.toString("base64"),
  signature: sign(null, payload, key).toString("base64"),
});
if (Buffer.byteLength(envelope) > 8 * 1024 * 1024)
  throw new Error("Signed catalog exceeds the host limit.");
await mkdir(dirname(destination), { recursive: true });
const staging = await mkdtemp(destination + ".staging-");
try {
  await writeFile(join(staging, "catalog.json"), envelope);
  const listing = [];
  const html = (title, content) =>
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escaped(title) +
    "</title><main><h1>" +
    escaped(title) +
    "</h1>" +
    content +
    "</main></html>";
  for (const [id, releases] of pages) {
    const directory = join(staging, "apps", id);
    await mkdir(directory, { recursive: true });
    releases.sort((a, b) =>
      b.version.localeCompare(a.version, "en", { numeric: true }),
    );
    const title = releases[0].name;
    const detail = releases
      .map(
        (app) =>
          "<section><h2>Version " +
          escaped(app.version) +
          "</h2><p>" +
          escaped(app.description) +
          "</p><p>Capabilities: " +
          escaped(app.capabilities.join(", ")) +
          '</p><a href="cove://install/' +
          id +
          "?version=" +
          app.version +
          '">Open in Cove</a></section>',
      )
      .join("");
    await writeFile(
      join(directory, "index.html"),
      html(
        title,
        detail + '<p><a href="https://www.hicove.io/">Get Cove for Mac</a></p>',
      ),
    );
    listing.push('<li><a href="' + id + '/">' + escaped(title) + "</a></li>");
  }
  await writeFile(
    join(staging, "apps/index.html"),
    html("Cove Mini Apps", "<ul>" + listing.join("") + "</ul>"),
  );
  await rename(staging, destination);
} finally {
  await rm(staging, { recursive: true, force: true });
}
const publicKey = createPublicKey(key).export({ format: "jwk" });
console.log(
  "Catalog verification key: " +
    Buffer.from(publicKey.x, "base64url").toString("base64"),
);
