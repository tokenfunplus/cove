import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./sign-local-service.sh", import.meta.url));
const developerID = "A".repeat(40);
const appleDevelopment = "B".repeat(40);
const otherDeveloperID = "C".repeat(40);
const identity = (hash, name) => `  1) ${hash} "${name}"\n`;

async function sign({ platform = "Darwin", identities = "", requested, signingExit = 0, verificationExit = 0, inventoryExit = 0 } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-signing-test-"));
  try {
    const executable = path.join(directory, "Local Service");
    const log = path.join(directory, "codesign.jsonl");
    await writeFile(executable, "fixture", { mode: 0o700 });
    const mocks = {
      uname: `console.log(${JSON.stringify(platform)});`,
      security: `process.stdout.write(${JSON.stringify(identities)}); process.exit(${inventoryExit});`,
      codesign: `const fs = require('node:fs'); const args = process.argv.slice(2);
        fs.appendFileSync(process.env.COVE_TEST_SIGNING_LOG, JSON.stringify(args) + '\\n');
        process.exit(args.includes('--sign') ? ${signingExit} : ${verificationExit});`,
    };
    for (const [name, source] of Object.entries(mocks)) {
      await writeFile(path.join(directory, name), `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
    }
    const environment = {
      ...process.env,
      PATH: directory + path.delimiter + process.env.PATH,
      COVE_TEST_SIGNING_LOG: log,
    };
    delete environment.COVE_SIGNING_IDENTITY;
    if (requested !== undefined) environment.COVE_SIGNING_IDENTITY = requested;
    const result = spawnSync("sh", [script, executable], { env: environment, encoding: "utf8" });
    assert.ifError(result.error);
    const calls = await readFile(log, "utf8").then(text => text.trim().split("\n").map(JSON.parse)).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    return { ...result, calls, executable };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("local macOS signing prefers Developer ID and verifies the executable", async () => {
  const result = await sign({ identities: identity(appleDevelopment, "Apple Development: Fixture") + identity(developerID, "Developer ID Application: Fixture") });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    ["--force", "--options", "runtime", "--timestamp=none", "--identifier", "io.github.tokenfunplus.cove.local-service", "--sign", developerID, result.executable],
    ["--verify", "--strict", result.executable],
  ]);
});

test("local macOS signing supports an Apple Development certificate", async () => {
  const result = await sign({ identities: identity(appleDevelopment, "Apple Development: Fixture") });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls[0][result.calls[0].indexOf("--sign") + 1], appleDevelopment);
});

test("an explicit identity takes precedence without requiring identity discovery", async () => {
  const result = await sign({ requested: "Developer ID Application: Selected Fixture", inventoryExit: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls[0][result.calls[0].indexOf("--sign") + 1], "Developer ID Application: Selected Fixture");
});

test("multiple candidate certificates require an explicit selection", async () => {
  const result = await sign({ identities: identity(developerID, "Developer ID Application: First") + identity(otherDeveloperID, "Developer ID Application: Second") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /set COVE_SIGNING_IDENTITY/);
  assert.deepEqual(result.calls, []);
});

test("machines without a supported identity retain ad-hoc signing", async () => {
  const result = await sign({ identities: "     0 valid identities found\n" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls[0][result.calls[0].indexOf("--sign") + 1], "-");
  assert.match(result.stdout, /ad-hoc signature/);
});

test("ad-hoc signing can be selected explicitly for isolated fixtures", async () => {
  const result = await sign({ requested: "-", inventoryExit: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls[0][result.calls[0].indexOf("--sign") + 1], "-");
});

test("signing and verification failures do not fall back to an unsigned build", async () => {
  for (const failure of [{ signingExit: 1 }, { verificationExit: 1 }]) {
    const result = await sign({ requested: developerID, ...failure });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /signed and verified/);
    assert.equal(result.calls.filter(args => args.includes("--sign")).length, 1);
  }
});

test("identity discovery failures stop the build before signing", async () => {
  const result = await sign({ inventoryExit: 1 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not list/);
  assert.deepEqual(result.calls, []);
});

test("portable builds do not invoke macOS signing tools", async () => {
  const result = await sign({ platform: "Linux", inventoryExit: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, []);
});
