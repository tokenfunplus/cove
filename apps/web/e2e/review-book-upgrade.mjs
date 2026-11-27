import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runReviewBookUpgrade({
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
}) {
  const root = "/api/mini-apps/instances/";
  const old = await api(root + first);
  const book = await api("/api/mini-apps/instances", "POST", {
    name: "Upgrade practice",
    release_id: old.instance.release_id,
    grants: old.package.capabilities,
  });
  const path = "/apps/" + book.id;
  const before = (await api(root + book.id + "/export")).collections.questions;
  assert.equal(before.length, 3);
  await goto(path + "/home");
  await button("Settings");
  await button("Check for updates");
  await button("Upgrade instance to 1.1.0");
  await until("document.body.textContent.includes('v1.1.0')");
  await goto(path + "/home");
  const after = (await api(root + book.id + "/export")).collections.questions;
  for (const card of before) {
    const migrated = after.find((r) => r.id === card.id);
    assert.deepEqual(migrated.fields, {
      ...card.fields,
      archived: false,
      source: "",
      sourceTitle: "",
    });
  }
  await readyRows(3);
  await button("Due for review");
  await fill('input[type="number"]', "1");
  await button("Find records");
  await readyRows(1);
  await button("Start practice (1)");
  await until("document.body.textContent.includes('Card 1 of 1')");
  const speech = await api(root + book.id + "/capabilities");
  await button("Read in Japanese");
  if (speech.capabilities["speech.speak"] === "available") {
    await until("document.querySelector('audio')?.duration > 0");
    assert.match(
      await evaluate("document.querySelector('audio').src"),
      /^blob:/,
    );
    await button("Close reading");
  } else {
    await until(
      "document.body.textContent.includes('No installed macOS Japanese voice')",
    );
  }
  await button("Show answer");
  await button("Mark learned and review in a week");
  await button("Confirm change");
  await until("document.body.textContent.includes('Practice complete')");
  await button("Return to book");
  await button("Question library");
  await readyRows(3);
  await button("Learned questions");
  await readyRows(1);
  await click('[aria-label="Select record 1"]');
  await button("Edit question and answer");
  await fill(
    'section[aria-label="Edit question and answer"] textarea',
    "Corrected card",
  );
  await button("Preview changes");
  await button("Confirm changes");
  await until(
    "document.body.textContent.includes('Corrected card') && !document.querySelector('button[aria-label=\"Confirm changes\"]') && !document.querySelector('section[aria-label=\"Edit question and answer\"]')",
  );
  await click('[aria-label="Select record 1"]');
  await button("Archive selected questions");
  await button("Preview changes");
  await button("Confirm changes");
  await readyRows(0);
  await button("Archive");
  await readyRows(1);
  await click('[aria-label="Select record 1"]');
  await button("Restore selected questions");
  await button("Preview changes");
  await button("Confirm changes");
  await readyRows(0);
  await button("Question library");
  await readyRows(3);
  await button("Learned questions");
  await readyRows(1);
  await click('[aria-label="Select record 1"]');
  await button("Archive selected questions");
  await button("Preview changes");
  await button("Confirm changes");
  await readyRows(0);
  await button("Archive");
  await readyRows(1);
  await click('[aria-label="Select record 1"]');
  await button("Permanently delete archived questions");
  await button("Preview changes");
  assert.equal(
    (await api(root + book.id + "/export")).collections.questions.length,
    3,
  );
  await button("Confirm permanent deletion");
  await readyRows(0);
  assert.equal(
    (await api(root + book.id + "/export")).collections.questions.length,
    2,
  );

  // Generated cards retain the selected material when candidate rows are saved.
  const save = {
    action: "material.save",
    surface: "page",
    operation_id: randomUUID(),
    inputs: { title: "Lesson passage", passage: "Mini App study fixture" },
  };
  const savePath = root + book.id + "/actions/material.save";
  const preview = await api(savePath, "POST", save);
  const material = (
    await api(savePath, "POST", { ...save, confirm: preview.confirmation })
  ).records[0];
  await button("Study material");
  await readyRows(1);
  await click('[aria-label="Select record 1"]');
  await button("Generate practice questions");
  await fill('input[type="number"]', "1");
  await click("input[type=checkbox]:not([aria-label])");
  await until(
    "Array.from(document.querySelectorAll('select option')).some(o=>o.value===" +
      JSON.stringify(profile.id) +
      ")",
  );
  async function chooseModel(value) {
    await evaluate(
      `{const s=Array.from(document.querySelectorAll("select")).find(s=>Array.from(s.options).some(o=>o.value===${JSON.stringify(value)}));s.value=${JSON.stringify(value)};s.dispatchEvent(new Event("change",{bubbles:true}));}`,
    );
  }
  await chooseModel(profile.id);
  await until(
    "Array.from(document.querySelectorAll('select option')).some(o=>o.value==='model-one')",
  );
  await chooseModel("model-one");
  await fill(
    'section[aria-label="Generate practice questions"] textarea',
    "Mini App excess candidate fixture",
  );
  await button("Start model task");
  await until(
    "document.body.textContent.includes('Expected 1 valid candidates')",
  );
  assert.equal(
    await evaluate(
      "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Use candidate 1')",
    ),
    false,
  );
  assert.equal(
    (await api(root + book.id + "/export")).collections.questions.length,
    2,
  );
  await fill(
    'section[aria-label="Generate practice questions"] textarea',
    "Mini App study fixture",
  );
  await button("Start model task");
  await button("Use candidate 1");
  await button("Preview changes");
  await button("Confirm changes");
  await until(
    "!document.querySelector('section[aria-label=\"Save a question\"]')",
  );
  await button("Question library");
  await readyRows(3);
  await button("Source · Lesson passage");
  await until("document.body.textContent.includes('Mini App study fixture')");
  const linked = (
    await api(root + book.id + "/export")
  ).collections.questions.find((r) => r.fields.source === material.id);
  assert.equal(linked?.fields.answer, "Fixture answer");
}
