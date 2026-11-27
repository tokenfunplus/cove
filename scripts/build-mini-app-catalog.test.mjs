import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("catalog links and downloads resolve to the bytes in the signed release", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "cove-catalog-check-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = fileURLToPath(
    new URL(
      "../services/local-service/internal/appcatalog/packages/",
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
});
