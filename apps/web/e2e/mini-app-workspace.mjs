import assert from "node:assert/strict";
import { checkMiniAppScroll } from "./mini-app-scroll.mjs";

export async function runMiniAppWorkspace({
  api,
  goto,
  button,
  evaluate,
  until,
  fill,
  click,
  cdp,
  snapshot,
}) {
  const app = "cove/japanese-review-book";
  const catalog = await api("/api/mini-apps/catalog");
  const appCount = new Set(
    catalog.packages.map((entry) => entry.publisher + "/" + entry.app),
  ).size;
  const before = (await api("/api/mini-apps/instances")).instances;
  const installedReleases = (await api("/api/mini-apps/packages")).packages;
  const eligibleCopies = before.filter((book) =>
    installedReleases.some((release) =>
      release.id === book.release_id &&
      release.origin !== "local" &&
      release.package.publisher === "cove" &&
      release.package.app === "japanese-review-book",
    ),
  );
  await goto("/apps?section=catalog");
  await until(
    "document.querySelectorAll('#mini-app-catalog article[data-app]').length===" +
      appCount,
  );
  assert.equal(appCount, 2, "Historical releases share two distinct app cards");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-app=" +
        JSON.stringify(app) +
        "]').length",
    ),
    1,
  );
  await until(
    "Array.from(document.querySelectorAll('#mini-app-catalog article')).every(element=>!!element.querySelector('.catalog-art[data-ready=true]'))",
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate("window.scrollTo(0,0)");
  await snapshot("mini-app-market-desktop");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await until("document.documentElement.scrollWidth<=innerWidth+1");
  await evaluate("window.scrollTo(0,0)");
  await snapshot("mini-app-market-mobile");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await fill('input[placeholder="Find an app"]', "Japanese");
  await until(
    "document.querySelectorAll('#mini-app-catalog article[data-app]').length===1",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('#mini-app-catalog article').dataset.app",
    ),
    app,
  );
  await fill('input[placeholder="Find an app"]', "");
  await until(
    "document.querySelectorAll('#mini-app-catalog article[data-app]').length===" +
      appCount,
  );
  await click('[data-app="' + app + '"] .mini-app-card-cover');
  await until(
    "document.querySelector('select[aria-label=" +
      JSON.stringify("App version") +
      "]')?.value==='1.2.0'",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('select[aria-label=" +
        JSON.stringify("App version") +
        "]').options.length",
    ),
    3,
    "Historical versions are available inside the detail page",
  );
  await snapshot("mini-app-market-detail");
  await evaluate(
    "{const select=document.querySelector('select[aria-label=" +
      JSON.stringify("App version") +
      "]'); select.value='1.1.0'; select.dispatchEvent(new Event('change',{bubbles:true}));}",
  );
  await until(
    "new URLSearchParams(location.search).get('version')==='1.1.0' && Array.from(document.querySelectorAll('button')).some(element=>['Get app','Open app','Choose a copy'].includes(element.textContent.trim()) && !element.disabled)",
  );
  const detailAction = await evaluate(
    "Array.from(document.querySelectorAll('button')).find(element=>['Get app','Open app','Choose a copy'].includes(element.textContent.trim()))?.textContent.trim()",
  );
  const exactCopies = eligibleCopies.filter((book) =>
    installedReleases.find((release) => release.id === book.release_id)?.package.version === "1.1.0",
  );
  assert(exactCopies.length, "The preceding upgrade created a saved 1.1.0 copy");
  assert.equal(
    detailAction,
    eligibleCopies.length === 1 ? "Open app" : "Choose a copy",
    "The saved inventory determines how existing copies are opened",
  );
  const copy = exactCopies[0];
  await button(detailAction);
  if (detailAction === "Choose a copy") await button(copy.name);
  await until("location.pathname===" + JSON.stringify("/apps/" + copy.id));
  assert.equal(
    (await api("/api/mini-apps/instances/" + copy.id)).instance.id,
    copy.id,
  );
  await goto(
    "/apps?section=catalog&app=cove%2Fjapanese-review-book&version=1.1.0",
  );
  await button("Create another copy");
  await until(
    "!!document.querySelector('section[aria-label=" +
      JSON.stringify("Choose app access") +
      "]')",
  );
  await checkMiniAppScroll({ cdp, evaluate, until, snapshot }, true, "mini-app-workspace-install-scroll-bottom");
  await button("Cancel");
  assert.deepEqual(
    (await api("/api/mini-apps/instances")).instances,
    before,
    "Browsing app details, changing version and canceling review cannot install or update a copy",
  );
  await button("Back to Discover");
  await until(
    "document.querySelectorAll('#mini-app-catalog article[data-app]').length===" +
      appCount,
  );

  await goto("/apps?section=activity");
  await until(
    "document.querySelector('#mini-app-activity')?.tagName==='SECTION' && document.querySelectorAll('#mini-app-activity li').length>0",
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
    "!!document.querySelector('[role=dialog] input[aria-label=" +
      JSON.stringify("App or page") +
      "]')",
  );
  await fill('[aria-label="App or page"]', "Agent packages");
  await evaluate(
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(button=>button.textContent.startsWith('Agent packages')).click()",
  );
  await until("document.querySelector('#mini-app-agent')?.tagName==='SECTION'");
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
  await button("Validate and preview package", "#mini-app-agent");
  const advanced =
    "Array.from(document.querySelectorAll('summary')).find(element=>element.textContent.trim()==='Advanced')";
  await until("!!(" + advanced + ")");
  assert.equal(await evaluate("(" + advanced + ").parentElement.open"), false);
  await evaluate("(" + advanced + ").click()");
  await until("(" + advanced + ").parentElement.open");
  await button("Install package only");
  const releases = await api("/api/mini-apps/packages");
  const release = releases.packages.find(
    (item) =>
      item.package.publisher === sample.publisher &&
      item.package.app === sample.app,
  );
  assert(release);
  await click('button[aria-label="More app options"]');
  await button("Manage installed versions");
  await fill(
    'input[placeholder="Apps, instances or publishers"]',
    "Editor notebook",
  );
  const row = '[data-release="' + release.id + '"]';
  await until("!!document.querySelector(" + JSON.stringify(row) + ")");
  await button("Remove package", row);
  await button("Confirm package removal", row);
  await until("!document.querySelector(" + JSON.stringify(row) + ")");
  assert(
    !(await api("/api/mini-apps/packages")).packages.some(
      (item) => item.id === release.id,
    ),
  );
  await goto("/apps");
  await until(
    "!!document.querySelector('input[placeholder=" +
      JSON.stringify("Find an app") +
      "]')",
  );
  await fill('input[placeholder="Find an app"]', "Kana practice");
  await until(
    "Array.from(document.querySelectorAll('button strong')).some(element=>element.textContent==='Kana practice')",
  );
  assert.equal(
    await evaluate(
      "Array.from(document.querySelectorAll('button strong')).some(element=>element.textContent==='Second book')",
    ),
    false,
    "Searching My apps filters independent copies by their names",
  );
}
