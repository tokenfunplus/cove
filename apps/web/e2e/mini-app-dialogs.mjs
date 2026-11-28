import assert from "node:assert/strict";

export async function runMiniAppDialogs({ packageFixtures, installPackageFixture, api, cdp, evaluate, until, click, fill, loadPage, origin, profile, requests, snapshot }) {
  const catalog = { packages: packageFixtures };
  const entry = catalog.packages.find((item) => item.app === "japanese-review-book" && item.version === "1.2.0");
  assert(entry);
  const release = await installPackageFixture(entry);
  const book = await api("/api/mini-apps/instances", "POST", { release_id: release.id, name: "Dialog recovery book", grants: release.package.capabilities });
  const [actionID, action] = Object.entries(release.package.actions).find(([, value]) => value.op === "generate");
  const page = release.package.pages.find((value) => value.actions.includes(actionID));
  const root = `/api/mini-apps/instances/${book.id}`;
  // Fault injection is confined to this browser page. No paid inference or
  // filesystem damage is needed to exercise the saved-result recovery UI.
  const injection = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const original = window.fetch;
    const root = ${JSON.stringify(root)};
    const fixture = window.__miniDialogFixture = { state: 'save_failed', blocked: false, discarded: [], admissions: 0 };
    const job = () => ({ id: 'dialog-result', action: ${JSON.stringify(actionID)}, state: fixture.state, pending_save: fixture.state === 'save_failed' });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      const method = init?.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET';
      if (path === root + '/tasks' && method === 'GET') return json({ tasks: fixture.blocked ? [] : [job()] });
      if (path === root + '/tasks/dialog-result') return json(job());
      if (path === root + '/tasks/dialog-result/discard-result') {
        fixture.discarded.push(path); fixture.state = 'cancelled'; return new Response(null, { status: 204 });
      }
      if (path === root + '/tasks' && method === 'POST' && fixture.blocked) {
        fixture.admissions++;
        return json({ error: { code: 'task_save_pending', message: 'An app output needs saving.', details: null, request_id: 'dialog-fixture' } }, 409);
      }
      if (path === '/api/mini-apps/activity' && fixture.blocked) {
        return json({ activity: [{ instance_id: ${JSON.stringify(book.id)}, instance_name: 'Dialog recovery book', status: 'save_failed', action: ${JSON.stringify(actionID)}, operation_id: 'blocked-result', time: 1 }] });
      }
      return original(input, init);
    };
  })()` });
  const goto = (path) => loadPage("Page.navigate", { url: origin + path });
  const button = async (name, scope = "body") => {
    const expression = `Array.from(document.querySelectorAll(${JSON.stringify(scope + " button")})).find(element => !element.disabled && element.getBoundingClientRect().width && element.textContent.trim() === ${JSON.stringify(name)})`;
    await until(`!!(${expression})`);
    await evaluate(`document.querySelector('[data-dialog-test-button]')?.removeAttribute('data-dialog-test-button'); (${expression}).setAttribute('data-dialog-test-button', '')`);
    await click("[data-dialog-test-button]");
  };
  async function assertTop(parentLayer, title, initialButton, name) {
    await until(`document.querySelector('.confirmation-dialog__panel')?.textContent.includes(${JSON.stringify(title)})`);
    const evidence = await evaluate(`(() => {
      const panel = document.querySelector('.confirmation-dialog__panel');
      const portal = panel.closest('[data-slot="dialog-portal"]');
      const parent = document.querySelector('[data-dialog-layer=${JSON.stringify(parentLayer)}]');
      const button = Array.from(panel.querySelectorAll('button')).find(element => element.textContent.trim() === ${JSON.stringify(initialButton)});
      const rect = button.getBoundingClientRect();
      return { top: Number(getComputedStyle(portal).zIndex), below: Number(getComputedStyle(parent).zIndex),
        focused: document.activeElement === button, pointer: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
    })()`);
    assert(evidence.top > evidence.below, "Computed CSS places confirmation above its Mini App dialog");
    assert.equal(evidence.pointer, true, "The visible confirmation receives pointer events");
    assert.equal(evidence.focused, true, "The confirmation receives the intended initial keyboard focus");
    for (let index = 0; index < 5; index++) {
      await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      assert(await evaluate("document.querySelector('.confirmation-dialog__panel').contains(document.activeElement)"), "Tab stays in the top confirmation");
    }
    await snapshot(name);
  }
  async function discardFrom(parentLayer, screenshotName) {
    await button("Discard unsaved result");
    await assertTop(parentLayer, "Discard this unsaved result?", "Cancel", screenshotName);
    await button("Cancel", ".confirmation-dialog__panel");
    await until("!document.querySelector('.confirmation-dialog__panel')");
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "Discard unsaved result", "Cancel returns focus to the original control");
    assert.equal(await evaluate("window.__miniDialogFixture.discarded.length"), 0, "Cancel preserves the unsaved output");
    await button("Discard unsaved result");
    await button("Discard result", ".confirmation-dialog__panel");
    await until("!document.querySelector('.confirmation-dialog__panel') && !document.querySelector('[aria-label=\"Unsaved task result\"]')");
    assert.equal(await evaluate("window.__miniDialogFixture.discarded.length"), 1, "One explicit confirmation discards the selected output once");
    assert(await evaluate(`!!document.querySelector('[data-dialog-layer=${JSON.stringify(parentLayer)}]')`), "Discard keeps the originating Mini App dialog open");
  }
  try {
    await goto(`/apps/${book.id}/${page.id}`);
    await button(action.title);
    await discardFrom("study", "mini-app-study-discard-confirmation");
    await goto("/");
    await until("!!document.querySelector('#generation-input')");
    await fill("#generation-input", "Keep my unsent recovery draft");
    await click('button[aria-label="Tools"]');
    await button("Mini Apps");
    const bookButton = `Array.from(document.querySelectorAll('[role=dialog] button')).find(element => element.querySelector('strong')?.textContent === 'Dialog recovery book')`;
    await until(`!!(${bookButton})`);
    await evaluate(`(${bookButton}).setAttribute('data-dialog-test-book', '')`);
    await click("[data-dialog-test-book]");
    await button(page.title);
    await button(action.title);
    await discardFrom("app", "mini-app-picker-discard-confirmation");
    await evaluate("window.__miniDialogFixture.blocked = true");
    await fill('[aria-label="Model task"] fieldset textarea, section[aria-label="Generate practice questions"] textarea', "A local recovery fixture");
    await evaluate(`Array.from(document.querySelectorAll('[aria-label="Model task"] label')).find(element => element.textContent.trim() === 'Only on this Mac').querySelector('input').setAttribute('data-dialog-test-local', '')`);
    await click("[data-dialog-test-local]");
    for (const value of [profile.id, "model-one"]) {
      const picker = `Array.from(document.querySelectorAll('[aria-label="Model task"] select')).find(element => Array.from(element.options).some(option => option.value === ${JSON.stringify(value)}))`;
      await until(`!!(${picker})`);
      await evaluate(`{ const select = ${picker}; select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); }`);
    }
    const before = requests.length;
    await button("Start model task");
    await until("!!Array.from(document.querySelectorAll('a')).find(element => element.textContent.trim() === 'Open Activity')");
    await evaluate("Array.from(document.querySelectorAll('a')).find(element => element.textContent.trim() === 'Open Activity').setAttribute('data-dialog-test-activity', '')");
    await click("[data-dialog-test-activity]");
    await until("location.pathname + location.search === '/apps?section=activity' && !document.querySelector('[data-dialog-layer=app]')");
    assert.equal(await evaluate("!!document.querySelector('.confirmation-dialog__panel')"), false);
    assert.equal(await evaluate("document.querySelector('#generation-input').value"), "Keep my unsent recovery draft");
    await evaluate("history.back()");
    await until("location.pathname === '/' && !!document.querySelector('[data-dialog-layer=app]')");
    assert.equal(await evaluate("document.querySelector('#generation-input').value"), "Keep my unsent recovery draft");
    await evaluate("history.forward()");
    await until("location.search === '?section=activity' && !document.querySelector('[data-dialog-layer=app]')");
    assert.equal(requests.length, before, "Recovery controls and navigation do not invoke a Provider");
    assert.equal(await evaluate("window.__miniDialogFixture.admissions"), 1);
    await snapshot("mini-app-activity-after-approved-navigation");
  } finally {
    await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  }
}
