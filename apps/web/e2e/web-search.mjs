import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { markVisibleAction } from "./visible-action.mjs";

export async function runWebSearchAcceptance({ api, cdp, evaluate, until, click, snapshot, reloadPage, dataDir, requests, axeSource }) {
  async function button(text, selector = "button") {
    assert(await markVisibleAction(cdp, selector, text, "data-search-action"), "Missing search action: " + text);
    await click('[data-search-action="true"]');
    await evaluate("document.querySelector('[data-search-action]')?.removeAttribute('data-search-action')");
  }
  async function accessible() {
    await evaluate(axeSource);
    const violations = await evaluate("axe.run(document.querySelector('[role=dialog]'), {runOnly: {type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(result=>result.violations.filter(item=>item.impact==='serious'||item.impact==='critical').map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)})))");
    assert.deepEqual(violations, [], "Web search settings accessibility violations");
  }
  await click("#generation-input");
  await cdp("Input.insertText", { text: "Automatic research fixture" });
  await snapshot("web-search-composer");
  await click('button[aria-label="Web search"]');
  await until("!!document.querySelector('[role=dialog] [role=tab][aria-selected=true]#settings-tab-web-search')");
  await until("!!document.querySelector('[aria-label=\"Web search settings\"] input[type=password]')");
  await accessible();
  await snapshot("web-search-setup");
  assert(await evaluate("document.querySelector('[aria-label=\"Default search provider\"]').tagName === 'BUTTON'"));
  await click('[aria-label="Default search provider"]');
  await until("!!document.querySelector('[data-slot=select-content]')");
  await snapshot("web-search-provider-menu");
  for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until("!document.querySelector('[data-slot=select-content]')");
  assert(await evaluate("!!document.querySelector('[role=dialog]')"), "Escape closed Settings with its select menu");
  await click('[aria-label="Advanced settings"]');
  await click('[aria-label="Search depth"]');
  await until("!!document.querySelector('[data-slot=select-content]')");
  await snapshot("web-search-depth-menu");
  for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until("!document.querySelector('[data-slot=select-content]')");
  assert(await evaluate("(()=>{const h=document.querySelector('.settings-dialog__header').getBoundingClientRect();const p=document.querySelector('.settings-dialog__panel').getBoundingClientRect();return h.top>=p.top && h.bottom<=p.bottom})()"), "Advanced settings scrolled the dialog header out of view");
  await accessible();
  await snapshot("web-search-advanced");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await click('[aria-label="Search depth"]');
  await until("!!document.querySelector('[data-slot=select-content]')");
  assert(await evaluate("(()=>{const r=document.querySelector('[data-slot=select-content]').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()"), "Search menu exceeds narrow viewport");
  await snapshot("web-search-settings-mobile");
  for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await snapshot("web-search-settings-mobile-closed");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await until("document.documentElement.dataset.theme === 'dark'");
  await snapshot("web-search-settings-mobile-dark");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await until("document.documentElement.dataset.theme === 'light'");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });


  // Synthetic key admission avoids contacting any third-party search service.
  const file = path.join(dataDir, "insecure-test-provider-secrets.json");
  const secrets = JSON.parse(await readFile(file, "utf8"));
  secrets.secrets["cove-web-search-tavily"] = { value: "synthetic-search-key", version: 1 };
  await writeFile(file, JSON.stringify(secrets), { mode: 0o600 });
  await button("Save settings");
  await until("document.body.textContent.includes('Web search settings saved.')");
  await snapshot("web-search-settings-saved");
  await click('button[aria-label="Close settings"]');
  assert(await evaluate("document.querySelector('#generation-input').value === 'Automatic research fixture'"));
  assert(await evaluate("document.querySelector('button[aria-label=\"Web search\"]').getAttribute('aria-pressed') === 'true'"));
  await click('button[aria-label="Send message"]');
  await until("document.body.textContent.includes('Web search was available and was not used.')");
  assert(requests.some(request => request.tools?.length === 2), "Enabled turn did not advertise native web tools");
  await snapshot("web-search-unused");
  await reloadPage();
  await until("!!document.querySelector('button[aria-label=\"Web search\"]')");
  assert(await evaluate("document.querySelector('button[aria-label=\"Web search\"]').getAttribute('aria-pressed') === 'true'"));

  const conversation = await api("/api/conversations", "POST", { title: "Research references fixture" });
  const batch = await api(`/api/conversations/${conversation.id}/messages`, "POST", { client_request_id: randomUUID(), body: "Webpage source fixture", attachments: [{ name: "fixture.txt", data: Buffer.from("Saved synthetic webpage evidence.").toString("base64") }] });
  let saved;
  for (let attempt = 0; attempt < 100; attempt++) {
    saved = await api(`/api/generation-batches/${batch.id}`);
    if (saved.state === "completed") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(saved.state, "completed");
  const source = { ...saved.attachments[0], name: "Research evidence", web: { kind: "search_result", original_url: "https://fixture.example/article", final_url: "https://fixture.example/article", fetched_at: "2026-11-21T00:00:00Z", content_sha256: saved.attachments[0].id } };
  const db = new DatabaseSync(path.join(dataDir, "cove.sqlite"));
  try {
    db.function("cove_search_text", { deterministic: true }, value => Buffer.from(value).toString("utf8").toLowerCase().replaceAll("\u0000", "\ufffd"));
    db.prepare("UPDATE messages SET web_sources=? WHERE id=?").run(JSON.stringify([source]), saved.targets[0].generation.assistant_message_id);
    db.prepare("UPDATE generation_batches SET attachments=? WHERE id=?").run(JSON.stringify([source]), saved.id);
  } finally { db.close(); }
  await reloadPage();
  await until("document.body.textContent.includes('Research references fixture')");
  await button("Research references fixture");
  await until("!!document.querySelector('[aria-label=References]')");
  assert(await evaluate("document.querySelector('[aria-label=References]').textContent.includes('Search excerpt')"));
  assert(await evaluate("document.querySelector('button[aria-label=\"Web search\"]').getAttribute('aria-pressed') === 'false'"), "New conversation inherited the toggle");
  await snapshot("web-search-references-desktop");
  await click('[aria-label="References"] button');
  await until("!!document.querySelector('[role=dialog]')");
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Saved synthetic webpage evidence.')"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
  await snapshot("web-search-source-mobile");
  await button("Close", '[role="dialog"] button');
  assert(await evaluate("(()=>{const box=document.querySelector('.generation-composer__box').getBoundingClientRect();return [...document.querySelectorAll('.generation-composer__bar button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=box.left && r.right<=box.right && r.bottom<=box.bottom})})()"), "Composer tools exceed the narrow input box");
  await snapshot("web-search-composer-mobile");
}
