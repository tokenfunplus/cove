import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { fixtureInstaller } from "../apps/web/e2e/mini-app-fixtures.mjs";

const entry = { raw: '{"fixture":"synthetic package"}' };
const headers = { "X-Cove-Session-Token": "synthetic-session", "X-Cove-CSRF-Token": "synthetic-csrf" };
const reviewed = { id: "synthetic-release", digest: "synthetic-digest" };

async function service(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("fixture installation rejects unsafe origins before making a request", (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    assert.fail("An invalid origin must not make a request");
  });
  for (const origin of [
    "https://127.0.0.1:19520", "http://example.test:19520", "http://localhost:19520",
    "http://127.0.0.1.example.test:19520", "http://user:password@127.0.0.1:19520",
    "http://127.0.0.1:19520@example.test", "http://127.0.0.1:19520/path",
    "http://127.0.0.1:19520?query", "http://127.0.0.1:19520#fragment",
    "http://127.1:19520", "http://2130706433:19520", "http://0.0.0.0:19520",
    "http://127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:65536",
    "http://127.0.0.1:19520/\n", "", null, undefined,
  ]) {
    assert.throws(() => fixtureInstaller(origin, headers), /Expected an HTTP 127\.0\.0\.1 Local Service origin/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("fixture installation preserves preview, package bytes and reviewed identity on loopback", async (t) => {
  const requests = [];
  const origin = await service(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(reviewed));
  });
  for (const suffix of ["", "/"]) {
    assert.deepEqual(await fixtureInstaller(origin + suffix, headers)(entry), reviewed);
  }
  assert.deepEqual(requests.map(({ url }) => url), [
    "/api/mini-apps/packages/preview", "/api/mini-apps/packages/install",
    "/api/mini-apps/packages/preview", "/api/mini-apps/packages/install",
  ]);
  for (const req of requests) {
    assert.equal(req.method, "POST");
    assert.equal(req.body, entry.raw);
    assert.equal(req.headers["x-cove-session-token"], headers["X-Cove-Session-Token"]);
    assert.equal(req.headers["x-cove-csrf-token"], headers["X-Cove-CSRF-Token"]);
    if (req.url.endsWith("/install")) {
      assert.equal(req.headers["x-cove-release-id"], reviewed.id);
      assert.equal(req.headers["x-cove-package-digest"], reviewed.digest);
    }
  }
});

for (const phase of ["preview", "install"]) {
  for (const status of [307, 308]) {
    test(`fixture ${phase} rejects ${status} redirects without forwarding bytes or session headers`, async (t) => {
      let forwarded = 0;
      const target = await service(t, (_req, res) => {
        forwarded++;
        res.end(JSON.stringify(reviewed));
      });
      const requested = [];
      const origin = await service(t, (req, res) => {
        requested.push(req.url);
        req.resume();
        if (req.url.endsWith("/" + phase)) {
          res.writeHead(status, { Location: target + "/receive" });
          res.end();
        } else {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(reviewed));
        }
      });
      await assert.rejects(fixtureInstaller(origin, headers)(entry), TypeError);
      assert.deepEqual(requested, phase === "preview"
        ? ["/api/mini-apps/packages/preview"]
        : ["/api/mini-apps/packages/preview", "/api/mini-apps/packages/install"]);
      assert.equal(forwarded, 0);
    });
  }
}
