import { runMiniAppWorkspace } from "./mini-app-workspace.mjs";
import { checkMiniAppScroll } from "./mini-app-scroll.mjs";
import { runReviewBookUpgrade } from "./review-book-upgrade.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function runMiniAppsAcceptance({
  api,
  cdp,
  evaluate,
  until,
  click,
  fill,
  snapshot,
  reloadPage,
  loadPage,
  origin,
  profile,
  requests,
  temp,
}) {
  const goto = (route) => loadPage("Page.navigate", { url: origin + route });
  const button = async (name, parent = "body") => {
    const js = `Array.from(document.querySelectorAll(${JSON.stringify(parent + " button")})).find(e=>e.textContent.trim()===${JSON.stringify(name)} && !e.disabled && e.getBoundingClientRect().width>0)`;
    await until("!!(" + js + ")");
    await evaluate(
      "document.querySelector('[data-mini-target]')?.removeAttribute('data-mini-target'); (" +
        js +
        ").setAttribute('data-mini-target','true')",
    );
    await click("[data-mini-target]");
  };
  const grantBookAccess = async () => {
    const scope = 'section[aria-label="Choose app access"]';
    const selector = scope + ' input[type="checkbox"]';
    await until(
      "document.querySelectorAll(" + JSON.stringify(selector) + ").length > 0",
    );
    assert.equal(
      await evaluate(
        "document.querySelectorAll(" +
          JSON.stringify(selector + ":checked") +
          ").length",
      ),
      0,
      "A new copy starts with all access off",
    );
    const disclosure =
      "Array.from(document.querySelectorAll(" +
      JSON.stringify(scope + " summary") +
      ")).find(element=>element.textContent.trim().startsWith('More access'))";
    assert.equal(
      await evaluate("(" + disclosure + ").parentElement.open"),
      false,
    );
    await evaluate("(" + disclosure + ").click()");
    await until("(" + disclosure + ").parentElement.open");
    await evaluate(
      "document.querySelectorAll(" +
        JSON.stringify(selector) +
        ").forEach(element=>{const title=document.getElementById(element.getAttribute('aria-labelledby'))?.textContent;if(title!=='Allow cloud models')element.click();})",
    );
    assert.equal(
      await evaluate(
        "Array.from(document.querySelectorAll(" +
          JSON.stringify(selector) +
          ")).find(element=>document.getElementById(element.getAttribute('aria-labelledby'))?.textContent==='Allow cloud models').checked",
      ),
      false,
      "Allowing declared capabilities does not implicitly opt into cloud models",
    );
  };
  const rowCount = () =>
    evaluate(
      "document.querySelectorAll('[aria-label^=\"Select record \"]').length",
    );
  const readyRows = (n) =>
    until(
      "document.querySelectorAll('[aria-label^=\"Select record \"]').length===" +
        n,
    );
  const query = async (id) =>
    (
      await api(
        "/api/mini-apps/instances/" + id + "/actions/review.listDue",
        "POST",
        { surface: "page", operation_id: randomUUID(), inputs: {} },
      )
    ).records;
  const chatsBefore = (await api("/api/conversations")).length;
  const requestsBefore = requests.length;

  await goto("/apps/install/cove/japanese-review-book?version=1.0.0");
  await button("Preview release");
  await fill('input[aria-label="App name"]', "Kana practice");
  await grantBookAccess();
  await button("Install app");
  await readyRows(3);
  const disclosures =
    "Array.from(document.querySelectorAll('details')).filter(e=>e.querySelector('summary')?.textContent==='Show answer')";
  assert.equal(await evaluate(disclosures + ".filter(e=>!e.open).length"), 3);
  await click("dd summary");
  assert.equal(await evaluate(disclosures + ".filter(e=>e.open).length"), 1);
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[aria-label^=\"Select record \"]:checked').length",
    ),
    0,
  );
  const first = await evaluate("location.pathname.split('/')[2]");
  assert(first);
  const installedFirst = await api("/api/mini-apps/instances/" + first);
  assert.deepEqual(
    [...installedFirst.instance.grants].sort(),
    [...installedFirst.package.capabilities].sort(),
  );
  assert.equal(installedFirst.instance.cloud_enabled, false);
  // An explicit version must never silently open the single older instance.
  await goto("/apps/install/cove/japanese-review-book?version=1.0.1");
  await until("document.body.textContent.includes('No matching release')");
  assert.equal(await rowCount(), 0);
  await goto("/apps/install/cove/japanese-review-book?version=1.0.0");
  await readyRows(3);
  assert.equal(await evaluate("location.pathname.split('/')[2]"), first);
  await button("My apps");
  await click('button[aria-label="More app options"]');
  await button("Manage installed versions");
  const firstRelease = (await api("/api/mini-apps/instances/" + first)).instance
    .release_id;
  await button("New instance", '[data-release="' + firstRelease + '"]');
  await fill('input[aria-label="App name"]', "Second book");
  await grantBookAccess();
  await button("Create copy");
  await readyRows(3);
  const second = await evaluate("location.pathname.split('/')[2]");
  assert.notEqual(first, second);
  await goto("/apps/install/cove/japanese-review-book?version=1.0.0");
  await until(
    "document.body.textContent.includes('Choose an instance') && document.body.textContent.includes('Kana practice') && document.body.textContent.includes('Second book')",
  );

  await goto("/apps/" + first + "/home");
  await readyRows(3);
  await checkMiniAppScroll({ cdp, evaluate, until, snapshot }, false, "mini-app-attachments-scroll-bottom");
  await click('[aria-label="Select record 1"]');
  await button("Mark learned and review in a week");
  await button("Preview changes");
  assert.equal((await query(first)).length, 3);
  await button("Confirm changes");
  await readyRows(2);
  await reloadPage();
  await readyRows(2);
  assert.equal((await query(second)).length, 3);
  await click('[aria-label="Select record 1"]');
  await button("Start a chat draft (1)");
  await until(
    "document.querySelector('#generation-input')?.value.includes('Reference from Kana practice')",
  );
  assert.equal(requests.length, requestsBefore);
  assert.equal((await api("/api/conversations")).length, chatsBefore + 1);

  await click('button[aria-label="Tools"]');
  await button("Mini Apps");
  await until("!!document.querySelector('[role=dialog]')");
  await button("Discover");
  await click('[data-app="cove/japanese-review-book"] .mini-app-card-cover');
  await until("!!document.querySelector('select[aria-label=\"App version\"]')");
  await evaluate("{const select=document.querySelector('select[aria-label=\"App version\"]');select.value='1.0.0';select.dispatchEvent(new Event('change',{bubbles:true}));}");
  await button("Choose a copy");
  await button("Create another copy");
  await until("document.querySelectorAll('[role=dialog]').length===2");
  await checkMiniAppScroll({ cdp, evaluate, until, snapshot }, true, "mini-app-chat-install-scroll-bottom");
  await button("Cancel", ".study-dialog");
  await button("Back to Discover");
  await click(
    '[role=dialog] nav[aria-label="Mini Apps navigation"] button:first-child',
  );
  await evaluate(
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.querySelector('strong')?.textContent==='Second book').click()",
  );
  await readyRows(3);
  await click('[aria-label="Select record 2"]');
  await button("Add to current draft (1)");
  await until(
    "document.querySelector('#generation-input')?.value.includes('Reference from Second book')",
  );
  assert.match(
    await evaluate("document.querySelector('#generation-input').value"),
    /Reference from Kana practice/,
  );

  await fill("#generation-input", "");
  await until("document.querySelector('#generation-input')?.value===''");
  await goto("/apps/" + first + "/questions");
  await readyRows(3);
  await button("Generate practice questions");
  await fill("textarea", "Mini App study fixture");
  await click("input[type=checkbox]:not([aria-label])");
  await until(
    "Array.from(document.querySelectorAll('select option')).some(o=>o.value===" +
      JSON.stringify(profile.id) +
      ")",
  );
  await evaluate(
    `{const s=document.querySelector("select");s.value=${JSON.stringify(profile.id)};s.dispatchEvent(new Event("change",{bubbles:true}));}`,
  );
  await until(
    "Array.from(document.querySelectorAll('select option')).some(o=>o.value==='model-one')",
  );
  await evaluate(
    `{const s=Array.from(document.querySelectorAll("select")).find(s=>Array.from(s.options).some(o=>o.value==="model-one"));s.value="model-one";s.dispatchEvent(new Event("change",{bubbles:true}));}`,
  );
  await button("Start model task");
  await button("Use candidate 1");
  await button("Preview changes");
  await button("Confirm changes");
  await readyRows(4);
  await snapshot("mini-app-questions");

  await button("Settings");
  await button("Check for updates");
  await until(
    "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Update to 1.2.0')",
  );
  await button("Cancel");
  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: temp,
  });
  await button("Export data");
  const filename = path.join(temp, "japanese-review-book.covedata");
  let exported;
  for (let i = 0; i < 40 && !exported; i++) {
    try {
      exported = JSON.parse(await readFile(filename, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(exported?.collections.questions.length, 4);
  await button("My apps");
  await click('button[aria-label="More app options"]');
  await button("Restore a backup");
  const root = await cdp("DOM.getDocument");
  const input = await cdp("DOM.querySelector", {
    nodeId: root.root.nodeId,
    selector: 'input[accept=".covedata"]',
  });
  await cdp("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [filename],
  });
  await button("Restore japanese-review-book.covedata");
  await until(
    "document.body.textContent.includes('This instance is disabled')",
  );
  assert.equal(await rowCount(), 0);
  const restored = await evaluate("location.pathname.split('/')[2]");
  assert.equal(
    (await api("/api/mini-apps/instances/" + restored)).instance.enabled,
    false,
  );

  // A third-party author can import both versions from files and update user records in place.
  const packageDir = "services/local-service/internal/appcatalog/packages";
  async function importInbox(filename) {
    const pkg = JSON.parse(
      await readFile(path.join(packageDir, filename), "utf8"),
    );
    pkg.publisher = "local-reading-fixture";
    const artifact = path.join(temp, filename);
    await writeFile(artifact, JSON.stringify(pkg));
    await goto("/apps");
    await until("!!document.querySelector('input[accept*=coveapp]')");
    const root = await cdp("DOM.getDocument");
    const input = await cdp("DOM.querySelector", {
      nodeId: root.root.nodeId,
      selector: "input[accept*=coveapp]",
    });
    await cdp("DOM.setFileInputFiles", {
      nodeId: input.nodeId,
      files: [artifact],
    });
    await until(
      `document.body.textContent.includes(${JSON.stringify(pkg.version)}) && !!document.querySelector('section[aria-label="Choose app access"]')`,
    );
  }
  await importInbox("reading-inbox.coveapp");
  await fill('input[aria-label="App name"]', "Legacy inbox");
  await grantBookAccess();
  await button("Install app");
  await readyRows(1);
  const inbox = await evaluate("location.pathname.split('/')[2]");
  const instanceURL = "/api/mini-apps/instances/" + inbox;
  const runInbox = async (action, inputs = {}, records = [], review = () => {}) => {
    const invocation = {
      operation_id: randomUUID(),
      surface: "chat",
      inputs,
      records: records.map(({ id, revision }) => ({ id, revision })),
    };
    const url = instanceURL + "/actions/" + action;
    const result = await api(url, "POST", invocation);
    review(result);
    return result.confirmation
      ? api(url, "POST", { ...invocation, confirm: result.confirmation })
      : result;
  };
  const title = "A saved essay from before the update";
  const {
    records: [saved],
  } = await runInbox("inbox.add", { title, note: "My own reading notes." });
  const before = await api(instanceURL + "/export");
  await importInbox("reading-inbox-1.1.coveapp");
  await until(
    `document.querySelector("select")?.value === ${JSON.stringify(inbox)}`,
  );
  await button("Update to 1.1.0");
  await until("location.pathname.includes(" + JSON.stringify(inbox) + ")");
  assert.equal((await api(instanceURL)).package.version, "1.1.0");
  const after = await api(instanceURL + "/export");
  assert.deepEqual(
    after.collections.items,
    before.collections.items.map((row) => ({
      ...row,
      revision: row.revision + 1,
      fields: { ...row.fields, deferrals: 0 },
    })),
  );

  await goto("/");
  await until("!!document.querySelector('#generation-input')");
  await click('button[aria-label="Tools"]');
  await button("Mini Apps");
  const inboxButton = `Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.querySelector('strong')?.textContent==='Legacy inbox')`;
  await until("!!(" + inboxButton + ")");
  await evaluate("(" + inboxButton + ").click()");
  await readyRows(2);
  const marker = `Array.from(document.querySelectorAll('[role=dialog] input[aria-label^="Select record"]')).find(e=>e.parentElement.textContent.includes(${JSON.stringify(title)}))`;
  await until("!!(" + marker + ")");
  await evaluate("(" + marker + ").click()");
  await button("Add to current draft (1)");
  await until(
    `document.querySelector('#generation-input')?.value.includes(${JSON.stringify(title)})`,
  );
  await fill("#generation-input", "");
  const migrated = after.collections.items.find((row) => row.id === saved.id);
  const defer = async (record, days) => {
    let reviewedDate;
    const result = await runInbox("inbox.defer", {}, [record], (preview) => {
      // The confirmation binds the service's civil preview date, independently
      // of this process's clock and of a later preview crossing midnight.
      const previewDate = preview.confirmation?.split(".")[0];
      assert.match(previewDate, /^\d{4}-\d{2}-\d{2}$/);
      const expected = new Date(previewDate + "T00:00:00Z");
      expected.setUTCDate(expected.getUTCDate() + days);
      reviewedDate = expected.toISOString().slice(0, 10);
      assert.equal(preview.records[0].fields.revisit, reviewedDate, `Deferral previews exactly ${days} days from its own date`);
    });
    assert.equal(result.records[0].fields.revisit, reviewedDate, "Confirmation preserves the reviewed deferral date");
    return result;
  };
  const {
    records: [firstDefer],
  } = await defer(migrated, 2);
  const {
    records: [secondDefer],
  } = await defer(firstDefer, 7);
  assert.equal(firstDefer.fields.deferrals, 1);
  assert.equal(secondDefer.fields.deferrals, 2);
  assert.equal(
    (await runInbox("inbox.upcoming")).records.some(
      (row) => row.id === saved.id,
    ),
    false,
  );

  await goto("/?surface=quick-panel");
  await until("!!document.querySelector('#quick-panel-input')");
  await evaluate(
    "window.dispatchEvent(new CustomEvent('cove-quick-panel-focus'))",
  );
  await evaluate(
    "window.dispatchEvent(new CustomEvent('cove-quick-panel-import',{cancelable:true,detail:{id:crypto.randomUUID(),text:'Panel study selection'}}))",
  );
  await until(
    "document.querySelector('#quick-panel-input').value==='Panel study selection'",
  );
  await click('button[aria-label="Tools"]');
  const panelItem =
    "Array.from(document.querySelectorAll('[role=menuitem]')).find(b=>b.textContent.includes('Mini Apps'))";
  await until("!!(" + panelItem + ")");
  await evaluate("(" + panelItem + ").click()");
  const secondBook =
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.querySelector('strong')?.textContent==='Second book')";
  await until("!!(" + secondBook + ")");
  await evaluate("(" + secondBook + ").click()");
  await readyRows(3);
  await button("Study material", "[role=dialog]");
  await button("Save study material", "[role=dialog]");
  await button("Use current draft", "[role=dialog]");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[role=dialog] textarea')[0].value",
    ),
    "Panel study selection",
  );
  await button("Done", "[role=dialog]");
  assert.equal(
    await evaluate("document.querySelector('#quick-panel-input').value"),
    "Panel study selection",
  );
  // Clear the import before leaving the panel so its unsent-draft protection
  // does not open a native beforeunload prompt during the next navigation.
  await fill("#quick-panel-input", "");
  await until("document.querySelector('#quick-panel-input')?.value===''");
  await runReviewBookUpgrade({
    snapshot,
    cdp,
    api,
    goto,
    button,
    until,
    evaluate,
    fill,
    click,
    readyRows,
    first,
    profile,
  });
  await runMiniAppWorkspace({
    api,
    goto,
    button,
    evaluate,
    until,
    fill,
    click,
    cdp,
    snapshot,
  });
  // Force an expired proof on a mounted app to exercise real Local Service rejection.
  await goto("/apps/" + first + "/home");
  await readyRows(3);
  await evaluate(`{const original=window.fetch; window.fetch=(url,options)=>{const headers=new Headers(options?.headers);
    headers.set("X-Cove-Session-Token","fixture-expired");return original(url,{...options,headers});};}`);
  await button("Refresh");
  await until(
    "document.querySelector('a[href^=\"cove://open/\"]')?.textContent.includes('Open in Cove')",
  );
  await evaluate("sessionStorage.removeItem('cove.browser-session')");
  await goto("/apps");
  await until(
    "document.querySelector('a[href=\"cove://apps\"]')?.textContent.includes('Open in Cove')",
  );
}
