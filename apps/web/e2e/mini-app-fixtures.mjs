import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// Historical release bytes are test inputs, not a production catalog or runtime dependency.
export async function miniAppFixtures() {
  const directory = path.resolve("services/local-service/internal/appcatalog/testdata/legacy-releases");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".coveapp"));
  return Promise.all(files.map(async (name) => {
    const raw = await readFile(path.join(directory, name), "utf8");
    return { ...JSON.parse(raw), raw, origin: "builtin", digest: createHash("sha256").update(raw).digest("hex") };
  }));
}

export function fixtureInstaller(origin, headers) {
  // Fixture bytes and session headers must stay on the test's loopback service.
  const match = typeof origin === "string" && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(origin);
  assert(match && Number(match[1]) <= 65535, "Expected an HTTP 127.0.0.1 Local Service origin with a valid port");
  const service = new URL(`http://127.0.0.1:${match[1]}/`);
  return async (entry) => {
    assert(entry, "Missing historical release fixture");
    const preview = await fetch(new URL("/api/mini-apps/packages/preview", service), {
      method: "POST", headers, body: entry.raw, redirect: "error",
    });
    assert.equal(preview.status, 200, "Historical package preview must work without embedded application bytes");
    const reviewed = await preview.json();
    const installed = await fetch(new URL("/api/mini-apps/packages/install", service), { method: "POST",
      headers: { ...headers, "X-Cove-Release-ID": reviewed.id, "X-Cove-Package-Digest": reviewed.digest },
      body: entry.raw, redirect: "error" });
    assert.equal(installed.status, 200, "Historical package install must retain its verified legacy identity");
    return installed.json();
  };
}
