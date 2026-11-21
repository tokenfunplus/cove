import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { markVisibleAction } from "./visible-action.mjs";

/** Checks UI and saved-source navigation against the isolated synthetic service. */
export async function runWebSourcesAcceptance({ api, cdp, evaluate, until, click, snapshot, reloadPage, dataDir }) {
  async function button(text, selector = "button") {
    assert(await markVisibleAction(cdp, selector, text, "data-web-action"), "Missing webpage action: " + text);
    await click('[data-web-action="true"]');
    await evaluate("document.querySelector('[data-web-action]')?.removeAttribute('data-web-action')");
  }

  await button("Read webpage");
  await until("!!document.querySelector('[role=dialog] input[type=url]')");
  await click('[role="dialog"] input[type="url"]');
  await cdp("Input.insertText", { text: "http://127.0.0.1/private" });
  await snapshot("webpage-reader-dialog");
  await button("Read webpage", '[role="dialog"] button');
  await until("document.body.textContent.includes('Webpage reading requires a public internet address.')");
  await snapshot("webpage-reader-error");
  await click('button[aria-label="Remove attachment: http://127.0.0.1/private"]');

  const conversation = await api("/api/conversations", "POST", { title: "Saved webpage fixture" });
  const batch = await api(`/api/conversations/${conversation.id}/messages`, "POST", {
    client_request_id: randomUUID(),
    body: "Webpage source fixture",
    attachments: [{ name: "fixture.txt", data: Buffer.from("Saved synthetic webpage evidence.").toString("base64") }],
  });
  let saved;
  for (let attempt = 0; attempt < 100; attempt++) {
    saved = await api(`/api/generation-batches/${batch.id}`);
    if (saved.state === "completed") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(saved.state, "completed");

  // Seed only the harness's disposable database with a captured webpage record.
  const source = saved.attachments[0];
  source.name = "Fixture webpage.html";
  source.media_type = "text/html";
  source.extraction_version = "cove-web-readability-v1";
  source.web = {
    original_url: "https://fixture.example/article",
    final_url: "https://fixture.example/article",
    fetched_at: "2026-11-20T08:00:00Z",
    content_sha256: source.id,
  };
  const db = new DatabaseSync(path.join(dataDir, "cove.sqlite"));
  try {
    db.prepare("UPDATE generation_batches SET attachments = ? WHERE id = ?").run(JSON.stringify([source]), batch.id);
  } finally {
    db.close();
  }

  await reloadPage();
  await until("document.body.textContent.includes('Saved webpage fixture')");
  await button("Saved webpage fixture");
  await until("document.body.textContent.includes('View evidence')");
  await button("View evidence");
  await until("document.body.textContent.includes('Open original webpage')");
  assert(await evaluate("!![...document.querySelectorAll('[role=dialog] a')].find(e => e.href === 'https://fixture.example/article')"));
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Saved synthetic webpage evidence.')"));
  await snapshot("webpage-source-desktop");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
  await snapshot("webpage-source-mobile");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await snapshot("webpage-source-mobile-dark");
}
