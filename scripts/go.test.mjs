import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wrapper = fileURLToPath(new URL("./go", import.meta.url));

async function invoke(platform, overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-go-wrapper-"));
  try {
    await writeFile(path.join(directory, "uname"), `#!${process.execPath}\nconsole.log(${JSON.stringify(platform)});\n`, { mode: 0o700 });
    await writeFile(path.join(directory, "go"), `#!${process.execPath}
      if (process.argv[2] === 'version') process.exit(0);
      console.log(JSON.stringify({args: process.argv.slice(2), target: process.env.MACOSX_DEPLOYMENT_TARGET ?? null,
        c: process.env.CGO_CFLAGS ?? null, cxx: process.env.CGO_CXXFLAGS ?? null, ld: process.env.CGO_LDFLAGS ?? null}));
    `, { mode: 0o700 });
    const environment = { ...process.env, PATH: directory + path.delimiter + process.env.PATH };
    for (const name of ["MACOSX_DEPLOYMENT_TARGET", "CGO_CFLAGS", "CGO_CXXFLAGS", "CGO_LDFLAGS"]) delete environment[name];
    const result = spawnSync("sh", [wrapper, "build", "./cmd/fixture"], { env: { ...environment, ...overrides }, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("macOS Go builds explicitly compile and link for macOS 13", async () => {
  const result = await invoke("Darwin");
  assert.deepEqual(result.args, ["build", "./cmd/fixture"]);
  assert.equal(result.target, "13.0");
  for (const flags of [result.c, result.cxx, result.ld]) assert.equal(flags, "-O2 -g -mmacosx-version-min=13.0");
});

test("a chosen deployment target preserves custom cgo options", async () => {
  const result = await invoke("Darwin", {
    MACOSX_DEPLOYMENT_TARGET: "14.0", CGO_CFLAGS: "-O3", CGO_CXXFLAGS: "-O1", CGO_LDFLAGS: "-g",
  });
  assert.equal(result.c, "-O3 -mmacosx-version-min=14.0");
  assert.equal(result.cxx, "-O1 -mmacosx-version-min=14.0");
  assert.equal(result.ld, "-g -mmacosx-version-min=14.0");
});

test("Linux Go builds keep their compiler and linker environment", async () => {
  const result = await invoke("Linux", { CGO_CFLAGS: "-O3", CGO_LDFLAGS: "-g" });
  assert.equal(result.target, null);
  assert.equal(result.c, "-O3");
  assert.equal(result.cxx, null);
  assert.equal(result.ld, "-g");
});
