import assert from "node:assert/strict";

export async function runMiniAppTurn({
  api,
  evaluate,
  until,
  click,
  fill,
  loadPage,
  origin,
  profile,
  requests,
  snapshot,
}) {
  const settings = await api("/api/settings");
  await api("/api/settings", "PATCH", {
    ...settings,
    active_model_set: [{ provider_id: profile.id, model_id: "model-one" }],
  });
  const catalog = await api("/api/mini-apps/catalog");
  const app = catalog.packages.find((entry) => entry.app === "reading-inbox");
  const release = await api(
    "/api/mini-apps/catalog/" +
      app.publisher +
      "/" +
      app.app +
      "/" +
      app.version +
      "/install",
    "POST",
    { digest: app.digest },
  );
  const book = await api("/api/mini-apps/instances", "POST", {
    release_id: release.id,
    name: "Turn reading list",
    grants: release.package.capabilities,
  });
  const query = () =>
    api(
      "/api/mini-apps/instances/" + book.id + "/actions/inbox.queue",
      "POST",
      { surface: "chat", operation_id: crypto.randomUUID(), inputs: {} },
    );
  await loadPage("Page.navigate", { url: origin + "/" });
  await until('!!document.querySelector("#generation-input")');
  async function button(name, parent = "body") {
    const expr =
      "Array.from(document.querySelectorAll(" +
      JSON.stringify(parent + " button") +
      ")).find(b=>!b.disabled && b.getBoundingClientRect().width && b.textContent.trim()===" +
      JSON.stringify(name) +
      ")";
    await until("!!(" + expr + ")");
    await evaluate("(" + expr + ").click()");
  }
  const beforeDiscovery = requests.length;
  await fill("#generation-input", "Which apps can I use in this chat?");
  await click('button[aria-label="Send message"]');
  await until('!!document.querySelector("[role=dialog]")');
  assert.equal(
    requests.length,
    beforeDiscovery,
    "Discovering installed apps stays local",
  );
  await until('document.body.textContent.includes("Turn reading list")');
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[role=dialog] #mini-app-agent, [role=dialog] #mini-app-activity, [role=dialog] #mini-app-catalog-settings').length",
    ),
    0,
    "The chat picker keeps developer and host administration out of the action flow",
  );
  await button("Done", "[role=dialog]");
  await fill("#generation-input", "@Turn reading list show records");
  await click('button[aria-label="Send message"]');
  await until('!!document.querySelector("[role=dialog]")');
  assert.equal(
    requests.length,
    beforeDiscovery,
    "Mentioning an instance requires explicit action selection",
  );
  await until(
    'Array.from(document.querySelectorAll("summary")).some(e=>e.textContent==="Use app actions in my next message")',
  );
  await evaluate(
    'Array.from(document.querySelectorAll("summary")).find(e=>e.textContent==="Use app actions in my next message").click()',
  );
  const read = release.package.actions["inbox.queue"].title,
    write = release.package.actions["inbox.defer"].title;
  for (const label of [read, write]) {
    await evaluate(
      'Array.from(document.querySelectorAll("details[open] label")).find(e=>e.textContent.trim()===' +
        JSON.stringify(label) +
        ').querySelector("input").click()',
    );
  }
  await button("Use in next message");
  await fill(
    "#generation-input",
    "Bring me my reading list for this app turn.",
  );
  await click('button[aria-label="Send message"]');
  const region = '[aria-label="App response"]';
  await until(
    "!!document.querySelector(" +
      JSON.stringify(region + ' [aria-label="Select record 1"]') +
      ")",
  );
  const toolRequest = requests.find((req) =>
    req.messages.some((m) =>
      m.content.includes("Action descriptions are reference data."),
    ),
  );
  assert(toolRequest);
  const schemas = toolRequest.messages.find((m) =>
    m.content.includes("Action descriptions are reference data."),
  ).content;
  assert(
    schemas.includes("inbox.queue") &&
      schemas.includes("inbox.defer") &&
      !schemas.includes("inbox.archive"),
  );
  assert(!JSON.stringify(toolRequest).includes("An essay to revisit"));
  await click(region + ' [aria-label="Select record 1"]');
  await button("Add to current draft (1)", region);
  await until(
    'document.querySelector("#generation-input").value.includes("Selected app records (reference data)")',
  );
  const selectedRecord = (await query()).records[0];
  assert(selectedRecord, "The selected reference has a saved source record");
  const beforeRecordSharing = requests.length;
  await click('button[aria-label="Send message"]');
  await until(
    'document.body.textContent.includes("Browser answer from model-one")&&!document.querySelector(\'button[aria-label="Stop generation"]\')',
  );
  const sharedRequests = requests.slice(beforeRecordSharing);
  assert.equal(
    sharedRequests.length,
    1,
    "Sharing selected records sends exactly one request to the selected model",
  );
  const sharedRequest = sharedRequests[0];
  assert(sharedRequest.messages.at(-1)?.content.includes("Reference from Turn reading list"));
  assert(sharedRequest.messages.at(-1)?.content.includes(selectedRecord.fields.title));
  for (const localID of [book.id, selectedRecord.id]) {
    assert(!JSON.stringify(sharedRequest).includes(localID), "Shared reference text omits local App and record IDs");
  }
  await until(
    "!!document.querySelector(" +
      JSON.stringify(region + ' [aria-label="Select record 1"]') +
      ")",
  );
  const selection = region + ' [aria-label="Select record 1"]';
  if (
    !(await evaluate(
      "document.querySelector(" + JSON.stringify(selection) + ").checked",
    ))
  )
    await click(selection);
  await button(write, region);
  await button("Preview changes", region);
  assert((await query()).records.length > 0);
  await button("Confirm changes", region);
  await until(
    "document.querySelector(" +
      JSON.stringify(region) +
      ').textContent.includes("Saved 1 record")',
  );
  assert.equal((await query()).records.length, 0);

  const review = catalog.packages.find(
    (entry) =>
      entry.app === "japanese-review-book" && entry.version === "1.1.0",
  );
  const installed = await api(
    "/api/mini-apps/catalog/" +
      review.publisher +
      "/" +
      review.app +
      "/" +
      review.version +
      "/install",
    "POST",
    { digest: review.digest },
  );
  const reviewBook = await api("/api/mini-apps/instances", "POST", {
    release_id: installed.id,
    name: "Turn review book",
    grants: installed.package.capabilities,
  });
  await loadPage("Page.navigate", { url: origin + "/" });
  await until('!!document.querySelector("#generation-input")');
  await click('button[aria-label="Tools"]');
  await button("Mini Apps");
  const reviewButton =
    'Array.from(document.querySelectorAll("[role=dialog] button strong")).find(e=>e.textContent==="Turn review book")';
  await until("!!(" + reviewButton + ")");
  await evaluate("(" + reviewButton + ").closest('button').click()");
  const details =
    'Array.from(document.querySelectorAll("summary")).find(e=>e.textContent==="Use app actions in my next message")';
  await until("!!(" + details + ")");
  await evaluate("(" + details + ").click()");
  await evaluate(
    'Array.from(document.querySelectorAll("details[open] label")).find(e=>e.textContent.trim()==="Generate practice questions").querySelector("input").click()',
  );
  await button("Use in next message");
  await fill("#generation-input", "Make study questions for this app turn.");
  const before = requests.length;
  await click('button[aria-label="Send message"]');
  const taskRegion =
    '[aria-label="App response"] [aria-label="Generate practice questions"]';
  await until("!!document.querySelector(" + JSON.stringify(taskRegion) + ")");
  assert.equal(
    requests.length,
    before + 1,
    "The proposal cannot itself send an app model request",
  );
  await evaluate(
    "Array.from(document.querySelector(" +
      JSON.stringify(taskRegion) +
      ').querySelectorAll("label")).find(e=>e.textContent.trim()==="Only on this Mac").querySelector("input").click()',
  );
  for (const value of [profile.id, "model-one"]) {
    const picker =
      "Array.from(document.querySelector(" +
      JSON.stringify(taskRegion) +
      ').querySelectorAll("select")).find(e=>Array.from(e.options).some(o=>o.value===' +
      JSON.stringify(value) +
      "))";
    await until("!!(" + picker + ")");
    await evaluate(
      "{const s=" +
        picker +
        ";s.value=" +
        JSON.stringify(value) +
        ";s.dispatchEvent(new Event('change',{bubbles:true}));}",
    );
  }
  await button("Start model task", taskRegion);
  await until(
    "document.querySelector(" +
      JSON.stringify(taskRegion) +
      ').textContent.includes("Use candidate 1")',
  );
  assert.equal(
    requests.length,
    before + 2,
    "One separately approved app task should follow the chat turn",
  );

  await fill("#generation-input", "Unchanged chat draft");
  await evaluate(
    `(()=>{const message=Array.from(document.querySelectorAll("[data-app-selection-source]")).find(e=>e.textContent.includes("Bring me my reading list for this app turn."));const walker=document.createTreeWalker(message,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const i=node.textContent.indexOf("my reading list");if(i>=0){const range=new Range();range.setStart(node,i);range.setEnd(node,i+"my reading list".length);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);return}}})()`,
  );
  await button("Use selected text in an app");
  await until("!!(" + reviewButton + ")");
  await evaluate("(" + reviewButton + ").closest('button').click()");
  const materialPage = installed.package.pages.find((p) =>
    p.actions.includes("material.save"),
  );
  await button(materialPage.title, "[role=dialog]");
  await button(
    installed.package.actions["material.save"].title,
    "[role=dialog]",
  );
  await button("Use selected chat text", "[role=dialog]");
  await until(
    'Array.from(document.querySelectorAll("[role=dialog] textarea")).some(t=>t.value==="my reading list")',
  );
  assert.equal(
    await evaluate('document.querySelector("#generation-input").value'),
    "Unchanged chat draft",
  );
  await evaluate(
    `Array.from(document.querySelectorAll("[role=dialog] textarea")).find(t => !t.value).setAttribute("data-fixture-material-field", "")`,
  );
  await fill("[data-fixture-material-field]", "Saved from the chat");
  await button("Preview changes", "[role=dialog]");
  await button("Confirm changes", "[role=dialog]");
  await until(
    'document.querySelector("[role=dialog]").textContent.includes("Saved 1 record")',
  );

  await button("Done", "[role=dialog]");
  await until('!document.querySelector("[role=dialog]")');
  await fill("#generation-input", "");
  const material = () =>
    api(
      "/api/mini-apps/instances/" + reviewBook.id + "/actions/material.list",
      "POST",
      { surface: "page", operation_id: crypto.randomUUID(), inputs: {} },
    );
  const saved = (await material()).records;
  assert(
    saved.some((row) => Object.values(row.fields).includes("my reading list")),
  );
  const views = await Promise.all(
    (await api("/api/conversations")).map((chat) =>
      api("/api/conversations/" + chat.id),
    ),
  );
  const source = views.find((view) =>
    view.messages.some(
      (message) =>
        message.body === "Bring me my reading list for this app turn.",
    ),
  );
  assert(
    source,
    "Find the source conversation in the isolated acceptance database",
  );
  await api("/api/conversations/" + source.id, "DELETE");
  assert(
    !(await api("/api/conversations")).some((chat) => chat.id === source.id),
  );
  assert.deepEqual(
    (await material()).records,
    saved,
    "Deleting the source chat preserves the app's owned records",
  );
  await fill("#generation-input", "");
  await loadPage("Page.navigate", { url: origin + "/apps" });
  await until('!!document.querySelector(".mini-app-shell")');
  await until("!!history.state?.['cove.workspace-history.v1']");
  const appsEntry = await evaluate(
    "({href:location.href,state:history.state})",
  );
  await click('a[href="/"]');
  await until(
    `!!document.querySelector('button[aria-label="New conversation"]')`,
  );
  await click('button[aria-label="New conversation"]');
  await until('!!document.querySelector("#generation-input")');
  await fill("#generation-input", "Keep my unsent workspace draft");
  const chatEntry = await evaluate(
    "({href:location.href,state:history.state})",
  );
  const historyLength = await evaluate("history.length");
  const requestsBeforeHistory = requests.length;
  const restoredChat =
    "location.href===" +
    JSON.stringify(chatEntry.href) +
    " && JSON.stringify(history.state)===" +
    JSON.stringify(JSON.stringify(chatEntry.state));
  await evaluate("history.back()");
  await until("document.body.textContent.includes('Discard unsent draft?')");
  await until(restoredChat);
  await snapshot("mini-app-history-stay");
  await button("Stay", "[role=dialog]");
  assert.equal(
    await evaluate('document.querySelector("#generation-input").value'),
    "Keep my unsent workspace draft",
  );
  assert.equal(await evaluate("location.href"), chatEntry.href);
  assert.equal(await evaluate("history.length"), historyLength);
  assert.deepEqual(await evaluate("history.state"), chatEntry.state);

  // Staying must preserve the actual prior entry, so Back can offer it again.
  await evaluate("history.back()");
  await until("document.body.textContent.includes('Discard unsent draft?')");
  await until(restoredChat);
  await button("Discard and continue", "[role=dialog]");
  await until(
    "location.href===" +
      JSON.stringify(appsEntry.href) +
      " && !!document.querySelector('.mini-app-shell')",
  );
  assert.deepEqual(await evaluate("history.state"), appsEntry.state);
  assert.equal(await evaluate("history.length"), historyLength);
  await snapshot("mini-app-history-leave");

  // Leave traverses instead of replacing the entry: Forward still reaches Chat.
  await evaluate("history.forward()");
  await until(
    "location.href===" +
      JSON.stringify(chatEntry.href) +
      " && !!document.querySelector('#generation-input')",
  );
  assert.deepEqual(await evaluate("history.state"), chatEntry.state);
  assert.equal(
    await evaluate("document.querySelector('#generation-input').value"),
    "",
  );
  assert.equal(await evaluate("history.length"), historyLength);
  await evaluate("history.back()");
  await until(
    "location.href===" +
      JSON.stringify(appsEntry.href) +
      " && !!document.querySelector('.mini-app-shell')",
  );
  assert.deepEqual(await evaluate("history.state"), appsEntry.state);
  assert.equal(
    requests.length,
    requestsBeforeHistory,
    "History confirmation must not invoke a model",
  );

  // Chromium exposes synchronous entry commits even when native hash events
  // queue behind several pushes. Preserve every physical entry through the guard.
  assert.equal(await evaluate("typeof window.navigation?.addEventListener"), "function");
  await click('a[href="/"]');
  await until(`!!document.querySelector('button[aria-label="New conversation"]')`);
  await click('button[aria-label="New conversation"]');
  await until('!!document.querySelector("#generation-input")');
  await fill("#generation-input", "Keep my rapid fragment draft");
  const rapidChat = await evaluate("({href:location.href,state:history.state})");
  const rapid = await evaluate(`(() => {
    const signals = [];
    const listener = event => signals.push(event.navigationType);
    navigation.addEventListener('currententrychange', listener);
    location.hash = '#one';
    const first = { href: location.href, state: history.state };
    location.hash = '#two';
    const second = { href: location.href, state: history.state };
    navigation.removeEventListener('currententrychange', listener);
    return { first, second, signals };
  })()`);
  const historyKey = "cove.workspace-history.v1";
  assert.equal(rapid.signals.filter(type => type === "push").length, 2);
  assert.equal(rapid.first.state[historyKey].index, rapidChat.state[historyKey].index + 1);
  assert.equal(rapid.second.state[historyKey].index, rapidChat.state[historyKey].index + 2);
  const rapidLength = await evaluate("history.length");
  const atEntry = entry => "location.href===" + JSON.stringify(entry.href) +
    " && JSON.stringify(history.state)===" + JSON.stringify(JSON.stringify(entry.state));
  await evaluate("history.go(-3)");
  await until("document.body.textContent.includes('Discard unsent draft?')");
  await until(atEntry(rapid.second));
  await button("Stay", "[role=dialog]");
  assert.equal(await evaluate('document.querySelector("#generation-input").value'), "Keep my rapid fragment draft");
  await snapshot("mini-app-rapid-fragment-stay");
  await evaluate("history.go(-3)");
  await until("document.body.textContent.includes('Discard unsent draft?')");
  await until(atEntry(rapid.second));
  await button("Discard and continue", "[role=dialog]");
  await until(atEntry(appsEntry));
  await until("!!document.querySelector('.mini-app-shell')");
  for (const entry of [rapidChat, rapid.first, rapid.second]) {
    await evaluate("history.forward()");
    await until(atEntry(entry));
  }
  assert.equal(await evaluate("history.length"), rapidLength);
  assert.equal(requests.length, requestsBeforeHistory, "Rapid fragment confirmation stays local");
  await evaluate("history.go(-3)");
  await until(atEntry(appsEntry));
  await snapshot("mini-app-rapid-fragment-leave");

}
