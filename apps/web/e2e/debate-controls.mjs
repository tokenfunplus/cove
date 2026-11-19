import assert from "node:assert/strict";
import { markVisibleAction } from "./visible-action.mjs";

/** Runs only with the harness's synthetic Provider and disposable data. */
export async function runDebateControlsAcceptance({ api, cdp, evaluate, until, click, snapshot, reloadPage, profile, axeSource, requestCount }) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const scope = 'section[aria-label="Debate mode"]';
  async function action(label, selector = scope + " button") {
    assert(await markVisibleAction(cdp, selector, label, "data-controls-action"), "Missing action: " + label);
    await click('[data-controls-action="true"]');
    await evaluate(`document.querySelector('[data-controls-action]')?.removeAttribute('data-controls-action')`);
  }
  async function paused(id, turns) {
    for (let i = 0; i < 220; i++) {
      const view = await api("/api/debates/" + id);
      if (view.session.status === "paused" && view.session.total_turns === turns && view.turns.every(turn => turn.state !== "streaming")) return view;
      await pause(100);
    }
    throw new Error("Synthetic debate did not reach its budget/step pause");
  }
  async function accessible(selector) {
    await evaluate(axeSource);
    const findings = await evaluate(`axe.run(document.querySelector(${JSON.stringify(selector)}),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>r.violations.filter(v=>v.impact==='critical'||v.impact==='serious').map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))`);
    assert.deepEqual(findings, [], "Debate summary/settings accessibility findings");
  }
  const session = await api("/api/debates", "POST", {
    client_request_id: "controls-browser-fixture",
    topic: "Should a CTO keep writing production code?",
    seats: ["deepseek/fixture", "google/gemini-fixture"].map((model_id, i) => ({ provider_id: profile.id, model_id, role: i ? "Challenger" : "Advocate" })),
    rules: { version: 1, text: "Challenge a specific claim and state evidence gaps.", max_tokens: 512, checkpoint_every: 3, rotate: true },
    controls: { version: 0, summary_every: 3, summary_seat: 0, turn_delay_ms: 10, token_budget: 1792, auto_pause: true, rates: [{ input_per_million: 1, output_per_million: 4 }, { input_per_million: 1, output_per_million: 4 }] },
  });
  let view = await paused(session.id, 6);
  assert.equal(view.usage.calls, 7);
  assert.equal(view.usage.summary_calls, 1);
  assert.equal(view.usage.input_tokens + view.usage.output_tokens, 1792);
  assert.equal(view.usage.budget_status, "token_budget");
  assert(view.session.summary.new_ideas.length > 0);
  await reloadPage();
  await until(`!!document.querySelector('[aria-label="Debate usage"]') && document.querySelector('[aria-label="Debate transcript"]').textContent.includes('Stage summary')`);
  await accessible(scope);
  await snapshot("debate-summary-workspace-1440");
  await action("Turn 1", '[aria-label="Debate transcript"] article button');
  await until(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').textContent.includes('Turn 1')`);
  await action("", 'button[aria-label="Close turn details"]');
  await until(`!document.querySelector('[role="dialog"]')`);
  const beforeSettings = requestCount();
  await action("Budget & pace");
  await until(`!!document.querySelector('[role="dialog"]')`);
  await evaluate(`(()=>{const e=[...document.querySelectorAll('[role="dialog"] input[type="number"]')].find(e=>e.closest('label')?.textContent.includes('Token budget'));e.dataset.budgetInput='true'})()`);
  await click('[data-budget-input="true"]');
  await evaluate(`document.querySelector('[data-budget-input]').select()`);
  await cdp("Input.insertText", { text: "100000" });
  await click('[role="combobox"][aria-label="Turn interval"]');
  await action("5 seconds", '[role="option"]');
  await accessible('[role="dialog"]');
  await snapshot("debate-budget-settings-1440");
  await action("Save settings", '[role="dialog"] button');
  await until(`!document.querySelector('[role="dialog"]')`);
  view = await api("/api/debates/" + session.id);
  assert.equal(view.session.controls.token_budget, 100000);
  assert.equal(view.session.controls.turn_delay_ms, 5000);
  assert.equal(view.session.controls.version, 2);
  assert.equal(requestCount(), beforeSettings, "Settings must not start inference");
  await action("Step");
  await paused(session.id, 7);
  await click('button[aria-label="Enter Focus mode"]');
  await until(`document.querySelector('main').dataset.focusMode==='true'`);
  await snapshot("debate-summary-focus-1440");
  for (const width of [390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: true });
    await pause(200);
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), "Summary workspace overflow at " + width);
    await action("Budget & pace");
    assert(await evaluate(`(()=>{const e=document.querySelector('[role="dialog"]');return e.scrollWidth<=e.clientWidth})()`), "Budget settings overflow at " + width);
    await snapshot("debate-budget-settings-" + width);
    await action("", 'button[aria-label="Close debate settings"]');
    await until(`!document.querySelector('[role="dialog"]')`);
    await snapshot("debate-summary-focus-" + width);
  }
  await api("/api/debates/" + session.id + "/control", "POST", { action: "stop" });
  console.log("Debate summaries/budget acceptance passed: source citations, cumulative usage, automatic pause, settings, Step, Focus, and narrow layouts.");
}
