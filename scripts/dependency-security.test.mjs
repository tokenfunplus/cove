import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { patchedAdvisory, patchedAdvisoryUpdated, patchedPackages, reviewAuditReport, verifyDependencyPatches } from "./audit-dependencies.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const verification = verifyDependencyPatches();
const picomatch = verification.copies.find(copy => copy.name === "picomatch").directory;
const rollup = verification.copies.find(copy => copy.name === "rollup").directory;
const require = createRequire(path.join(picomatch, "package.json"));
const pm = require(picomatch);
const dangerous = ["+(*a)", "+(*)", "*(*a)", "+(*[ab])", "+(@(*a))", "+([ab]+)", "+(ab|abab)", "+(\\w|aa)", "+(\\x61|aa)", '+("a"|a)'];

test("repeated-extglob attacks terminate through the public matcher, including alternate encodings and flags", () => {
  const code = `
    const assert = require('node:assert/strict');
    const pm = require(${JSON.stringify(picomatch)});
    for (const pattern of ${JSON.stringify(dangerous)}) {
      for (const options of [{}, {capture:true}, {maxExtglobRecursion:false}]) {
        assert.equal(pm.isMatch('a'.repeat(45)+'!',pattern,options),false);
      }
    }
    for (const options of [{nocase:true},{nocase:true,flags:''},{flags:'i'},{flags:'iu'}]) {
      assert.equal(pm.isMatch('a'.repeat(45)+'!','+(a|AA)',options),false);
      assert.equal(pm.isMatch('k'.repeat(45)+'!','+(\\u212A|kk)',options),false);
    }
    for (const [pattern, options, input] of ${JSON.stringify([
      [String.raw`+(a\+)`, { unescape: true }, "a".repeat(45) + "!"],
      [String.raw`+(a/|a\\)`, { windows: true }, "a\\".repeat(45) + "!"],
    ])}) assert.equal(pm.makeRe(pattern, options).test(input), false);
    assert.equal(pm.makeRe('pre+(*a)post').test('pre+(*a)post'),true);
  `;
  const result = spawnSync(process.execPath, ["-e", code], { timeout: 3000, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("ordinary project globs, escapes, negation, literal extglobs and Vite filtering keep their behavior", async () => {
  for (const [pattern, input, expected] of [
    ["**/*.{ts,tsx}", "src/App.tsx", true], ["**/*.{ts,tsx}", "src/app.js", false],
    ["**/*.ts", ".config/options.ts", true], ["!(*.test).ts", "app.ts", true],
    ["!(*.test).ts", "app.test.ts", false], ["+(foo|bar)", "foobarfoo", true],
    ["+(foo|bar)", "baz", false], ["a\\*b.ts", "a*b.ts", true],
    ["+(*(a)|*(b))", "abba", true],
  ]) assert.equal(pm.isMatch(input, pattern, { dot: true }), expected, pattern);
  assert.equal(pm.scan("src/**/*.tsx").base, "src");
  const web = createRequire(path.join(root, "apps/web/package.json"));
  const vite = await import(web.resolve("vite"));
  const filter = vite.createFilter(["**/*.{ts,tsx}"], ["**/*.test.*"]);
  assert.equal(filter("/fixture/src/App.tsx"), true);
  assert.equal(filter("/fixture/src/App.test.tsx"), false);
  assert.equal(filter("/fixture/src/app.js"), false);
});

test("every bundled Rollup analyzer applies the same guard", () => {
  let count = 0;
  for (const file of Object.keys(patchedPackages.rollup.files)) {
    const source = readFileSync(path.join(rollup, file), "utf8");
    const pattern = /const analyzeRepeatedExtglob = \(body, options\) => \{[\s\S]+?\n[ \t]*\};/g;
    for (const match of source.matchAll(pattern)) {
      const begin = source.lastIndexOf("const splitTopLevel =", match.index);
      assert(begin >= 0);
      const analyze = vm.runInNewContext(source.slice(begin, match.index + match[0].length) + "\nanalyzeRepeatedExtglob", {
        constants: require(path.join(picomatch, "lib/constants.js")),
        utils: require(path.join(picomatch, "lib/utils.js")),
      }, { timeout: 1000 });
      for (const body of ["*a", "*", "[ab]+", "\\w|aa", "ab|abab"]) assert.equal(analyze(body, {}).risky, true, `${file}: ${body}`);
      assert.equal(analyze(String.raw`a\+`, { unescape: true }).risky, true);
      assert.equal(analyze(String.raw`a/|a\\`, { windows: true }).risky, true);
      assert.equal(analyze("a|AA", { nocase: true }).risky, true);
      assert.equal(analyze("foo|bar", {}).risky, false);
      count += 1;
    }
  }
  assert.equal(count, 6);
});

function makeReport(...advisories) {
  const vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const advisory of advisories) vulnerabilities[advisory.severity] += 1;
  return { advisories: Object.fromEntries(advisories.map((a, i) => [i, a])), muted: [], metadata: { vulnerabilities } };
}
const reported = {
  module_name: "picomatch", severity: "high", url: `https://github.com/advisories/${patchedAdvisory}`,
  github_advisory_id: patchedAdvisory, updated: patchedAdvisoryUpdated,
  vulnerable_versions: "<=4.0.7", patched_versions: "<0.0.0", cves: ["CVE-2026-112366"],
  findings: [{ version: "4.0.7" }],
};

test("the audit gate requires verified patches and continues blocking other moderate/high advisories", () => {
  assert.equal(reviewAuditReport(makeReport(reported)).blocking.length, 1);
  assert.equal(reviewAuditReport(makeReport(reported), { copies: [] }).blocking.length, 1);
  assert.equal(reviewAuditReport(makeReport(reported), verification).blocking.length, 0);
  for (const severity of ["moderate", "high", "critical"]) {
    const other = { ...reported, url: "https://github.com/advisories/GHSA-other", severity };
    assert.equal(reviewAuditReport(makeReport(reported, other), verification).blocking.length, 1);
  }
  for (const changed of [
    { ...reported, updated: "2026-11-19T00:00:00.000Z" },
    { ...reported, findings: [{ version: "4.0.6" }] },
    { ...reported, module_name: "other-package" },
  ]) assert.equal(reviewAuditReport(makeReport(changed), verification).blocking.length, 1);
  assert.throws(() => reviewAuditReport({ error: "registry unavailable" }, verification), /complete audit/);
  assert.throws(() => reviewAuditReport({ ...makeReport(reported), advisories: {} }, verification), /summary/);
  assert.throws(() => reviewAuditReport({ ...makeReport(reported), muted: [reported] }, verification), /muted/);
});

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cove-dependency-patch-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ dependencies: { picomatch: "4.0.7", rollup: "4.63.1" } }));
  copyFileSync(path.join(root, "pnpm-lock.yaml"), path.join(directory, "pnpm-lock.yaml"));
  for (const name of Object.keys(patchedPackages)) {
    const target = path.join(directory, "node_modules", name);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "package.json"), JSON.stringify({ name, version: patchedPackages[name].version }));
    for (const file of Object.keys(patchedPackages[name].files)) {
      const destination = path.join(target, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(path.join(verification.copies.find(copy => copy.name === name).directory, file), destination);
    }
  }
  return directory;
}

test("missing, modified, additional or differently versioned copies fail closed", t => {
  const directory = fixture(t);
  assert.equal(verifyDependencyPatches(directory).copies.length, 2);
  const parser = path.join(directory, "node_modules/picomatch/lib/parse.js");
  const original = readFileSync(parser);
  writeFileSync(parser, "unpatched");
  assert.throws(() => verifyDependencyPatches(directory), /unpatched/);
  writeFileSync(parser, original);
  const nested = path.join(directory, "node_modules/rollup/node_modules/picomatch");
  mkdirSync(nested, { recursive: true });
  writeFileSync(path.join(nested, "package.json"), JSON.stringify({ name: "picomatch", version: "4.0.6" }));
  writeFileSync(path.join(directory, "node_modules/rollup/package.json"), JSON.stringify({ name: "rollup", version: "4.63.1", dependencies: { picomatch: "4.0.6" } }));
  assert.throws(() => verifyDependencyPatches(directory), /unexpected version/);
  writeFileSync(path.join(directory, "pnpm-lock.yaml"), "changed inventory");
  assert.throws(() => verifyDependencyPatches(directory), /inventory changed/);
});
