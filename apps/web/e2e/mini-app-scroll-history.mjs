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
    // Exercise the popstate/hashchange fallback used without Navigation API.
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
  const key = () => evaluate("history.state['cove.workspace-history.v1'].key");
  const button = async (label, scope = "main.mini-app-shell") => {
    const expression = `Array.from(document.querySelectorAll(${JSON.stringify(scope + " button")})).find(element => element.textContent.trim() === ${JSON.stringify(label)})`;
    await until(`!!(${expression})`);
    await evaluate(`(${expression}).setAttribute('data-scroll-history-button', '')`);
    await click("[data-scroll-history-button]");
  };
  try {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 560, deviceScaleFactor: 1, mobile: false });
    await loadPage("Page.navigate", { url: origin + "/apps?section=catalog" });
    await until("document.querySelectorAll('#mini-app-catalog article').length === 24");
    const listKey = await key();
    const cover = '[data-app="scroll-fixture/notebook-23"] .mini-app-card-cover';
    await evaluate(`document.querySelector(${JSON.stringify(cover)}).scrollIntoView({ block: 'center' })`);
    await until("document.querySelector('main.mini-app-shell').scrollTop > 1000");
    const listTop = await top();
    await snapshot("mini-app-catalog-before-history");
    await click(cover);
    await until("new URLSearchParams(location.search).get('app') === 'scroll-fixture/notebook-23'");
    await waitTop(0);
    const detailKey = await key();
    assert.notEqual(detailKey, listKey);
    await evaluate("document.querySelector('main.mini-app-shell').scrollTop = 300");
    await waitTop(300);
    const length = await evaluate("history.length");
    await evaluate("history.back()");
    await until("document.querySelectorAll('#mini-app-catalog article').length === 24");
    await waitTop(listTop);
    assert.equal(await key(), listKey, "Back restores the original catalog entry");
    assert.equal(await evaluate("history.length"), length, "Scroll restoration preserves browser history");
    await snapshot("mini-app-catalog-after-history-back");
    await evaluate("history.forward()");
    await until("new URLSearchParams(location.search).get('app') === 'scroll-fixture/notebook-23'");
    await waitTop(300);
    assert.equal(await key(), detailKey, "Forward restores the same detail entry and offset");
    await snapshot("mini-app-detail-after-history-forward");
    // Dispatch the existing navigation action without scrolling the header into
    // view first, so this also checks remounting at the current reading offset.
    await evaluate("document.querySelector('main.mini-app-shell a[href=\"/\"]').click()");
    await until("!!document.querySelector('#generation-input')");
    await evaluate("history.back()");
    await until("!!document.querySelector('main.mini-app-shell')");
    await waitTop(300);
    assert.equal(await key(), detailKey, "Returning from Chat restores the remounted Mini Apps main");
    await button("Back to Discover");
    await until("document.querySelectorAll('#mini-app-catalog article').length === 24");
    await waitTop(0);
    assert.notEqual(await key(), listKey, "A new visit to the same catalog URL starts at the top");
    await evaluate("history.go(-2)");
    await until("document.querySelectorAll('#mini-app-catalog article').length === 24");
    await waitTop(listTop);
    assert.equal(await key(), listKey, "A new same-URL visit does not overwrite the old entry's offset");
    await click('.mini-app-sidebar a[href="/apps?section=catalog"]');
    await waitTop(listTop);
    assert.equal(await key(), listKey, "Clicking the current catalog is a no-op for history and scroll");
    assert.equal(await evaluate("typeof window.navigation"), "undefined", "The fragment check exercises the native fallback");
    const beforeFragmentLength = await evaluate("history.length");
    const beforeFragmentEntry = await evaluate("history.state['cove.workspace-history.v1']");
    await evaluate("location.hash = '#native-scroll'");
    await until("location.hash === '#native-scroll' && history.state?.['cove.workspace-history.v1']?.key !== " + JSON.stringify(listKey));
    const fragmentKey = await key();
    const fragmentEntry = await evaluate("history.state['cove.workspace-history.v1']");
    assert((await evaluate("history.length")) <= beforeFragmentLength, "The native fragment replaced existing forward entries");
    assert.notEqual(fragmentEntry.lineage, beforeFragmentEntry.lineage, "A truncated-forward fragment has scroll identity without an inferred distance");
    await waitTop(listTop);
    await evaluate("document.querySelector('main.mini-app-shell').scrollTop = 1000");
    await waitTop(1000);
    await evaluate("history.back()");
    await until("location.hash === ''");
    await waitTop(listTop);
    assert.equal(await key(), listKey, "The original entry retains its pre-fragment position");
    await evaluate("history.forward()");
    await until("location.hash === '#native-scroll'");
    await waitTop(1000);
    assert.equal(await key(), fragmentKey, "A fragment stamped after popstate retains its own position");
    await snapshot("mini-app-native-fragment-after-history-forward");

    await loadPage("Page.navigate", { url: origin + "/apps" });
    await until("!!document.querySelector('main.mini-app-shell') && !!history.state?.['cove.workspace-history.v1']");
    const apps = await evaluate("history.state['cove.workspace-history.v1']");
    await click('main.mini-app-shell a[href="/"]');
    await until("!!document.querySelector('button[aria-label=\"New conversation\"]')");
    await click('button[aria-label="New conversation"]');
    await fill("#generation-input", "Keep my coalesced fallback draft");
    const chat = await evaluate("history.state['cove.workspace-history.v1']");
    await evaluate("location.hash = '#one'; location.hash = '#two'");
    await until("location.hash === '#two' && !!history.state?.['cove.workspace-history.v1'] && history.state['cove.workspace-history.v1'].key !== " + JSON.stringify(chat.key));
    const latest = await evaluate("history.state['cove.workspace-history.v1']");
    assert.equal(latest.index, chat.index + 2, "A complete coalesced push chain has a proven distance");
    const fragmentLength = await evaluate("history.length");
    const atKey = (entry) => "history.state?.['cove.workspace-history.v1']?.key === " + JSON.stringify(entry.key);
    await evaluate("history.go(-3)");
    await until("document.querySelector('.confirmation-dialog__panel')?.textContent.includes('Discard unsent draft?')");
    await until(atKey(latest));
    await snapshot("mini-app-coalesced-fallback-confirmation");
    await button("Stay", ".confirmation-dialog__panel");
    assert.equal(await evaluate("document.querySelector('#generation-input').value"), "Keep my coalesced fallback draft");
    await evaluate("history.back()");
    await until("location.hash === '#one' && !!history.state?.['cove.workspace-history.v1']");
    const intermediate = await evaluate("history.state['cove.workspace-history.v1']");
    assert.notEqual(intermediate.lineage, chat.lineage, "An intermediate entry gets identity without guessing its position");
    await evaluate("history.go(-2)");
    await until("!!document.querySelector('.confirmation-dialog__panel')");
    await until(atKey(chat));
    await button("Stay", ".confirmation-dialog__panel");
    for (const entry of [intermediate, latest]) {
      await evaluate("history.forward()");
      await until(atKey(entry));
    }
    await evaluate("history.go(-3)");
    await until("!!document.querySelector('.confirmation-dialog__panel')");
    await until(atKey(latest));
    await button("Discard and continue", ".confirmation-dialog__panel");
    await until("!!document.querySelector('main.mini-app-shell')");
    assert.equal(await key(), apps.key, "Declining and later approving leave retains the exact Apps destination");
    assert.equal(await evaluate("history.length"), fragmentLength);
    for (const entry of [chat, intermediate, latest]) {
      await evaluate("history.forward()");
      await until(atKey(entry));
    }
    assert.equal(await evaluate("history.length"), fragmentLength, "Coalesced fallback preserves all physical entries");
    await snapshot("mini-app-coalesced-fallback-after-forward");

    await loadPage("Page.navigate", { url: origin + "/apps" });
    await until("!!document.querySelector('main.mini-app-shell') && !!history.state?.['cove.workspace-history.v1']");
    const reloadApps = await evaluate("history.state['cove.workspace-history.v1']");
    await click('main.mini-app-shell a[href="/"]');
    await until("!!document.querySelector('button[aria-label=\"New conversation\"]')");
    await click('button[aria-label="New conversation"]');
    const reloadChat = await evaluate("history.state['cove.workspace-history.v1']");
    const reloadChatURL = await evaluate("location.href");
    await click('a[aria-label="Mini Apps"]');
    await until("!!document.querySelector('main.mini-app-shell')");
    await evaluate("history.back()");
    await until(atKey(reloadChat));
    await until("!!document.querySelector('#generation-input')");
    const reloadLength = await evaluate("history.length");
    await evaluate("location.hash = '#reload-fragment'");
    await until("location.hash === '#reload-fragment' && !!history.state?.['cove.workspace-history.v1']?.chatOrigin");
    const reloadFragment = await evaluate("history.state['cove.workspace-history.v1']");
    assert.notEqual(reloadFragment.lineage, reloadChat.lineage);
    assert.equal(await evaluate("history.length"), reloadLength, "The fragment truncates the one-entry forward tail");
    assert.deepEqual(reloadFragment.chatOrigin, {
      entry: { lineage: reloadChat.lineage, index: reloadChat.index, key: reloadChat.key }, href: reloadChatURL,
    });
    await loadPage("Page.reload");
    await until("!!document.querySelector('#generation-input')");
    assert.equal(await key(), reloadFragment.key, "Reload preserves the fragment identity and compact origin hint");
    await fill("#generation-input", "New draft after fragment reload");
    await evaluate("history.go(-2)");
    await until("!!document.querySelector('.confirmation-dialog__panel')");
    await until(atKey(reloadChat));
    await snapshot("mini-app-reloaded-fragment-confirmation");
    await button("Stay", ".confirmation-dialog__panel");
    assert.equal(await evaluate("document.querySelector('#generation-input').value"), "New draft after fragment reload");
    await evaluate("history.back()");
    await until("!!document.querySelector('.confirmation-dialog__panel')");
    await until(atKey(reloadChat));
    await button("Discard and continue", ".confirmation-dialog__panel");
    await until("!!document.querySelector('main.mini-app-shell')");
    assert.equal(await key(), reloadApps.key, "Reload recovery keeps the original Apps destination");
    assert.equal(await evaluate("history.length"), reloadLength);
    await evaluate("history.go(2)");
    await until(atKey(reloadFragment));
    assert.equal(await evaluate("history.length"), reloadLength, "Reload recovery preserves every physical history entry");
    await snapshot("mini-app-reloaded-fragment-after-forward");
  } finally {
    await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  }
}
