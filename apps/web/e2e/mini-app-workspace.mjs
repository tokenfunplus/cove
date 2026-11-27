import assert from "node:assert/strict";

export async function runMiniAppWorkspace({
  api,
  goto,
  button,
  evaluate,
  until,
  fill,
  click,
  cdp,
}) {
  await goto("/apps?section=activity");
  await until(
    "document.querySelector('#mini-app-activity')?.open && document.querySelectorAll('#mini-app-activity li').length>0",
  );
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "k",
    code: "KeyK",
    modifiers: 4,
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "k",
    code: "KeyK",
    modifiers: 4,
  });
  await until(
    "!!document.querySelector('[role=dialog] input[aria-label=\"App or page\"]')",
  );
  await fill('[aria-label="App or page"]', "Agent packages");
  await evaluate(
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(button=>button.textContent.startsWith('Agent packages')).click()",
  );
  await until("document.querySelector('#mini-app-agent')?.open");
  const example =
    "Array.from(document.querySelectorAll('#mini-app-agent button')).find(button=>button.textContent.startsWith('Load Japanese Review Book example'))";
  await until("!!(" + example + ")");
  await evaluate("(" + example + ").click()");
  await until(
    "document.querySelector('#mini-app-agent textarea').value.includes('japanese-review-book')",
  );
  const sample = JSON.parse(
    await evaluate("document.querySelector('#mini-app-agent textarea').value"),
  );
  sample.publisher = "workspace-fixture";
  sample.app = "editor-notes";
  sample.name = "Editor notebook";
  const raw = JSON.stringify(sample, null, 2);
  await fill("#mini-app-agent textarea", raw);
  await button("Validate and preview package", "#mini-app-agent");
  await until(
    "Array.from(document.querySelectorAll('h2')).some(h=>h.textContent==='Editor notebook')",
  );
  await button("Cancel");
  assert.equal(
    await evaluate("document.querySelector('#mini-app-agent textarea').value"),
    raw,
    "Canceling installation preserves the edited package source",
  );
  await evaluate("document.querySelector('#mini-app-agent').open=true");
  await button("Validate and preview package", "#mini-app-agent");
  await button("Install package only");
  const releases = await api("/api/mini-apps/packages");
  const release = releases.packages.find(
    (item) =>
      item.package.publisher === sample.publisher &&
      item.package.app === sample.app,
  );
  assert(release);
  await fill(
    'input[placeholder="Apps, instances or publishers"]',
    "Editor notebook",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('strong')).find(item=>item.textContent==='Editor notebook').parentElement.parentElement.setAttribute('data-editor-package','')",
  );
  await button("Remove package", "[data-editor-package]");
  await button("Confirm package removal", "[data-editor-package]");
  await until("!document.querySelector('[data-editor-package]')");
  assert(
    !(await api("/api/mini-apps/packages")).packages.some(
      (item) => item.id === release.id,
    ),
  );
  await fill(
    'input[placeholder="Apps, instances or publishers"]',
    "Kana practice",
  );
  assert(await evaluate("document.body.textContent.includes('Kana practice')"));
}
