import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { markVisibleAction } from "../apps/web/e2e/visible-action.mjs";

test("browser action labels and selectors remain CDP data across code and HTML delimiters", async () => {
  const label = "</script><script>injected=true</script>\"'\\\n\u2028\u2029end";
  const selector = 'button[data-label="quoted"]';
  const attributes = new Map();
  const environment = { injected: false, document: { querySelectorAll(value) {
    assert.equal(value, selector);
    return [{ textContent: label, getBoundingClientRect: () => ({ width: 20 }), setAttribute: (key, value) => attributes.set(key, value) }];
  } } };
  const calls = [];
  const cdp = async (method, params) => {
    calls.push(method);
    if (method === "Runtime.evaluate") return { result: { objectId: "fixture-window" } };
    if (method === "Runtime.releaseObject") return {};
    assert.equal(method, "Runtime.callFunctionOn");
    assert.equal(params.objectId, "fixture-window");
    assert(!params.functionDeclaration.includes(label));
    assert.deepEqual(params.arguments.map(argument => argument.value), [selector, label, "data-test-action"]);
    const fn = vm.runInNewContext(`(${params.functionDeclaration})`, environment);
    return { result: { value: fn(...params.arguments.map(argument => argument.value)) } };
  };
  assert.equal(await markVisibleAction(cdp, selector, label, "data-test-action"), true);
  assert.equal(environment.injected, false);
  assert.equal(attributes.get("data-test-action"), "true");
  assert.equal(calls.at(-1), "Runtime.releaseObject");
});

test("browser action lookup preserves a missing action and releases failed contexts", async () => {
  let released = 0;
  let fail = false;
  const cdp = async method => {
    if (method === "Runtime.evaluate") return { result: { objectId: "fixture-window" } };
    if (method === "Runtime.releaseObject") { released++; return {}; }
    return fail ? { exceptionDetails: {} } : { result: { value: false } };
  };
  assert.equal(await markVisibleAction(cdp, "button", "Missing", "data-test-action"), false);
  fail = true;
  await assert.rejects(markVisibleAction(cdp, "button", "Missing", "data-test-action"), /lookup failed/);
  assert.equal(released, 2);
});
