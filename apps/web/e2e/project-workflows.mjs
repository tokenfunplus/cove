import { projectNavigation } from "./project-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { markVisibleAction } from "./visible-action.mjs";

export async function runProjectWorkflows({
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
  async function button(label, selector = "button") {
    assert(
      await markVisibleAction(cdp, selector, label, "data-workflow-action"),
      `Missing workflow action: ${label}`,
    );
    await click('[data-workflow-action="true"]');
    await evaluate(
      "document.querySelector('[data-workflow-action]')?.removeAttribute('data-workflow-action')",
    );
  }
  const navigation = projectNavigation({ click, until, evaluate, button, api });
  const contexts = (view) =>
    view.generation_batches.map(
      (b) => view.project_contexts?.[b.project_context_id] ?? b.project_context,
    );
  const read = (id) => api(`/api/conversations/${id}`);
  async function open(title) {
    await navigation.openConversation(title);
  }

  async function sentAfter(count, expected = 2) {
    for (let i = 0; i < 100 && requests.length < count + expected; i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      requests.length,
      count + expected,
      "Unexpected model request count",
    );
    await until(
      "!document.querySelector('button[aria-label=\"Stop generation\"]') && document.querySelector('#generation-input')?.value===''",
    );
    return requests.slice(count);
  }
  async function send(body) {
    const before = requests.length;
    await fill("#generation-input", body);
    await click('button[aria-label="Send message"]');
    return sentAfter(before);
  }
  async function selectLast(id) {
    const view = await read(id),
      batch = view.generation_batches.at(-1);
    await api(
      `/api/generations/${batch.targets[0].generation.id}/select`,
      "POST",
      {},
    );
    return view;
  }
  const downloads = path.join(dataDir, "workflow-downloads");
  await mkdir(downloads);
  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  async function download(filename) {
    for (let i = 0; i < 80; i++) {
      const result = await readFile(
        path.join(downloads, filename),
        "utf8",
      ).catch(() => undefined);
      if (result !== undefined) return result;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail(`Missing workflow download: ${filename}`);
  }
  async function exportChat(title, format) {
    await click(
      `button[aria-label=${JSON.stringify(`Conversation actions: ${title}`)}]`,
    );
    await button("Download", '[role="menu"] button');
    await until("!!document.querySelector('[role=dialog]')");
    await button(`Download as ${format}`, '[role="dialog"] button');
    return download(
      `${title.replaceAll(":", "-")}.${format === "JSON" ? "json" : "md"}`,
    );
  }
  function blobCount() {
    const db = new DatabaseSync(path.join(dataDir, "cove.sqlite"));
    try {
      return db.prepare("SELECT COUNT(*) AS n FROM project_source_blobs").get()
        .n;
    } finally {
      db.close();
    }
  }
  const projectA = await api("/api/projects", "POST", {
    name: "Workflow A",
    instructions: "Project A instruction.",
    background: "Project A reference background.",
  });
  const withSource = await api(`/api/projects/${projectA.id}/sources`, "POST", {
    revision: projectA.revision,
    file: {
      name: "project-notes.txt",
      data: Buffer.from("Synthetic fixed project evidence.").toString("base64"),
    },
  });
  const projectB = await api("/api/projects", "POST", {
    name: "Workflow B",
    instructions: "Project B instruction.",
    background: "Project B reference background.",
  });
  const separate = await api("/api/conversations", "POST", {
    title: "Workflow separate A",
    project_id: projectA.id,
  });
  const original = await api("/api/conversations", "POST", {
    title: "Workflow original",
    project_id: projectA.id,
  });
  await reloadPage();
  await until("!!document.querySelector('button[aria-label=\"Projects\"]')");
  assert(
    !(await evaluate(
      "!!document.querySelector('[aria-label=\"Active project input\"]')",
    )),
    "Reload opened a project chat implicitly",
  );
  const lifecycle = await api("/api/conversations", "POST", {
    title: "Project selection fixture",
    project_id: projectA.id,
  });
  await navigation.openConversation(lifecycle.title);
  await navigation.openProject("Workflow A");
  await click(
    'button[aria-label="Conversation actions: Project selection fixture"]',
  );
  await button("Archive", '[role="menu"] button');
  await until(
    "!!document.querySelector('[aria-label=\"Project background and materials\"]') && document.querySelector('[aria-label=\"Project chats\"]')?.textContent.includes('Archived')",
  );
  assert(
    await evaluate(
      "document.querySelector('[aria-label=\"Project workspace\"] h1')?.textContent === 'Workflow A'",
    ),
    "Archiving the selected chat left the project home",
  );
  await click(
    'button[aria-label="Conversation actions: Project selection fixture"]',
  );
  await button("Unarchive", '[role="menu"] button');
  await navigation.openConversation(lifecycle.title);
  await navigation.openProject("Workflow A");
  await click(
    'button[aria-label="Conversation actions: Project selection fixture"]',
  );
  await button("Delete", '[role="menu"] button');
  await button("Delete", '[role="dialog"] button');
  await until(
    "!document.querySelector('[role=dialog]') && !document.querySelector('button[title=\"Project selection fixture\"]')",
  );
  assert(
    await evaluate(
      "document.querySelector('[aria-label=\"Project workspace\"] h1')?.textContent === 'Workflow A'",
    ),
    "Deleting the selected chat left the project home",
  );
  console.log(
    "Project workflow passed: startup excludes project chats and selected-chat archive/deletion preserve the project home.",
  );

  await navigation.openConversation(original.title);
  await until(
    "!!document.querySelector('[aria-label=\"Active project input\"]')",
  );
  const first = await send("First workflow question");
  assert.deepEqual(first[0].messages, first[1].messages);
  assert(first[0].messages.at(-1).content.includes(projectA.background));
  assert(
    first[0].messages
      .at(-1)
      .content.includes("Synthetic fixed project evidence."),
  );
  await selectLast(original.id);
  await reloadPage();
  await navigation.openConversation(original.title);
  await until(
    "!!document.querySelector('[aria-label=\"Active project input\"]')",
  );
  const second = await send("Second workflow question");
  assert.equal(second[0].messages[1].content, "First workflow question");
  assert.equal(
    second[0].messages.filter((m) => m.content.includes(projectA.background))
      .length,
    1,
  );
  const originalA = await selectLast(original.id);
  assert.equal(
    Object.keys(originalA.project_contexts).length,
    1,
    "Identical batch snapshots were duplicated on the wire",
  );
  console.log(
    "Project workflow passed: shared background across two turns and interned response payloads.",
  );
  const markdown = await exportChat(original.title, "Markdown");
  assert(
    markdown.includes(projectA.instructions) &&
      markdown.includes(projectA.background) &&
      markdown.includes("Synthetic fixed project evidence."),
  );
  const json = JSON.parse(await exportChat(original.title, "JSON"));
  assert.equal(
    json.generation_batches[0].project_context.background,
    projectA.background,
  );
  assert(
    !JSON.stringify(json).includes('"project_contexts"'),
    "Export retained the transport dictionary instead of hydrated snapshots",
  );

  await navigation.openProjects();
  await snapshot("projects-directory-with-cards");
  await navigation.openProject("Workflow A");
  await snapshot("project-home-with-chats");
  await click(
    `button[aria-label=${JSON.stringify(`Conversation actions: ${separate.title}`)}]`,
  );
  await button("Pin", '[role="menu"] button');
  await until(
    `document.querySelector('[aria-label="Project chats"] button[title]')?.title === ${JSON.stringify(separate.title)} && !!document.querySelector('[aria-label="Pinned conversation"]')`,
  );
  await snapshot("project-pinned-chat");
  await click(
    `button[aria-label=${JSON.stringify(`Conversation actions: ${separate.title}`)}]`,
  );
  await button("Unpin", '[role="menu"] button');
  await until(
    `document.querySelector('[aria-label="Project chats"] button[title]')?.title === ${JSON.stringify(original.title)}`,
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await snapshot("project-home-mobile");
  assert(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "Project home overflows on mobile",
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // The sidebar action remains an ordinary chat even while inside a project.
  await click('button[aria-label="New conversation"]');
  await until(
    "!document.querySelector('[aria-label=\"Project workspace\"]') && !!document.querySelector('#generation-input')",
  );
  const ungrouped = await send("Ordinary chat after project");
  assert(
    ungrouped.every((request) =>
      request.messages.every(
        (message) =>
          !message.content.includes(projectA.background) &&
          !message.content.includes(projectA.instructions),
      ),
    ),
    "Global New chat silently inherited project context",
  );
  const ordinary = (await api("/api/conversations")).find(
    (c) => c.title === "Ordinary chat after project",
  );
  assert(
    ordinary && !ordinary.project_id,
    "Global New chat was assigned to a project",
  );
  await open(original.title);
  await navigation.moveConversation("Workflow B");
  await until(
    "document.querySelector('[aria-label=\"Active project input\"]')?.textContent.includes('Workflow B')",
  );
  const third = await send("Question after moving to B");
  assert(third[0].messages[0].content.includes(projectB.instructions));
  assert(!third[0].messages[0].content.includes(projectA.instructions));
  assert(third[0].messages.at(-1).content.includes(projectB.background));
  assert(!third[0].messages.at(-1).content.includes(projectA.background));
  assert(
    !third[0].messages
      .at(-1)
      .content.includes("Synthetic fixed project evidence."),
  );
  const moved = await read(original.id),
    thirdBatch = moved.generation_batches.at(-1);
  assert.deepEqual(
    contexts(moved).map((p) => p.project_id),
    [projectA.id, projectA.id, projectB.id],
  );
  await snapshot("project-cross-move");
  await navigation.openProject("Workflow A");
  await fill(
    'input[aria-label="Search project chats"]',
    "First workflow question",
  );
  await until(
    "document.querySelector('[aria-label=\"Project chats\"]')?.textContent.includes('No matching chats')",
  );
  await navigation.openProject("Workflow B");
  await fill(
    'input[aria-label="Search project chats"]',
    "First workflow question",
  );
  await until(
    "document.querySelector('[aria-label=\"Project chats\"]')?.textContent.includes('Workflow original')",
  );
  await navigation.returnToChat();
  console.log(
    "Project workflow passed: Markdown/JSON exports and moving a conversation between projects.",
  );

  // Keep a quoted answer open while the main workspace switches projects.
  await evaluate(
    `(()=>{const p=document.querySelector('[data-generation-batch="${thirdBatch.id}"] [data-answer-source] p');const range=document.createRange();range.selectNodeContents(p);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));})()`,
  );
  await until(
    "!!document.querySelector('[aria-label=\"Selected text actions\"]')",
  );
  await button("Explain", '[aria-label="Selected text actions"] button');
  await open("Workflow separate A");
  const beforeSide = requests.length;
  await button("Send question", 'aside[aria-label="Answer tools"] button');
  await sentAfter(beforeSide);
  const side = (await api("/api/conversations")).find(
    (c) => c.id !== original.id && c.project_id === projectB.id,
  );
  assert(
    side,
    "Side conversation inherited the main workspace's project instead of its source answer",
  );
  const sideView = await read(side.id);
  assert.equal(contexts(sideView)[0].project_id, projectB.id);
  assert(requests.at(-1).messages.at(-1).content.includes(projectB.background));
  assert(
    !requests.at(-1).messages.at(-1).content.includes(projectA.background),
  );
  await snapshot("project-side-origin");
  await click('button[aria-label="Close answer tools"]');
  await open(original.title);
  await until(
    `!!document.querySelector('[data-timeline-anchor="${thirdBatch.user_message_id}"]')`,
  );
  await button(
    "Edit and resend",
    `[data-timeline-anchor="${thirdBatch.user_message_id}"] button`,
  );
  await until("!!document.querySelector('[role=dialog] textarea')");
  await fill('[role="dialog"] textarea', "Branched project question");
  const beforeBranch = requests.length;
  await button("Send in new branch", '[role="dialog"] button');
  await sentAfter(beforeBranch);
  const branch = (await api("/api/conversations")).find(
    (c) =>
      c.project_id === projectB.id && c.id !== original.id && c.id !== side.id,
  );
  assert(branch, "Editing did not create a project branch");
  let branchView = await read(branch.id);
  assert.equal(branchView.branch.source_batch_id, thirdBatch.id);
  assert.deepEqual(
    contexts(branchView).map((p) => p.project_id),
    [projectA.id, projectA.id, projectB.id],
  );
  assert.equal(
    contexts(branchView)[0].reference_prefix,
    contexts(originalA)[0].reference_prefix,
  );
  assert.equal((await read(original.id)).generation_batches.length, 3);
  assert(requests.at(-1).messages.at(-1).content.includes(projectB.background));
  await snapshot("project-branch-inheritance");
  console.log(
    "Project workflow passed: side-conversation origin after navigation and edited branch inheritance.",
  );

  // Remove the source conversation from its project while keeping the branch selected.
  await navigation.openProject("Workflow B");
  await click(
    `button[aria-label=${JSON.stringify(`Conversation actions: ${original.title}`)}]`,
  );
  await button("Delete", '[role="menu"] button');
  await button("Delete", '[role="dialog"] button');
  await until("!document.querySelector('[role=dialog]')");
  assert(!(await api("/api/conversations")).some((c) => c.id === original.id));
  await navigation.manageProject("Workflow A");
  await until("!!document.querySelector('[role=dialog]')");
  await button(
    "Delete project and its conversations",
    '[role="dialog"] button',
  );
  assert(
    await evaluate(
      "document.querySelector('[role=dialog]').textContent.includes('historical snapshots')",
    ),
  );
  await button("Confirm deletion", '[role="dialog"] button');
  await until("!document.querySelector('[role=dialog]')");
  assert(!(await api("/api/projects")).some((p) => p.id === withSource.id));
  assert.equal(
    blobCount(),
    1,
    "Deleting live project removed a branch-owned source",
  );
  await navigation.returnToChat();
  await button("View project evidence");
  await until("!!document.querySelector('[role=dialog]')");
  await button("Download original file", '[role="dialog"] button');
  assert.equal(
    await download("project-notes.txt"),
    "Synthetic fixed project evidence.",
  );
  await button("Close", '[role="dialog"] button');
  branchView = await read(branch.id);
  const branchMarkdown = await exportChat(branch.title, "Markdown");
  assert(
    branchMarkdown.includes(projectA.background) &&
      branchMarkdown.includes(projectB.background) &&
      branchMarkdown.includes("Synthetic fixed project evidence."),
  );
  const branchJSON = JSON.parse(await exportChat(branch.title, "JSON"));
  assert.equal(
    branchJSON.generation_batches[0].project_context.project_id,
    projectA.id,
  );
  assert.equal(
    branchJSON.generation_batches.at(-1).project_context.project_id,
    projectB.id,
  );
  await snapshot("project-surviving-branch");
  console.log(
    "Project workflow passed: deleting the source conversation/project preserves branch citations, downloads and exports.",
  );

  let liveB = await api(`/api/projects/${projectB.id}`);
  liveB = await api(`/api/projects/${liveB.id}/sources`, "POST", {
    revision: liveB.revision,
    file: {
      name: "live-b.txt",
      data: Buffer.from(
        "Live B source retained after clearing history.",
      ).toString("base64"),
    },
  });
  await click('button[aria-label="Settings"]');
  await click("#settings-tab-chat-data");
  await button("Clear chat data", ".danger button");
  await button("Clear chat data", ".confirmation-dialog__panel button");
  await until("!document.querySelector('.confirmation-dialog__panel')");
  await click('button[aria-label="Close settings"]');
  const retained = await api(`/api/projects/${projectB.id}`);
  assert.equal(retained.sources.length, 1);
  assert.equal(retained.background, projectB.background);
  assert.equal(retained.conversation_count, 0);
  assert.equal(
    blobCount(),
    1,
    "Clearing history did not collect the orphaned A source or removed the live B source",
  );
  assert.equal((await api("/api/conversations")).length, 0);
  console.log(
    "Project workflow passed: clearing history retains the live project and its source, and collects orphaned blobs.",
  );

  // Dissolution must not stop active work; destructive deletion must stop it.
  await navigation.openProject("Workflow B");
  await snapshot("project-home-page");
  await click('button[aria-label="New chat in project"]');
  await until(
    "!!document.querySelector('[aria-label=\"Active project input\"]')",
  );
  await fill("#generation-input", "Project lifecycle fixture");
  await click('button[aria-label="Send message"]');
  await until(
    "!!document.querySelector('button[aria-label=\"Stop generation\"]')",
  );
  await navigation.manageProject("Workflow B");
  await button("Dissolve and keep conversations", '[role="dialog"] button');
  await button("Confirm dissolution", '[role="dialog"] button');
  await until(
    "document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('active work')",
  );
  const activeMember = (await api("/api/conversations")).find(
    (c) => c.project_id === projectB.id,
  );
  assert(activeMember, "Dissolution removed the active conversation");
  const running = await read(activeMember.id);
  assert(
    running.generation_batches
      .at(-1)
      .targets.some((t) =>
        ["pending", "streaming"].includes(t.generation.state),
      ),
    "Dissolution stopped active work",
  );
  assert((await api("/api/projects")).some((p) => p.id === projectB.id));
  await snapshot("project-dissolve-refused-active");
  await button("Cancel removal", '[role="dialog"] button');
  await click('button[aria-label="Project actions: Workflow B"]');
  await button("Delete project", '[role="menu"] button');
  await button("Confirm deletion", '[role="dialog"] button');
  await until(
    "!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=\"Stop generation\"]')",
  );
  assert.equal((await api("/api/conversations")).length, 0);
  assert.equal((await api("/api/projects")).length, 0);
  assert.equal(blobCount(), 0, "Last source owner was not collected");
  await reloadPage();
  console.log(
    "Project workflow passed: active dissolution is refused and destructive deletion stops work before removing its records.",
  );
}
