import assert from "node:assert/strict";

export async function runMiniAppScrollHistory({ packageFixtures, installPackageFixture, api, cdp, evaluate, until, click, fill, loadPage, origin, snapshot }) {
  const source = packageFixtures.find((entry) => entry.app === "japanese-review-book" && entry.version === "1.2.0");
  const release = await installPackageFixture(source);
  const books = [];
  // Populate only this harness's disposable instance store. The long local list
  // exercises scroll restoration without putting public-market browsing in Cove.
  for (let index = 0; index < 24; index++) {
    books.push(await api("/api/mini-apps/instances", "POST", {
      release_id: release.id,
      name: "Scroll notebook " + String(index).padStart(2, "0"),
      grants: release.package.capabilities,
    }));
  }
  const injection = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    // Ordinary Back/Forward needs no Navigation API support.
    Object.defineProperty(window, 'navigation', { value: undefined, configurable: true });
  })()` });
  const top = () => evaluate("document.querySelector('main.mini-app-shell').scrollTop");
  const waitTop = (value) => until(`Math.abs(document.querySelector('main.mini-app-shell').scrollTop - ${value}) < 2`);
  try {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 560, deviceScaleFactor: 1, mobile: false });
    await loadPage("Page.navigate", { url: origin + "/apps" });
    await until("Array.from(document.querySelectorAll('main.mini-app-shell button strong')).filter(element=>element.textContent.startsWith('Scroll notebook')).length === 24");
    const lastName = await evaluate("Array.from(document.querySelectorAll('main.mini-app-shell button strong')).filter(element=>element.textContent.startsWith('Scroll notebook')).at(-1).textContent");
    const selectedBook = books.find((book) => book.name === lastName);
    assert(selectedBook);
    await evaluate("Array.from(document.querySelectorAll('main.mini-app-shell button')).find(element=>element.querySelector('strong')?.textContent===" + JSON.stringify(lastName) + ").setAttribute('data-scroll-history-card', '')");
    const cover = '[data-scroll-history-card]';
    await evaluate(`document.querySelector(${JSON.stringify(cover)}).scrollIntoView({ block: 'center' })`);
    await until("document.querySelector('main.mini-app-shell').scrollTop > 1000");
    const listTop = await top();
    await click(cover);
    await until("location.pathname === " + JSON.stringify("/apps/" + selectedBook.id));
    await until("!!document.querySelector('[aria-label=\"Instance attachments\"] input[type=file]') && document.querySelector('main.mini-app-shell').scrollHeight - document.querySelector('main.mini-app-shell').clientHeight >= 300");
    await waitTop(0);
    await evaluate("document.querySelector('main.mini-app-shell').scrollTop = 300");
    await waitTop(300);
    const length = await evaluate("history.length");
    await evaluate("history.back()");
    await until("location.pathname === '/apps'");
    await waitTop(listTop);
    await evaluate("history.forward()");
    await until("location.pathname === " + JSON.stringify("/apps/" + selectedBook.id));
    await waitTop(300);
    await evaluate("history.back()");
    await until("location.pathname === '/apps'");
    await waitTop(listTop);
    assert.equal(await evaluate("history.length"), length);
    assert(await evaluate("!!document.querySelector('.mini-app-sidebar a[href=\"https://www.hicove.io/apps\"]')"));
    assert.equal(await evaluate("!!document.querySelector('#mini-app-catalog')"), false);
    await snapshot("mini-app-list-restored-scroll");
    await evaluate('document.querySelector(\'main.mini-app-shell a[href="/"]\').click()');
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
