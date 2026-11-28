import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { checkMiniAppScroll } from "./mini-app-scroll.mjs";

export async function runMiniAppWorkspace({ packageFixtures, installPackageFixture,
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
  const catalog = { packages: packageFixtures };
  const before = (await api("/api/mini-apps/instances")).instances;
  const installedReleases = (await api("/api/mini-apps/packages")).packages;
  const selectedRelease = catalog.packages.find((entry) =>
    entry.publisher === "cove" && entry.app === "japanese-review-book" && entry.version === "1.1.0",
  );
  assert(selectedRelease, "The installation fixture supplies version 1.1.0");
  const installed = installedReleases.find((release) =>
    release.package.publisher === selectedRelease.publisher &&
    release.package.app === selectedRelease.app &&
    release.package.version === selectedRelease.version &&
    release.digest === selectedRelease.digest && release.origin === selectedRelease.origin,
  );
  const exactCopies = before.filter((book) => book.release_id === installed?.id);
  assert.equal(exactCopies.length, 1, "The preceding upgrade created one saved 1.1.0 copy");
  const injection = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const original = window.fetch;
    window.__miniWorkspaceCatalogReads = [];
    window.fetch = (input, init) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      if (path.startsWith('/api/mini-apps/catalog')) window.__miniWorkspaceCatalogReads.push(path);
      return original(input, init);
    };
  })()` });
  try {
    // Old market bookmarks remain useful local workspace entries. They do not
    // reconstruct a public catalog or fetch release metadata in the background.
    await goto("/apps?section=catalog&app=cove%2Fjapanese-review-book&version=1.1.0");
    await until("document.querySelector('input[placeholder=\"Find an app\"]') && Array.from(document.querySelectorAll('button strong')).some(element=>element.textContent==='Kana practice')");
    assert.equal(await evaluate("document.querySelector('#mini-app-catalog')"), null);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).some(element=>element.textContent.trim()==='Discover')"), false);
    const website = await evaluate(`(() => {
      const link = Array.from(document.querySelectorAll('a')).find(element=>element.textContent.includes('Browse apps on CoveWeb'));
      return link && { href: link.href, target: link.target, rel: link.rel };
    })()`);
    assert.equal(website?.href, "https://www.hicove.io/apps");
    assert.equal(website.target, "_blank");
    assert(website.rel.split(/\s+/).includes("noreferrer"));
    assert.deepEqual(await evaluate("window.__miniWorkspaceCatalogReads"), [], "My apps and old catalog bookmarks stay local");
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await evaluate("document.querySelector('main.mini-app-shell').scrollTop = 0");
    await snapshot("mini-app-workspace-desktop");
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await until("document.documentElement.scrollWidth<=innerWidth+1");
    await snapshot("mini-app-workspace-mobile");
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });

    // A cached newer package offers an update review instead of forcing a new
    // empty instance. Canceling it preserves the full inventory and its data.
    const newer = catalog.packages.find(entry => entry.app === selectedRelease.app && entry.publisher === selectedRelease.publisher && entry.version === "1.2.0");
    assert(newer);
    const cached = await installPackageFixture(newer);
    assert(!before.some(book => book.release_id === cached.id));
    await goto("/apps/install/cove/japanese-review-book?version=1.2.0");
    await button("Review update");
    await until("!!document.querySelector('select[aria-label=\"Update an existing copy\"]')");
    await evaluate(`{const select=document.querySelector('select[aria-label="Update an existing copy"]'); select.value=${JSON.stringify(exactCopies[0].id)}; select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await until("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Update to 1.2.0' && !button.disabled)");
    await button("Cancel");
    assert.deepEqual((await api("/api/mini-apps/instances")).instances, before);

    // CoveWeb's version-specific handoff resolves the precise installed copy
    // without requiring another remote catalog read or an online connection.
    await goto("/apps/install/cove/japanese-review-book?version=1.1.0");
    const copy = exactCopies[0];
    await until("location.pathname===" + JSON.stringify("/apps/" + copy.id));
    assert.deepEqual(await evaluate("window.__miniWorkspaceCatalogReads"), [], "An exact installed release opens offline");
    assert.equal((await api("/api/mini-apps/instances/" + copy.id)).instance.id, copy.id);
    await button("My apps");
    await click('button[aria-label="More app options"]');
    await button("Manage installed versions");
    await button("New instance", '[data-release="' + installed.id + '"]');
    await until("!!document.querySelector('section[aria-label=\"Choose app access\"]')");
    assert.equal(
      await evaluate("document.querySelector('select[aria-label=\"Update an existing copy\"]')?.value ?? ''"),
      "",
      "New instance starts fresh even when an older copy can be updated",
    );
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"App name\"]')?.value"), selectedRelease.name);
    await checkMiniAppScroll({ cdp, evaluate, until, snapshot }, true, "mini-app-workspace-install-scroll-bottom");
    await button("Cancel");
    assert.deepEqual(
      (await api("/api/mini-apps/instances")).instances,
      before,
      "Opening a signed handoff and canceling a new-copy review do not mutate installed instances",
    );
  } finally {
    await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  }

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
  assert.equal(await evaluate("Array.from(document.querySelectorAll('#mini-app-agent button')).some(button=>button.textContent.startsWith('Load Japanese Review Book example'))"), false, "Business apps are not embedded author templates");
  const sample = JSON.parse(await readFile("services/local-service/cmd/coveapp/starter.coveapp", "utf8"));
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
