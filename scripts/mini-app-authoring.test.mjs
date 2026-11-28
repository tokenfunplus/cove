import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("an independent author's public packages and upgrade remain compatible", async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temp = await mkdtemp(join(tmpdir(), "cove-independent-author-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const executable = join(temp, "coveapp");
  const env = { ...process.env, COVE_DATA_DIR: join(temp, "data") };
  const build = spawnSync(join(root, "scripts/go"), ["build", "-o", executable, "./cmd/coveapp"], {
    cwd: join(root, "services/local-service"), env, encoding: "utf8", timeout: 120_000,
  });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const fixture = (name) => join(root, "docs/examples/independent-mini-app", name);
  const first = fixture("travel-phrasebook-v1.0.coveapp");
  const second = fixture("travel-phrasebook-v1.1.coveapp");
  for (const args of [
    ["validate", first],
    ["validate", second],
    ["test", first, fixture("travel-phrasebook-v1.0.scenario.json")],
    ["test", second, fixture("travel-phrasebook-v1.1.scenario.json")],
    ["upgrade-test", first, second, fixture("travel-phrasebook-upgrade.json")],
  ]) {
    const result = spawnSync(executable, args, { env, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.stdout || result.error?.message}`);
  }
});
