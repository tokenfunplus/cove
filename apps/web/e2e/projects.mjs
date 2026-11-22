import { projectNavigation } from "./project-navigation.mjs";
import { runProjectWorkflows } from "./project-workflows.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { markVisibleAction } from "./visible-action.mjs";

export async function runProjectsAcceptance({
  api,
  cdp,
  evaluate,
  until,
  click,
  fill,
  snapshot,
  reloadPage,
  dataDir,
  requests,
}) {
  async function button(text, selector = "button") {
    assert(
      await markVisibleAction(cdp, selector, text, "data-project-action"),
      "Missing project action: " + text,
    );
    await click('[data-project-action="true"]');
    await evaluate(
      "document.querySelector('[data-project-action]')?.removeAttribute('data-project-action')",
    );
  }
  const navigation = projectNavigation({ click, until, evaluate, button, api });
  assert(
    !(await evaluate(
      "!!document.querySelector('[aria-label=\"History project\"]') || !!document.querySelector('[aria-label=\"Move conversation to project\"]')",
    )),
    "Ordinary chat exposed project management controls",
  );
  await snapshot("ordinary-chat-with-projects-entry");
  await navigation.openProjects();
  await snapshot("projects-empty-page");
  await button("New project");
  await fill('input[aria-label="Project name"]', "Empty project");
  await button("Create project", '[role="dialog"] button');
  await until(
    "!document.querySelector('[role=dialog]') && !!document.querySelector('[aria-label=\"Project background and materials\"]')",
  );
  await click('button[aria-label="Project actions: Empty project"]');
  await button("Delete project", '[role="menu"] button');
  await until(
    "!!document.querySelector('[role=dialog][aria-labelledby]') && document.querySelector('[role=dialog]').textContent.includes('0 current conversations')",
  );
  await snapshot("project-delete-confirmation");
  await button("Cancel removal", '[role="dialog"] button');
  assert((await api("/api/projects")).some((p) => p.name === "Empty project"));
  await navigation.openProjects();
  await click('button[aria-label="Project actions: Empty project"]');
  await button("Delete project", '[role="menu"] button');
  await button("Confirm deletion", '[role="dialog"] button');
  await until(
    "!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=\"Open project Empty project\"]')",
  );
  assert.equal((await api("/api/projects")).length, 0);
  await button("New project");
  await until("!!document.querySelector('input[aria-label=\"Project name\"]')");
  await fill('input[aria-label="Project name"]', "Research fixture");
  await fill(
    'textarea[aria-label="Project instructions"]',
    "Compare evidence carefully.",
  );
  await fill(
    'textarea[aria-label="Project background"]',
    "Original project background.",
  );
  await button("Create project", '[role="dialog"] button');
  await until(
    "!document.querySelector('[role=dialog]') && !!document.querySelector('[aria-label=\"Project background and materials\"]')",
  );
  await snapshot("project-created-home");
  await click('button[aria-label="Manage project context"]');
  await until("document.body.textContent.includes('Fixed sources · 0 / 3')");
  await fill(
    'input[aria-label="Project description"]',
    "Shared research context",
  );
  await button("Save project", '[role="dialog"] button');
  await until("!document.querySelector('[role=dialog]')");
  await click('button[aria-label="Manage project context"]');
  await until(
    "document.querySelector('input[aria-label=\"Project description\"]')?.value === 'Shared research context'",
  );
  const file = path.join(dataDir, "project-notes.txt");
  await writeFile(file, "Synthetic fixed project evidence.");
  const document = await cdp("DOM.getDocument");
  const node = await cdp("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector: 'input[aria-label="Choose fixed project file"]',
  });
  await cdp("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [file] });
  await until("document.body.textContent.includes('Fixed sources · 1 / 3')");
  await fill(
    'textarea[aria-label="Project background"]',
    "Unsaved editor draft across resize.",
  );
  await snapshot("project-editor-1440");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await snapshot("project-editor-390");
  assert(
    await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
    "Project editor overflows on mobile",
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(
    await evaluate(
      "document.querySelector('textarea[aria-label=\"Project background\"]')?.value",
    ),
    "Unsaved editor draft across resize.",
  );
  await button("Cancel", '[role="dialog"] button');
  const project = (await api("/api/projects")).find(
    (p) => p.name === "Research fixture",
  );
  assert(project);
  await navigation.returnToChat();
  await navigation.moveConversation("Research fixture");
  await until(
    "![...document.querySelectorAll('.conversation-list button[title]')].some(b => b.getAttribute('title') === document.querySelector('.masthead__title')?.getAttribute('title'))",
  );
  await snapshot("project-chat-hidden-from-history");
  await until(
    "!!document.querySelector('[aria-label=\"Active project input\"]')",
  );
  await fill("#generation-input", "Compare project evidence");
  const baseline = requests.length;
  await click('button[aria-label="Send message"]');
  await until(
    "document.body.textContent.includes('Browser answer from model-one') && document.body.textContent.includes('Browser answer from model-two') && !document.querySelector('button[aria-label=\"Stop generation\"]')",
  );
  const sent = requests.slice(baseline);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].messages, sent[1].messages);
  assert.deepEqual(
    sent[0].messages.map((m) => m.role),
    ["system", "user"],
  );
  assert(sent[0].messages[1].content.includes("Original project background."));
  assert(
    sent[0].messages[1].content.includes("Synthetic fixed project evidence."),
  );
  const conversation = (await api("/api/conversations")).find(
    (c) => c.project_id === project.id,
  );
  assert(conversation);
  let view = await api(`/api/conversations/${conversation.id}`);
  const batch = view.generation_batches[0];
  batch.project_context = view.project_contexts[batch.project_context_id];
  assert.equal(batch.input_content, undefined);
  assert.equal(view.messages[0].body, "Compare project evidence");
  assert(
    batch.project_context.reference_prefix.includes(
      "Original project background.",
    ),
  );
  await snapshot("project-comparison-1440");
  const downloads = path.join(dataDir, "project-downloads");
  await mkdir(downloads);
  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  await button("View project evidence");
  await until(
    "!!document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').textContent.includes('Synthetic fixed project evidence.')",
  );
  await snapshot("project-source-citation");
  await button("Download original file", '[role="dialog"] button');
  let original;
  for (let i = 0; i < 50 && original === undefined; i++) {
    original = await readFile(
      path.join(downloads, "project-notes.txt"),
      "utf8",
    ).catch(() => undefined);
    if (original === undefined)
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    original,
    "Synthetic fixed project evidence.",
    "Project source download changed the original bytes",
  );
  await button("Close", '[role="dialog"] button');
  await api(
    `/api/generations/${batch.targets[0].generation.id}/select`,
    "POST",
    {},
  );
  await reloadPage();
  await navigation.openConversation(conversation.title);
  await until(
    "!!document.querySelector('[aria-label=\"Active project input\"]')",
  );
  await api(`/api/projects/${project.id}`, "PATCH", {
    name: project.name,
    description: project.description,
    instructions: "Updated project instruction.",
    background: "Changed project background.",
    revision: project.revision,
  });
  const conflictFile = path.join(dataDir, "conflict-draft.txt");
  await writeFile(conflictFile, "Preserved turn attachment.");
  const conflictDocument = await cdp("DOM.getDocument");
  const conflictInput = await cdp("DOM.querySelector", {
    nodeId: conflictDocument.root.nodeId,
    selector: 'input[type="file"][aria-label="Attach files"]',
  });
  await cdp("DOM.setFileInputFiles", {
    nodeId: conflictInput.nodeId,
    files: [conflictFile],
  });
  await until(
    "!!document.querySelector('button[aria-label=\"Remove attachment: conflict-draft.txt\"]')",
  );
  await evaluate(`(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.__coveProjectOriginalFetch = original;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input, location.origin);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.pathname === ${JSON.stringify(`/api/conversations/${conversation.id}`)} && method === "GET") {
        return Promise.reject(new TypeError("Synthetic project context refresh failure"));
      }
      return original(input, init);
    };
  })()`);
  await fill("#generation-input", "Preserve this draft after conflict");
  await until(
    "document.querySelector('button[aria-label=\"Send message\"]')?.disabled===false",
  );
  const beforeConflict = requests.length;
  await click('button[aria-label="Send message"]');
  await until(
    "document.body.textContent.includes('Project context changed') && document.querySelector('#generation-input')?.value==='Preserve this draft after conflict'",
  );
  assert.equal(
    requests.length,
    beforeConflict,
    "A stale project request reached the model",
  );
  await until(
    "document.body.textContent.includes('refreshed context could not be loaded') && !document.querySelector('button[aria-label=\"Stop generation\"]')",
  );
  assert(
    await evaluate(
      "!!document.querySelector('button[aria-label=\"Remove attachment: conflict-draft.txt\"]')",
    ),
    "A failed project refresh lost the draft file",
  );
  await evaluate(
    "globalThis.fetch=globalThis.__coveProjectOriginalFetch;delete globalThis.__coveProjectOriginalFetch",
  );
  await snapshot("project-conflict-preserved-draft");
  await click('button[aria-label="Review project context"]');
  await until(
    "document.body.textContent.includes('Preview only. Nothing has been sent to a model.')",
  );
  await snapshot("project-context-breakdown");
  await button("Close", '[role="dialog"] button');
  await click('button[aria-label="Send message"]');
  await until(
    "!document.querySelector('button[aria-label=\"Stop generation\"]') && document.querySelector('#generation-input')?.value===''",
  );
  const next = requests.slice(beforeConflict);
  assert.equal(next.length, 2);
  assert.deepEqual(
    next[0].messages.map((m) => m.role),
    ["system", "user", "assistant", "user"],
  );
  assert.equal(next[0].messages[1].content, "Compare project evidence");
  assert(
    !next[0].messages.at(-1).content.includes("Original project background."),
  );
  assert(
    next[0].messages.at(-1).content.includes("Changed project background."),
  );
  assert(
    next[0].messages.at(-1).content.includes("Preserved turn attachment."),
  );
  view = await api(`/api/conversations/${conversation.id}`);
  assert.equal(
    view.project_contexts[view.generation_batches[0].project_context_id]
      .background,
    "Original project background.",
  );
  const latestBatch = view.generation_batches.at(-1);
  await api(
    `/api/generations/${latestBatch.targets[0].generation.id}/select`,
    "POST",
    {},
  );
  let current = await api(`/api/projects/${project.id}`);
  current = await api(`/api/projects/${project.id}`, "PATCH", {
    name: current.name,
    description: current.description,
    instructions: current.instructions,
    revision: current.revision,
    background: "r".repeat(100000),
  });
  await reloadPage();
  await navigation.openConversation(conversation.title);
  await until(
    "!!document.querySelector('[aria-label=\"Active project input\"]')",
  );
  await fill("#generation-input", "q".repeat(150000));
  const beforeRecovery = requests.length;
  await click('button[aria-label="Send message"]');
  await until(
    "document.body.textContent.includes('Continue in a new conversation') && document.querySelector('#generation-input')?.value.length===150000",
  );
  await button("Continue in a new conversation");
  await until(
    "document.body.textContent.includes('Preview only. Nothing has been sent to a model.')",
  );
  assert.equal(
    await evaluate("document.querySelector('#generation-input')?.value.length"),
    150000,
  );
  assert.equal(
    requests.length,
    beforeRecovery,
    "Continuation automatically sent an oversized draft",
  );
  const continued = (await api("/api/conversations")).find(
    (c) => c.project_id === project.id && c.id !== conversation.id,
  );
  assert(continued, "Continuation did not retain project membership");
  assert.equal(
    (await api(`/api/conversations/${continued.id}`)).messages.length,
    0,
  );
  await button("Close", '[role="dialog"] button');
  await fill("#generation-input", "");
  await navigation.openProject("Research fixture");
  await click('button[aria-label="Project actions: Research fixture"]');
  await button("Dissolve project", '[role="menu"] button');
  await button("Confirm dissolution", '[role="dialog"] button');
  await until(
    "!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=\"Open project Research fixture\"]')",
  );
  await until(
    `!!document.querySelector(${JSON.stringify(`.conversation-list button[title=${JSON.stringify(conversation.title)}]`)})`,
  );
  await snapshot("dissolved-project-chats-return-to-history");
  view = await api(`/api/conversations/${conversation.id}`);
  assert.equal(view.project_id, undefined);
  const db = new DatabaseSync(path.join(dataDir, "cove.sqlite"));
  try {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM project_source_blobs").get().n,
      1,
      "Historical source bytes were removed",
    );
  } finally {
    db.close();
  }
  const disposable = await api("/api/projects", "POST", {
    name: "Disposable project",
    description: "",
    instructions: "",
    background: "",
  });
  const doomed = await api("/api/conversations", "POST", {
    title: "Disposable conversation",
    project_id: disposable.id,
  });
  await reloadPage();
  await navigation.openConversation("Disposable conversation");
  await until(
    "document.body.textContent.includes('Disposable conversation') && !!document.querySelector('[aria-label=\"Active project input\"]')",
  );
  await navigation.manageProject("Disposable project");
  await button(
    "Delete project and its conversations",
    '[role="dialog"] button',
  );
  await button("Confirm deletion", '[role="dialog"] button');
  await until(
    "!document.querySelector('[role=dialog]') && !document.querySelector('[aria-label=\"Active project input\"]')",
  );
  assert(!(await api("/api/conversations")).some((c) => c.id === doomed.id));
  await api("/api/data", "DELETE");
  const empty = new DatabaseSync(path.join(dataDir, "cove.sqlite"));
  try {
    assert.equal(
      empty.prepare("SELECT COUNT(*) AS n FROM project_source_blobs").get().n,
      0,
      "Last-reference source bytes were retained",
    );
  } finally {
    empty.close();
  }
  await reloadPage();
  await runProjectWorkflows({
    api,
    cdp,
    evaluate,
    until,
    click,
    fill,
    snapshot,
    reloadPage,
    dataDir,
    requests,
  });
}
