import assert from "node:assert/strict";

export async function runMiniAppScrollHistory({ api, cdp, evaluate, until, click, fill, loadPage, origin, snapshot }) {
  const source = (await api("/api/mini-apps/catalog")).packages.find((entry) => entry.app === "japanese-review-book" && entry.version === "1.2.0");
  const pkg = await api(`/api/mini-apps/catalog/${source.publisher}/${source.app}/${source.version}`);
  const entries = Array.from({ length: 24 }, (_, index) => ({
    ...source, publisher: "scroll-fixture", app: "notebook-" + String(index).padStart(2, "0"),
    name: "Scroll notebook " + String(index).padStart(2, "0"), digest: "scroll-fixture-" + index,
  }));
  // A page-local catalog fixture makes overflow deterministic without installing
  // anything or changing the service's real catalog and instance inventory.
  const injection = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    // Ordinary Back/Forward works without Navigation API support.
    Object.defineProperty(window, 'navigation', { value: undefined, configurable: true });
    const original = window.fetch, entries = ${JSON.stringify(entries)}, pkg = ${JSON.stringify(pkg)};
    window.fetch = (input, init) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      if (path === '/api/mini-apps/catalog') return Promise.resolve(new Response(JSON.stringify({ packages: entries }), { headers: { 'Content-Type': 'application/json' } }));
      const entry = entries.find(entry => path === '/api/mini-apps/catalog/' + entry.publisher + '/' + entry.app + '/' + entry.version);
      if (entry) return Promise.resolve(new Response(JSON.stringify({ ...pkg, publisher: entry.publisher, app: entry.app, name: entry.name }), { headers: { 'Content-Type': 'application/json', 'X-Cove-Package-Digest': entry.digest } }));
      return original(input, init);
    };
  })()` });
  const top = () => evaluate("document.querySelector('main.mini-app-shell').scrollTop");
  const waitTop = (value) => until(`Math.abs(document.querySelector('main.mini-app-shell').scrollTop - ${value}) < 2`);
  try {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 560, deviceScaleFactor: 1, mobile: false });
    await loadPage("Page.navigate", { url: origin + "/apps?section=catalog" });
    await until("document.querySelectorAll('#mini-app-catalog article').length === 24");
    const cover = '[data-app="scroll-fixture/notebook-23"] .mini-app-card-cover';
    await evaluate(`document.querySelector(${JSON.stringify(cover)}).scrollIntoView({ block: 'center' })`);
    await until("document.querySelector('main.mini-app-shell').scrollTop > 1000");
    const listTop = await top();
    await click(cover);
    await until("new URLSearchParams(location.search).has('app')");
    await waitTop(0);
    await evaluate("history.back()");
    await until("!new URLSearchParams(location.search).has('app')");
    await waitTop(listTop);
    await snapshot("mini-app-catalog-restored-scroll");
    assert.equal(await evaluate("!!Array.from(document.querySelectorAll('.mini-app-sidebar a')).find(node => node.textContent.trim() === 'Catalog settings')"), false);
    await click('main.mini-app-shell a[href="/"]');
    await until("!!document.querySelector('#generation-input')");
    await click('button[aria-label="New conversation"]');
    await fill("#generation-input", "Keep this draft across native fragment entries");
    await evaluate("location.hash = '#one'; location.hash = '#two'");
    await until("location.hash === '#two'");
    await evaluate("history.go(-3)");
    await until("!!document.querySelector('main.mini-app-shell')");
    await waitTop(listTop);
    assert.equal(await evaluate("!!document.querySelector('.confirmation-dialog__panel')"), false);
    assert.equal(await evaluate("document.querySelector('#generation-input').value"), "Keep this draft across native fragment entries");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: process.platform === "darwin" ? 4 : 2 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK" });
    await until("!!document.querySelector('[role=dialog] input')");
    assert(await evaluate("document.activeElement.closest('[role=dialog]') !== null"), "Only the visible workspace search receives the shortcut");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await evaluate("history.go(3)");
    await until("location.hash === '#two' && !document.querySelector('main.mini-app-shell')");
    assert.equal(await evaluate("document.querySelector('#generation-input').value"), "Keep this draft across native fragment entries");
    // Active generation ownership stays in the mounted Chat controller.
    await fill("#generation-input", "Slow fixture retained across Apps");
    await click('button[aria-label="Send message"]');
    await until("!!document.querySelector('button[aria-label=\"Stop generation\"]')");
    await evaluate("document.querySelector('#generation-input').dataset.retained = 'true'");
    await evaluate("history.go(-3)");
    await until("!!document.querySelector('main.mini-app-shell')");
    await until("!document.querySelector('button[aria-label=\"Stop generation\"]')");
    await evaluate("history.go(3)");
    await until("!document.querySelector('main.mini-app-shell')");
    assert.equal(await evaluate("document.querySelector('#generation-input').dataset.retained"), "true", "Chat DOM was retained, rather than rebuilt");
    assert(await evaluate("document.querySelector('.conversation')?.textContent.includes('Browser answer from model-one') || document.body.textContent.includes('Browser answer from model-one')"));
    assert.equal(await evaluate("!!history.state?.['cove.workspace-history.v1']"), false);
    await snapshot("mini-app-background-generation-complete");
  } finally {
    await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  }
}
