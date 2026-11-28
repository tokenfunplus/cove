import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("catalog links and downloads resolve to the bytes in the signed release", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "cove-catalog-check-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = fileURLToPath(
    new URL(
      "../services/local-service/internal/appcatalog/testdata/legacy-releases/",
      import.meta.url,
    ),
  );
  const files = (await readdir(source)).filter((name) =>
    name.endsWith(".coveapp"),
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = join(temp, "fixture.pem"),
    site = join(temp, "site");
  await writeFile(pem, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  const build = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./build-mini-app-catalog.mjs", import.meta.url)),
      "--sequence",
      "42",
      site,
      pem,
      ...files.map((name) => join(source, name)),
    ],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  if (process.platform !== "win32") {
    assert.equal((await stat(site)).mode & 0o777, 0o755);
  }
  const envelope = JSON.parse(
    await readFile(join(site, "catalog.json"), "utf8"),
  );
  const payload = Buffer.from(envelope.payload, "base64");
  assert(
    verify(null, payload, publicKey, Buffer.from(envelope.signature, "base64")),
  );
  const index = JSON.parse(payload);
  assert.equal(index.format, 2);
  assert.equal(index.sequence, 42);
  assert(
    index.sequence > 0 &&
      Date.parse(index.expires_at) > Date.parse(index.issued_at),
  );
  const gallery = await readFile(join(site, "apps/index.html"), "utf8");
  const published = index.packages.map((encoded) =>
    JSON.parse(Buffer.from(encoded, "base64")),
  );
  const identities = new Set(
    published.map((app) => app.publisher + "/" + app.app),
  );
  assert.equal(
    (gallery.match(/<article class="app-card"/g) ?? []).length,
    identities.size,
  );
  assert.match(gallery, /aria-label="Available apps"/);
  assert.match(gallery, /<style>/);
  assert.doesNotMatch(gallery, /<script\b|<link\b|src="https?:\/\//i);
  for (const encoded of index.packages) {
    const raw = Buffer.from(encoded, "base64"),
      app = JSON.parse(raw);
    const dir = join(site, "apps", app.publisher, app.app);
    const html = await readFile(join(dir, "index.html"), "utf8");
    assert(
      html.includes(
        "cove://install/" +
          app.publisher +
          "/" +
          app.app +
          "?version=" +
          app.version,
      ),
    );
    assert(
      html.includes('href="' + app.version + '.coveapp"') &&
        html.includes("App screens"),
    );
    assert.deepEqual(await readFile(join(dir, app.version + ".coveapp")), raw);
  }
  const review = await readFile(
    join(site, "apps/cove/japanese-review-book/index.html"),
    "utf8",
  );
  const versions = published
    .filter(
      (app) => app.publisher === "cove" && app.app === "japanese-review-book",
    )
    .sort((a, b) =>
      b.version.localeCompare(a.version, "en", { numeric: true }),
    );
  assert(
    review.indexOf(`data-release-version="${versions[0].version}"`) <
      review.indexOf("Version history"),
  );
  assert(
    review.indexOf(`data-release-version="${versions[1].version}"`) >
      review.indexOf("Version history"),
  );
  assert.match(review, /Download app/);
  assert.match(review, /Read saved items/);
  assert(review.indexOf("records.query") > review.indexOf("Technical details"));
});

test("public pages escape authored text while preserving signed downloads and exact-version links", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "cove-catalog-escaping-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const starter = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          "../services/local-service/cmd/coveapp/starter.coveapp",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = join(temp, "fixture.pem"),
    site = join(temp, "site");
  await writeFile(pem, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  starter.publisher = "escape-author";
  starter.app = "safe-notes";
  starter.name = 'Notes <img src=x onerror="alert(1)"> & friends';
  starter.description =
    '<script>alert("description")</script> & a reading list';
  starter.pages[0].title = '</title><script>alert("page")</script>';
  const collection = Object.keys(starter.collections)[0];
  const field = Object.entries(starter.collections[collection].fields).find(
    ([, type]) => type === "text",
  )[0];
  starter.seed = {
    [collection]: [{ [field]: '<img src=x onerror="seed()"> & saved text' }],
  };
  const source = join(temp, "source.coveapp");
  const raw = Buffer.from(JSON.stringify(starter, null, 2) + "\n\n");
  await writeFile(source, raw);
  const build = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./build-mini-app-catalog.mjs", import.meta.url)),
      "--sequence",
      "43",
      site,
      pem,
      source,
    ],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const dir = join(site, "apps", starter.publisher, starter.app);
  for (const file of [join(site, "apps/index.html"), join(dir, "index.html")]) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(html, /<script\b|<img src=x/i);
    assert.match(
      html,
      /Notes &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; friends/,
    );
    assert.match(
      html,
      /&lt;script&gt;alert\(&quot;description&quot;\)&lt;\/script&gt; &amp; a reading list/,
    );
    assert.match(
      html,
      /&lt;\/title&gt;&lt;script&gt;alert\(&quot;page&quot;\)&lt;\/script&gt;/,
    );
    assert.match(
      html,
      /&lt;img src=x onerror=&quot;seed\(\)&quot;&gt; &amp; saved text/,
    );
  }
  const html = await readFile(join(dir, "index.html"), "utf8");
  assert(
    html.includes(
      "cove://install/escape-author/safe-notes?version=" + starter.version,
    ),
  );
  assert(html.includes('download href="' + starter.version + '.coveapp"'));
  assert.deepEqual(
    await readFile(join(dir, starter.version + ".coveapp")),
    raw,
  );
  const envelope = JSON.parse(
    await readFile(join(site, "catalog.json"), "utf8"),
  );
  const payload = Buffer.from(envelope.payload, "base64");
  assert(
    verify(null, payload, publicKey, Buffer.from(envelope.signature, "base64")),
  );
  assert.deepEqual(Buffer.from(JSON.parse(payload).packages[0], "base64"), raw);
});

test("public preview accepts an unseeded collection named constructor", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "cove-catalog-prototype-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const starter = JSON.parse(await readFile(fileURLToPath(new URL(
    "../services/local-service/cmd/coveapp/starter.coveapp", import.meta.url,
  )), "utf8"));
  starter.collections = { constructor: starter.collections.notes };
  for (const action of Object.values(starter.actions)) {
    action.collection = "constructor";
  }
  starter.seed = {};
  const source = join(temp, "prototype.coveapp");
  await writeFile(source, JSON.stringify(starter));
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = join(temp, "fixture.pem"), site = join(temp, "site");
  await writeFile(pem, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  const build = spawnSync(process.execPath, [
    fileURLToPath(new URL("./build-mini-app-catalog.mjs", import.meta.url)),
    "--sequence", "44", site, pem, source,
  ], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const html = await readFile(join(site, "apps/personal/notes/index.html"), "utf8");
  assert.match(html, /A fresh space for your ideas\./);
  assert.deepEqual(
    await readFile(join(site, "apps/personal/notes/1.0.0.coveapp")),
    await readFile(source),
  );
});
