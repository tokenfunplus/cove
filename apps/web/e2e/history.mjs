import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Runs only against the harness's temporary database, fake Provider, and isolated browser. */
export async function runHistoryAcceptance({ api, cdp, evaluate, until, click, snapshot, reloadPage, profile, dataDir }) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function button(text, selector = "button") {
    const found = await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0);if(!e)return false;e.dataset.historyAction='true';return true})()`);
    assert(found, "History action is unavailable: " + text);
    await click('[data-history-action="true"]');
    await evaluate(`document.querySelector('[data-history-action]')?.removeAttribute('data-history-action')`);
  }
  async function choose(label, value) {
    await click(`[role="combobox"][aria-label="${label}"]`);
    await until(`!![...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()===${JSON.stringify(value)})`);
    await button(value, '[role="option"]');
  }
  async function escape() {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  }
  async function setSearch(value) {
    await click('input[aria-label="Search conversations"]');
    await evaluate(`document.querySelector('input[aria-label="Search conversations"]').select()`);
    await cdp("Input.insertText", { text: value });
  }
  async function waitPaused(id) {
    for (let i = 0; i < 80; i++) {
      const view = await api("/api/debates/" + id);
      if (view.session.status === "paused" && view.turns.every(turn => turn.state !== "streaming")) return;
      await pause(100);
    }
    throw new Error("History fixture did not pause");
  }
  async function debate(id, topic, status) {
    const created = await api("/api/debates", "POST", {
      client_request_id: id, topic,
      seats: ["model-one", "model-two"].map((model_id, index) => ({ provider_id: profile.id, model_id, role: index ? "Challenger" : "Advocate" })),
      rules: { version: 1, text: "State a concise public argument and a counterexample.", max_tokens: 512, checkpoint_every: 1, rotate: true },
    });
    if (status === "paused") {
      await api("/api/debates/" + created.id + "/control", "POST", { action: "pause" });
      await waitPaused(created.id);
    } else if (status === "stopped") await api("/api/debates/" + created.id + "/control", "POST", { action: "stop" });
    return created;
  }
  const recent = await api("/api/conversations", "POST", { title: "History recent chat" });
  const older = await api("/api/conversations", "POST", { title: "History older pinned chat" });
  await api("/api/conversations/" + older.id, "PATCH", { pinned: true });
  const oldDebate = await debate("history-older", "History older debate", "paused");
  await debate("history-stopped", "History stopped debate", "stopped");
  const archived = await debate("history-archived", "History archived debate", "stopped");
  await api("/api/conversations/" + archived.id, "PATCH", { archived: true });
  const db = new DatabaseSync(path.join(dataDir, "cove.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=3000");
    const oldTime = BigInt(Date.now() - 40 * 86400_000) * 1_000_000n;
    const update = db.prepare("UPDATE conversations SET updated_at=? WHERE id=?");
    for (const id of [older.id, oldDebate.id]) update.run(oldTime, id);
  } finally { db.close(); }
  const active = await debate("history-running", "History running debate", "running");
  await reloadPage();
  await until(`!!document.querySelector('.history-toolbar') && !![...document.querySelectorAll('.conversation')].find(e=>e.title==='History running debate'&&e.textContent.includes('Running'))`);
  assert(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.history-toolbar h2')).fontSize)<=14`), "History toolbar heading must stay compact");
  await button(recent.title, '.conversation');
  await until(`!!document.querySelector('#generation-input')`);
  await click("#generation-input");
  await cdp("Input.insertText", { text: "Preserve this open chat draft." });
  await evaluate(`void(globalThis.historyDraft=document.querySelector('#generation-input'))`);
  await snapshot("history-desktop");
  await click('button[aria-label="Filter history"]');
  await until(`!!document.querySelector('[data-slot="popover-content"]')`);
  await snapshot("history-filter-menu");
  await choose("Conversation type", "Debate");
  await choose("Last activity", "Last 7 days");
  await escape();
  await until(`!document.querySelector('[data-slot="popover-content"]')`);
  const titles = await evaluate(`[...document.querySelectorAll('.conversation')].map(e=>e.title)`);
  assert(titles.includes("History running debate") && titles.includes("History stopped debate"));
  assert(!titles.includes(older.title) && !titles.includes(oldDebate.topic) && !titles.includes(recent.title), "Type and activity must compose for pinned and ordinary history");
  assert(await evaluate(`document.querySelector('#generation-input')===historyDraft && historyDraft.value==='Preserve this open chat draft.'`), "History filtering navigated away from the draft");
  await snapshot("history-filtered");
  await setSearch("History running");
  await until(`document.querySelectorAll('.conversation-row').length===1 && document.querySelector('.conversation').title==='History running debate'`);
  await snapshot("history-filtered-search");
  await api("/api/debates/" + active.id + "/control", "POST", { action: "pause" });
  await waitPaused(active.id);
  await until(`document.querySelector('.conversation').textContent.includes('Paused')`);
  await setSearch("");
  await until(`document.querySelectorAll('.conversation-row').length===2`);
  await click("#generation-input");
  await evaluate(`document.querySelector('#generation-input').select()`);
  await cdp("Input.insertText", { text: "" });
  await until(`document.querySelector('#generation-input').value===''`);
  await reloadPage();
  await until(`!!document.querySelector('button[aria-label="Clear type filter"]') && document.querySelectorAll('.conversation-row').length===2`);
  await click('button[aria-label="Archived chats"]');
  await until(`document.querySelectorAll('.conversation-row').length===1 && document.querySelector('.conversation').title==='History archived debate'`);
  await snapshot("history-archived");
  await click('button[aria-label="All chats"]');
  await until(`document.querySelectorAll('.conversation-row').length===2`);
  await setSearch("no matching history fixture");
  await until(`document.body.textContent.includes('No conversations match these filters.')`);
  await snapshot("history-filter-empty");
  await setSearch("");
  await until(`document.querySelectorAll('.conversation-row').length===2`);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await until(`!!document.querySelector('button[aria-label="Expand sidebar"]')`);
  await click('button[aria-label="Expand sidebar"]');
  await until(`!!document.querySelector('#conversation-sidebar .history-toolbar')`);
  await click('button[aria-label="Filter history"]');
  await choose("Conversation type", "Chat");
  await snapshot("history-mobile-menu");
  await escape();
  await until(`!document.querySelector('[data-slot="popover-content"]')`);
  assert(await evaluate(`!!document.querySelector('#conversation-sidebar') && document.querySelector('.conversation').title==='History recent chat'`), "Mobile filtering dismissed its sidebar or lost its scope");
  await snapshot("history-mobile");
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), "History overflowed the mobile viewport");
  await click('button[aria-label="Filter history"]');
  await button("Reset filters", '[data-slot="popover-content"] button');
  await escape();
  await until(`!document.querySelector('[data-slot="popover-content"]')`);
  assert(await evaluate(`!document.querySelector('button[aria-label="Clear type filter"]') && [...document.querySelectorAll('.conversation')].some(e=>e.title==='History older pinned chat')`), "Reset must restore older pinned history");
}
