import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runReviewBookUpgrade({ packageFixtures, installPackageFixture,
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
  const catalog = { packages: packageFixtures };
  const entry = catalog.packages.find(
    (item) => item.app === "japanese-review-book" && item.version === "1.1.0",
  );
  const release = await installPackageFixture(entry);
  await goto(path + "/home");
  await button("Settings");
  await until(
    "Array.from(document.querySelectorAll('select option')).some(option=>option.value==='" +
      release.id +
      "')",
  );
  await evaluate(
    `{const select=Array.from(document.querySelectorAll('select')).find(select=>Array.from(select.options).some(option=>option.value===${JSON.stringify(release.id)}));select.value=${JSON.stringify(release.id)};select.dispatchEvent(new Event('change',{bubbles:true}));}`,
  );
  await button("Migrate and activate release");
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
  await button("Question library");
  await readyRows(3);
  const selectedQuestion = await evaluate(
    `document.querySelector('[aria-label="Select record 1"]').parentElement.querySelector('.study-record-open strong').textContent`,
  );
  const selectedCards = after.filter((row) => row.fields.question === selectedQuestion);
  assert.equal(selectedCards.length, 1, "The first displayed question identifies one saved card");
  const selectedID = selectedCards[0].id;
  await click('[aria-label="Select record 1"]');
  await button("Edit question and answer");
  assert(
    await evaluate(
      `document.querySelector('[aria-label="Select record 2"]').disabled`,
    ),
    "An editor keeps its target fixed",
  );
  await evaluate(
    `document.querySelector('[aria-label="Select record 2"]').click()`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('section[aria-label="Edit question and answer"] label')).find(label => label.firstChild.textContent.trim() === 'Question').querySelector('textarea').setAttribute('data-edit-question', '')`,
  );
  await fill("[data-edit-question]", "Reviewed first card");
  await button("Preview changes");
  await button("Confirm changes");
  await until(
    "!document.querySelector('section[aria-label=\"Edit question and answer\"]')",
  );
  const edited = (await api(root + book.id + "/export")).collections.questions;
  assert.deepEqual(
    edited.map((row) => row.id).sort(),
    after.map((row) => row.id).sort(),
    "Editing a question preserves the complete record ID set",
  );
  assert.equal(
    edited.find((row) => row.id === selectedID)?.fields.question,
    "Reviewed first card",
    "The edited question retains the selected record's ID",
  );
  for (const row of after.filter((row) => row.id !== selectedID)) {
    assert.deepEqual(
      edited.find((saved) => saved.id === row.id),
      row,
      "Another question cannot be overwritten by changing selection",
    );
  }
  await goto(path + "/home");
  await readyRows(3);
  await button("Due for review");
  const filterOptions =
    "Array.from(document.querySelectorAll('summary')).find(element=>element.textContent.trim()==='Filter options')";
  await until("!!(" + filterOptions + ")");
  assert.equal(
    await evaluate("(" + filterOptions + ").parentElement.open"),
    false,
  );
  await evaluate("(" + filterOptions + ").click()");
  await until("(" + filterOptions + ").parentElement.open");
  await fill('input[type="number"]', "1");
  await button("Find records");
  await readyRows(1);
  await until(`!!document.querySelector('[aria-label="Study overview"]')`);
  await evaluate("window.scrollTo(0, 0)");
  await snapshot("study-book-overview");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert(
    await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
    "Study overview fits a narrow screen",
  );
  await snapshot("study-book-mobile");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
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
  await evaluate("window.scrollTo(0, 0)");
  await snapshot("study-book-practice");
  await button("Show answer");
  await button("Mark learned and review in a week");
  await snapshot("study-book-confirmation");
  await button("Confirm change");
  await until("document.body.textContent.includes('Practice complete')");
  await button("Return to book");
  await button("Question library");
  await readyRows(3);
  await button("Learned questions");
  await readyRows(1);
  await click('[aria-label="Select record 1"]');
  await button("Edit question and answer");
  await evaluate(
    `Array.from(document.querySelectorAll('section[aria-label="Edit question and answer"] label')).find(label => label.firstChild.textContent.trim() === 'Question').querySelector('textarea').setAttribute('data-edit-question', '')`,
  );
  await fill("[data-edit-question]", "Corrected card");
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
  await evaluate(
    `Array.from(document.querySelector('[aria-label="Select record 1"]').parentElement.querySelectorAll('button')).find(button => button.textContent.includes('Generate practice questions')).setAttribute('data-material-generate', '')`,
  );
  await click("[data-material-generate]");
  await until(
    `document.querySelector('section[aria-label="Generate practice questions"] textarea')?.value === 'Mini App study fixture'`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="Select record 1"]').checked`,
    ),
    false,
    "A material can start generation without selecting it first",
  );
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
  await evaluate(
    `Array.from(document.querySelectorAll('.study-record-open')).find(button => button.textContent.includes('Lesson passage')).click()`,
  );
  await button("Source · Lesson passage");
  await until("document.body.textContent.includes('Mini App study fixture')");
  const linked = (
    await api(root + book.id + "/export")
  ).collections.questions.find((r) => r.fields.source === material.id);
  assert.equal(linked?.fields.answer, "Fixture answer");
}
