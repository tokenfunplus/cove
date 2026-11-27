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
  await fill("input:not([type])", "Kana practice");
  await button("Install and create instance");
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
  // An explicit version must never silently open the single older instance.
  await goto("/apps/install/cove/japanese-review-book?version=1.0.1");
  await until("document.body.textContent.includes('No matching release')");
  assert.equal(await rowCount(), 0);
  await goto("/apps/install/cove/japanese-review-book?version=1.0.0");
  await readyRows(3);
  assert.equal(await evaluate("location.pathname.split('/')[2]"), first);
  await button("My apps");
  await button("New instance");
  await fill("input:not([type])", "Second book");
  await button("Create instance");
  await readyRows(3);
  const second = await evaluate("location.pathname.split('/')[2]");
  assert.notEqual(first, second);
  await goto("/apps/install/cove/japanese-review-book?version=1.0.0");
  await until(
    "document.body.textContent.includes('Choose an instance') && document.body.textContent.includes('Kana practice') && document.body.textContent.includes('Second book')",
  );

  await goto("/apps/" + first + "/home");
  await readyRows(3);
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
  await evaluate(
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent.startsWith('Second book')).click()",
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
  await until("document.body.textContent.includes('No compatible update in this catalog.')");
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
  await click("summary");
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

  // Import a new release and update one existing local-author instance in place.
  const pkg = JSON.parse(
    await readFile(
      "services/local-service/internal/appcatalog/packages/reading-inbox.coveapp",
      "utf8",
    ),
  );
  const old = await api("/api/mini-apps/packages/install", "POST", pkg);
  const inbox = await api("/api/mini-apps/instances", "POST", {
    release_id: old.id,
    name: "Legacy inbox",
    grants: pkg.capabilities,
  });
  const saved = await api("/api/mini-apps/instances/" + inbox.id + "/export");
  const update = path.join(temp, "inbox-update.coveapp");
  await writeFile(update, JSON.stringify({ ...pkg, version: "1.1.0" }));
  await goto("/apps");
  await until("!!document.querySelector('input[accept*=coveapp]')");
  const pageRoot = await cdp("DOM.getDocument");
  const importField = await cdp("DOM.querySelector", {
    nodeId: pageRoot.root.nodeId,
    selector: "input[accept*=coveapp]",
  });
  await cdp("DOM.setFileInputFiles", {
    nodeId: importField.nodeId,
    files: [update],
  });
  await until(
    "!!document.querySelector('select option[value=" +
      JSON.stringify(inbox.id) +
      "]')",
  );
  await evaluate(
    `{const s=document.querySelector("select");s.value=${JSON.stringify(inbox.id)};s.dispatchEvent(new Event("change",{bubbles:true}));}`,
  );
  await button("Upgrade instance to 1.1.0");
  await until("location.pathname.includes(" + JSON.stringify(inbox.id) + ")");
  assert.equal(
    (await api("/api/mini-apps/instances/" + inbox.id)).package.version,
    "1.1.0",
  );
  const content = (collections) =>
    Object.fromEntries(
      Object.entries(collections).map(([name, rows]) => [
        name,
        rows.map(({ id, fields }) => ({ id, fields })),
      ]),
    );
  assert.deepEqual(
    content(
      (await api("/api/mini-apps/instances/" + inbox.id + "/export"))
        .collections,
    ),
    content(saved.collections),
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
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent.startsWith('Second book'))";
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
  // Force an expired proof on a mounted app to exercise real Local Service rejection.
  await fill("#quick-panel-input", "");
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
