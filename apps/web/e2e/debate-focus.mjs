import assert from "node:assert/strict";

/** Synthetic Provider only; uses the harness's isolated data and browser profile. */
export async function runDebateFocusAcceptance({ api, cdp, evaluate, until, click, snapshot, reloadPage, profile, requestCount }) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const scope = 'section[aria-label="Debate mode"]';
  async function action(text) {
    const found = await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0);if(!e)return false;e.dataset.debateAction='true';return true})()`);
    assert(found, "Visible debate action missing: " + text);
    await click('[data-debate-action="true"]');
    await evaluate(`document.querySelector('[data-debate-action]')?.removeAttribute('data-debate-action')`);
  }
  async function escape() {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  }
  async function waitPaused(id) {
    for (let i = 0; i < 100; i++) {
      const view = await api("/api/debates/" + id);
      if (view.session.status === "paused" && view.turns.every(turn => turn.state !== "streaming")) return view;
      await pause(100);
    }
    throw new Error("Synthetic debate did not pause");
  }
  const session = await api("/api/debates", "POST", {
    client_request_id: "focus-browser-fixture",
    topic: "Should a CTO keep writing production code?",
    seats: ["deepseek/fixture", "google/gemini-fixture"].map((model_id, index) => ({ provider_id: profile.id, model_id, role: index ? "Challenger" : "Advocate" })),
    rules: { version: 1, text: "Challenge a specific claim. Distinguish assumptions from evidence. Add a new argument each turn.", max_tokens: 512, checkpoint_every: 1, rotate: true },
  });
  for (let i = 0; i < 160; i++) {
    const view = await api("/api/debates/" + session.id);
    if (view.session.total_turns >= 6) break;
    await pause(100);
    if (i === 159) throw new Error("Synthetic debate did not produce its reading fixture");
  }
  await api("/api/debates/" + session.id + "/control", "POST", { action: "pause" });
  await waitPaused(session.id);
  await reloadPage();
  await until(`!!document.querySelector(${JSON.stringify(scope + " article")})`);
  await snapshot("debate-workspace-1440");
  const normal = await evaluate(`document.querySelector('[aria-label="Debate transcript"]').getBoundingClientRect().toJSON()`);
  await click("#debate-intervention");
  await cdp("Input.insertText", { text: "Consider a team of thirty engineers." });
  await evaluate(`void(globalThis.originalDebateInput=document.querySelector('#debate-intervention'))`);
  const beforeFocus = requestCount();
  await click('button[aria-label="Enter Focus mode"]');
  await until(`document.querySelector('main').dataset.focusMode==='true'`);
  const focused = await evaluate(`({transcript:document.querySelector('[aria-label="Debate transcript"]').getBoundingClientRect().toJSON(),sidebar:getComputedStyle(document.querySelector('#conversation-sidebar')).display,brief:getComputedStyle(document.querySelector('aside[aria-label="Live brief"]')).display,participants:document.querySelectorAll('[aria-label="Debate participants"] [role="listitem"]').length})`);
  assert(focused.transcript.width > normal.width + 150, "Focus must give the debate more visual space");
  assert(focused.transcript.height >= normal.height, "Focus must preserve transcript height");
  assert.equal(focused.sidebar, "none");
  assert.equal(focused.brief, "none");
  assert.equal(focused.participants, 2);
  assert(await evaluate(`parseFloat(getComputedStyle(document.querySelector('[aria-label="Debate transcript"] article .message__markdown')).fontSize)>=17`), "Focused desktop answers must use the reading typography");
  await snapshot("debate-focus-light-1440");
  await action("Live brief");
  await until(`!!document.querySelector('[role="dialog"]')`);
  await escape();
  await until(`!document.querySelector('[role="dialog"]')`);
  assert.equal(await evaluate(`document.querySelector('main').dataset.focusMode`), "true", "Dialog Escape must keep Focus");
  await escape();
  await until(`!document.querySelector('main').dataset.focusMode`);
  await until(`document.activeElement===document.querySelector('button[aria-label="Enter Focus mode"]')`);
  assert(await evaluate(`document.querySelector('#debate-intervention')===globalThis.originalDebateInput && originalDebateInput.value==='Consider a team of thirty engineers.'`), "Focus must preserve the intervention draft and its input");
  assert.equal(requestCount(), beforeFocus, "Focus transitions must not schedule inference");
  // Keep the same first visible turn when its width and typography change.
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="Debate transcript"]');e.scrollTop=e.querySelectorAll('article')[2].offsetTop-e.querySelector('article').offsetTop+25;e.dispatchEvent(new Event('scroll'));const top=e.getBoundingClientRect().top;const turn=[...e.querySelectorAll('article')].find(t=>t.getBoundingClientRect().bottom>top);globalThis.debateAnchor={id:turn.id,offset:turn.getBoundingClientRect().top-top};})()`);
  await click('button[aria-label="Enter Focus mode"]');
  await until(`document.querySelector('main').dataset.focusMode==='true'`);
  const drift = await evaluate(`document.getElementById(debateAnchor.id).getBoundingClientRect().top-document.querySelector('[aria-label="Debate transcript"]').getBoundingClientRect().top-debateAnchor.offset`);
  assert(Math.abs(drift) < 3, "Focus moved the reader's current turn: " + drift);
  await action("Step");
  await until(`!!document.querySelector('[data-active-speaker="true"]')`);
  await snapshot("debate-focus-speaking-1440");
  await waitPaused(session.id);
  await until(`!![...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(e=>e.textContent.trim()==='Resume')`);
  assert.equal(requestCount(), beforeFocus + 1, "One Step must run exactly one Provider turn");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await until(`document.documentElement.dataset.theme==='dark'`);
  await snapshot("debate-focus-dark-1440");
  for (const width of [390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 740, deviceScaleFactor: 1, mobile: true });
    const layout = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,exit:document.querySelector('.workspace__focus-exit').getBoundingClientRect().toJSON(),input:document.querySelector('#debate-intervention').closest('form').getBoundingClientRect().toJSON(),transcript:document.querySelector('[aria-label="Debate transcript"]').getBoundingClientRect().toJSON()})`);
    assert(layout.scroll <= width + 1, "Debate overflows horizontally at " + width);
    assert(layout.exit.right <= width && layout.input.bottom <= (width === 390 ? 844 : 740), "Focus controls leave the viewport at " + width);
    assert(layout.transcript.height > 100, "Debate needs readable transcript space at " + width);
    assert(await evaluate(`parseFloat(getComputedStyle(document.querySelector('[aria-label="Debate transcript"] article .message__markdown')).fontSize)>=16`), "Focused mobile answers must remain readable");
    await snapshot("debate-focus-dark-" + width);
  }
  await api("/api/debates/" + session.id + "/control", "POST", { action: "stop" });
}
