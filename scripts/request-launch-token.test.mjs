import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { requestLaunchToken } from "./request-launch-token.mjs";

async function service(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function cli(url, token, script = fileURLToPath(new URL("request-launch-token.mjs", import.meta.url))) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, url]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(token);
  });
}

test("launch-token CLI authenticates by stdin and returns only the token", async (t) => {
  const url = await service(t, (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/internal/control/launch-token");
    assert.equal(req.headers["x-cove-control-token"], "synthetic-control");
    res.end(JSON.stringify({ launch_token: "synthetic_launch-token" }));
  });
  assert.deepEqual(await cli(url, "synthetic-control"), {
    code: 0, stdout: "synthetic_launch-token", stderr: "",
  });
});

test("launch-token CLI works through a symlinked script path", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-launch-token-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = path.join(directory, "request-launch-token.mjs");
  await symlink(fileURLToPath(new URL("request-launch-token.mjs", import.meta.url)), script);
  const url = await service(t, (_req, res) => res.end('{"launch_token":"synthetic-launch"}'));
  assert.deepEqual(await cli(url, "synthetic-control", script), {
    code: 0, stdout: "synthetic-launch", stderr: "",
  });
});

test("launch-token requests reject non-loopback origins and URL credentials", async () => {
  for (const url of ["https://127.0.0.1:19421", "http://example.test", "http://127.0.0.1.example.test",
    "http://user:password@127.0.0.1", "http://127.0.0.1/path", "http://127.0.0.1?query", "http://127.0.0.1#fragment"]) {
    await assert.rejects(requestLaunchToken(url, "synthetic-control"));
  }
  await assert.rejects(requestLaunchToken("http://127.0.0.1", ""));
});

test("launch-token requests reject malformed, missing, and unsafe response tokens", async (t) => {
  let body;
  const url = await service(t, (_req, res) => res.end(body));
  for (body of ["not JSON", "null", "{}", '{"launch_token":7}', '{"launch_token":""}',
    '{"launch_token":"token&other=value"}', '{"launch_token":"token\\n"}', "x".repeat(16385)]) {
    await assert.rejects(requestLaunchToken(url, "synthetic-control"));
  }
});

test("launch-token requests do not follow redirects or forward credentials", async (t) => {
  let redirected = false;
  const target = await service(t, (_req, res) => { redirected = true; res.end("{}"); });
  const url = await service(t, (_req, res) => {
    res.writeHead(302, { Location: target });
    res.end();
  });
  await assert.rejects(requestLaunchToken(url, "synthetic-control"));
  assert.equal(redirected, false);
});

test("launch-token requests time out when a service does not respond", async (t) => {
  const url = await service(t, () => {});
  await assert.rejects(requestLaunchToken(url, "synthetic-control"), { name: "AbortError" });
});

test("failed launch-token CLI requests do not print credentials or response bodies", async (t) => {
  const url = await service(t, (_req, res) => {
    res.writeHead(403);
    res.end("synthetic-private-response");
  });
  assert.deepEqual(await cli(url, "synthetic-control"), {
    code: 1, stdout: "", stderr: "Could not obtain a Local Service launch token\n",
  });
});
