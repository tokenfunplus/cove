import assert from "node:assert/strict";
import { markVisibleAction } from "./visible-action.mjs";
export async function runInteractiveAcceptance({
  api,
  cdp,
  evaluate,
  until,
  click,
  fill,
  snapshot,
  reloadPage,
  requests,
}) {
  async function button(text, selector = "button") {
    assert(
      await markVisibleAction(cdp, selector, text, "data-card-action"),
      "Missing card action: " + text,
    );
    await click('[data-card-action="true"]');
    await evaluate(
      "document.querySelector('[data-card-action]')?.removeAttribute('data-card-action')",
    );
  }
  const settings = await api("/api/settings");
  await api("/api/settings", "PATCH", {
    ...settings,
    active_model_set: [settings.active_model_set[0]],
  });
  await reloadPage();
  await until("!!document.querySelector('#generation-input')");
  assert.equal(
    await evaluate(
      "document.querySelector('.generation-composer').textContent.includes('Interactive replies')",
    ),
    false,
    "Interactive capability must not require a visible mode switch",
  );
  await fill("#generation-input", "Natural greeting fixture");
  await click(".generation-composer__send");
  await until(
    "document.querySelector('.message-list')?.textContent.includes('Hello! How has your day been?') && !document.querySelector('.generation-composer__send[aria-label=\"Stop generation\"]')",
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('section[aria-label=\"Interactive reply\"]').length",
    ),
    0,
    "An ordinary text response must not be forced into a card",
  );
  await fill("#generation-input", "Interactive fixture quiz");
  await click(".generation-composer__send");
  await until(
    "!!document.querySelector('section[aria-label=\"Interactive reply\"] [role=radio]')",
  );
  const initialCount = requests.length;
  await button("Continue story");
  await until(
    "document.querySelector('[role=alert]')?.textContent==='Choose an option before continuing.'",
  );
  assert.equal(
    requests.length,
    initialCount,
    "An incomplete card contacted a Provider",
  );
  assert.equal(
    await evaluate("document.activeElement?.getAttribute('role')"),
    "radio",
  );

  await click(
    'section[aria-label="Interactive reply"] [role=radio][value="radio"]',
  );
  await button("Check answer");
  await until(
    "document.querySelector('section[aria-label=\"Interactive reply\"]').textContent.includes('The radio was recently used.')",
  );
  assert.equal(
    requests.length,
    initialCount,
    "Local actions contacted a Provider",
  );
  await until(
    "document.querySelector('section[aria-label=\"Interactive reply\"]').textContent.includes('Saved on this Mac')",
  );
  await snapshot("interactive-quiz-checked");
  await reloadPage();
  await until("!!document.querySelector('[role=radio][aria-checked=true]')");
  assert.equal(
    await evaluate(
      "document.querySelector('[role=radio][aria-checked=true]').textContent",
    ),
    "Examine the abandoned radio",
  );
  await button("Expand");
  await until(
    "!!document.querySelector('[role=dialog] [role=radio][aria-checked=true]')",
  );
  await snapshot("interactive-expanded");
  await button("Close", "[role=dialog] button");
  const conversation = (await api("/api/conversations"))[0];
  const view = await api("/api/conversations/" + conversation.id);
  const generation = view.generation_batches.at(-1).targets[0].generation.id;
  const saved = await api(
    "/api/generations/" + generation + "/interactive-card",
    "POST",
  );
  assert.equal(saved.values.next_action, "radio");
  assert.equal(saved.checks.feedback, "radio");
  await fill("#generation-input", "Keep this unrelated draft");
  await button("Continue story");
  await until(
    "document.querySelectorAll('section[aria-label=\"Interactive reply\"]').length===2",
  );
  assert.equal(
    await evaluate("document.querySelector('#generation-input').value"),
    "Keep this unrelated draft",
  );
  assert.equal(
    requests.length,
    initialCount + 1,
    "Continuation did not create exactly one Provider request",
  );
  assert(requests.at(-1).messages.at(-1).content.includes("interaction-v1"));
  assert(
    requests.at(-1).messages.at(-1).content.includes('"next_action":"radio"'),
  );
  assert(
    !requests
      .at(-1)
      .messages.at(-1)
      .content.includes("Keep this unrelated draft"),
  );
  assert(
    requests
      .at(-1)
      .messages[0].content.includes("[Cove interactive replies: cove_ui 1]"),
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await snapshot("interactive-mobile");
  assert(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "Interactive card overflowed mobile layout",
  );
  await snapshot("interactive-story-continuation");

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(
    await evaluate(
      "document.querySelector('[role=checkbox][aria-label=\"Include current card\"]')?.getAttribute('aria-checked')",
    ),
    "false",
  );
  await fill("#generation-input", "Interactive fixture playground");
  await click(".generation-composer__send");
  await until(
    "!!document.querySelector('[aria-label=\"Invitation text\"],textarea[id*=draft]')",
  );
  const richCount = requests.length;
  await button("↑", 'button[aria-label="Move Explore a small gallery up"]');
  await button("+", 'button[aria-label="Increase Food"]');
  await evaluate(
    "document.querySelector('textarea[id*=draft]').scrollIntoView({block:'center'})",
  );
  await fill("textarea[id*=draft]", "A freshly edited invitation.");
  await until(
    "document.querySelector('[aria-label=\"Invitation preview\"]').textContent.includes('A freshly edited invitation.')",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[aria-label=\"Weekend budget balance\"]').textContent.trim()",
    ),
    "Remaining: 45 USD",
  );
  assert.equal(
    requests.length,
    richCount,
    "Local rich edits contacted a Provider",
  );
  await button("Undo");
  await until(
    "document.querySelector('textarea[id*=draft]').value==='Join me for a slow Saturday afternoon.'",
  );
  await button("Redo");
  await until(
    "document.querySelector('textarea[id*=draft]').value==='A freshly edited invitation.'",
  );
  await until(
    "document.querySelectorAll('section[aria-label=\"Interactive reply\"]')[2].textContent.includes('Saved on this Mac')",
  );
  await reloadPage();
  await until(
    "document.querySelector('textarea[id*=draft]')?.value==='A freshly edited invitation.'",
  );
  assert.equal(
    await evaluate(
      "[...document.querySelector('ol[aria-label=\"Afternoon itinerary\"]').children].map(e=>e.textContent).join('|').indexOf('Explore a small gallery') < [...document.querySelector('ol[aria-label=\"Afternoon itinerary\"]').children].map(e=>e.textContent).join('|').indexOf('Lunch with a friend')",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[aria-label=\"Food value\"]').textContent.trim()",
    ),
    "35 USD",
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await snapshot("interactive-rich-mobile");
  assert(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "Rich controls overflowed narrow layout",
  );
  await click('[role=checkbox][aria-label="Include current card"]');
  await fill("#generation-input", "Can we make this cheaper?");
  await until(
    "document.querySelector('[role=checkbox][aria-label=\"Include current card\"]')?.getAttribute('aria-checked')==='true'",
  );
  await button("Review context");
  await until(
    "document.querySelector('[role=dialog]')?.textContent.includes('\"remaining\":45') && document.querySelector('[role=dialog]').textContent.includes('A freshly edited invitation.')",
  );
  assert.equal(
    requests.length,
    richCount,
    "Context preview contacted a Provider",
  );
  await button("Close", "[role=dialog] button");
  await click(".generation-composer__send");
  await until(
    "document.querySelector('.message-list').textContent.includes('I have your updated plan and invitation.')",
  );
  assert.equal(
    requests.length,
    richCount + 1,
    "Rich continuation did not create exactly one Provider request",
  );
  const richInput = requests.at(-1).messages.at(-1).content;
  assert(richInput.startsWith("Can we make this cheaper?"));
  assert(richInput.includes('"intent":"discuss"'));
  assert(richInput.includes('"order":["walk","gallery","lunch"]'));
  assert(richInput.includes('"remaining":45'));
  assert(richInput.includes('"calculation":"allocation-sum-v1"'));
  assert(richInput.includes("A freshly edited invitation."));
  assert.equal(
    await evaluate("document.querySelector('textarea[id*=draft]').disabled"),
    true,
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await fill("#generation-input", "Interactive fixture playground");
  await click(".generation-composer__send");
  await until("document.querySelectorAll('textarea[id*=draft]').length===2");
  await until(
    "document.querySelector('[role=checkbox][aria-label=\"Include current card\"]')?.getAttribute('aria-checked')==='false'",
  );
  await click('[role=checkbox][aria-label="Include current card"]');
  await click('[role=checkbox][aria-label="Include current card"]');
  await fill("#generation-input", "A completely unrelated follow-up");
  await click(".generation-composer__send");
  await until(
    "!document.querySelector('.generation-composer__send[aria-label=\"Stop generation\"]')",
  );
  assert.equal(
    requests.at(-1).messages.at(-1).content,
    "A completely unrelated follow-up",
    "Removed card reference was still sent",
  );
  await fill("#generation-input", "Malformed interactive fixture");
  await click(".generation-composer__send");
  await until(
    "document.querySelector('.message-list')?.textContent.includes('Preparing an interactive reply')",
  );
  assert(
    !(await evaluate(
      "document.querySelector('.message-list').textContent.includes('\"cove_ui\"')",
    )),
    "Raw card JSON leaked into streaming presentation",
  );
  await until(
    "document.querySelector('.message-list').textContent.includes('This interactive reply is unavailable')",
  );
  assert.equal(
    await evaluate("document.querySelector('#generation-input').disabled"),
    false,
  );
  await fill("#generation-input", "Natural greeting fixture");
  await click(".generation-composer__send");
  await until(
    "!document.querySelector('.generation-composer__send[aria-label=\"Stop generation\"]')",
  );
  assert.equal(
    requests.at(-1).messages.at(-1).content,
    "Natural greeting fixture",
    "Invalid card blocked an ordinary follow-up",
  );
  await fill("#generation-input", "Local nested UI fixture");
  await click(".generation-composer__send");
  await until(
    "document.querySelector('.message-list').textContent.includes('Local interaction. No message is sent.')",
  );
  const localCount = requests.length;
  await button("Reveal the word");
  await until(
    "document.querySelector('.message-list').textContent.includes('A happy accident.')",
  );
  assert.equal(
    requests.length,
    localCount,
    "Local-only card contacted a Provider",
  );
  await evaluate(
    "[...document.querySelectorAll('section[aria-label=\"Interactive reply\"]')].at(-1).setAttribute('data-local-card','true')",
  );
  await button("Expand", "[data-local-card] button");
  await until("!!document.querySelector('[role=dialog]')");
  assert(
    await evaluate(
      "Math.abs(document.querySelector('[role=dialog]').getBoundingClientRect().right-innerWidth)<2",
    ),
    "Wide expansion was not a side panel",
  );
  await button("Close", "[role=dialog] button");
  await fill("#generation-input", "Repaired nested UI fixture");
  await click(".generation-composer__send");
  await until(
    "document.querySelector('.message-list').textContent.includes('Repair a weekend choice') && !!document.querySelector('button') && !document.querySelector('.generation-composer__send[aria-label=\"Stop generation\"]')",
  );
  await evaluate(
    "[...document.querySelectorAll('section[aria-label=\"Interactive reply\"]')].at(-1).setAttribute('data-repaired-card','true')",
  );
  await until("!!document.querySelector('[data-repaired-card] [role=radio]')");
  assert(
    await evaluate(
      "document.querySelector('.message-list').textContent.includes('This paragraph survives the repair.')",
    ),
    "Bracket repair lost surrounding prose",
  );
  const beforeRepairGesture = requests.length;
  await click("[data-repaired-card] [role=radio]");
  await until(
    "document.querySelector('[data-repaired-card]').textContent.includes('Saved on this Mac')",
  );
  assert.equal(
    requests.length,
    beforeRepairGesture,
    "Selecting a repaired choice contacted a Provider",
  );
  await reloadPage();
  await until(
    "[...document.querySelectorAll('section[aria-label=\"Interactive reply\"]')].at(-1)?.querySelector('[role=radio][aria-checked=true]')?.textContent==='A gallery'",
  );
  console.log(
    "Repaired model output acceptance passed: bounded bracket repair, preserved prose, interactive choice and saved reload.",
  );
  console.log(
    "Nested/local-only acceptance passed: compact JSON normalized, local reveal, no model request, wide side panel.",
  );
  console.log(
    "Malformed model output acceptance passed: streaming source hidden, safe fallback, and ordinary chat remains usable.",
  );
  console.log(
    "Natural follow-up acceptance passed: visible removable reference, preview parity, current values, and ordinary opt-out.",
  );
  console.log(
    "Rich browser acceptance passed: reordering, linked sliders, text preview, undo/redo, saved reload, frozen continuation, and narrow layout.",
  );
  console.log(
    "Interactive browser acceptance passed: local feedback, reload, expansion, one continuation, preserved composer draft, authoritative state, and narrow layout.",
  );
}
