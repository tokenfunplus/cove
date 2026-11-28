import assert from "node:assert/strict";

// A disposable author-defined app exercises the host, not an embedded business app.
export async function runMiniAppPresentation({ api, installPackageFixture, loadPage, origin, evaluate, until, click, snapshot }) {
  const fields = { company: "text", position: "text", appliedOn: "date", channel: "text" };
  const pkg = {
    format: 1, publisher: "presentation-fixture", app: "records", name: "Records",
    description: "Presentation acceptance fixture.", version: "1.0.0", min_host_version: "1.2.0", schema_version: 1,
    capabilities: ["records.query", "records.commit"],
    collections: { entries: { title_field: "company", fields } },
    pages: [{ id: "home", title: "Entries", actions: ["list", "add", "remove"] }],
    actions: {
      list: { title: "List entries", op: "query", collection: "entries", inputs: {}, surfaces: ["page"], order_by: "appliedOn" },
      add: { title: "Add entry", op: "create", collection: "entries", inputs: fields, surfaces: ["page"], values: Object.fromEntries(Object.keys(fields).map(key => [key, "$input." + key])) },
      remove: { title: "Delete selected entries", op: "delete", collection: "entries", inputs: {}, surfaces: ["page"] },
    },
    seed: { entries: [{ company: "Example company", position: "Engineer", appliedOn: "2030-01-04", channel: "LinkedIn" }] },
  };
  const release = await installPackageFixture({ raw: JSON.stringify(pkg) });
  const book = await api("/api/mini-apps/instances", "POST", { release_id: release.id, name: "Presentation check", grants: pkg.capabilities });
  const root = "/api/mini-apps/instances/" + book.id;
  const button = async name => {
    const match = `Array.from(document.querySelectorAll('main.mini-app-shell button')).find(e=>e.textContent.trim()===${JSON.stringify(name)} && !e.disabled)`;
    await until(`!!(${match})`);
    await evaluate(`(${match}).setAttribute('data-presentation-button','')`);
    await click("[data-presentation-button]");
    await evaluate("document.querySelector('[data-presentation-button]')?.removeAttribute('data-presentation-button')");
  };
  const records = async () => (await api(root + "/actions/list", "POST", { operation_id: crypto.randomUUID(), surface: "page", inputs: {} })).records;
  try {
    await loadPage("Page.navigate", { url: origin + "/apps/" + book.id + "/home" });
    await until("!!document.querySelector('[aria-label=\"Select record 1\"]')");
    assert.deepEqual(Object.keys((await api(root)).package.actions.add.inputs), Object.keys(fields));
    assert(await evaluate("Array.from(document.querySelectorAll('p.font-medium')).some(e=>e.textContent==='Example company')"), "The record title comes from the authored title field, independently of date sorting and record map order");
    await snapshot("mini-app-record-title");
    await button("Add entry");
    await until("document.querySelectorAll('fieldset label').length===4");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('fieldset label')).map(e=>e.textContent.trim())"), ["Company", "Position", "Applied On", "Channel"]);
    await snapshot("mini-app-authored-field-order");
    await button("Close");
    await click('[aria-label="Select record 1"]');
    await button("Delete selected entries");
    await button("Preview changes");
    assert.equal((await records()).length, 1, "Deletion preview preserves the saved record");
    await button("Confirm permanent deletion");
    await until("document.body.textContent.includes('Deleted 1 record from Presentation check.')");
    assert.equal((await records()).length, 0);
    await snapshot("mini-app-deletion-feedback");
  } finally {
    await api(root, "DELETE");
    await api("/api/mini-apps/packages/" + release.id, "DELETE");
  }
}
