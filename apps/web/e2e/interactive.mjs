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
  async function assertStableTextPress(selector) {
    const geometry = () =>
      evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.trim()) { text = walker.currentNode; break; }
      }
      const range = document.createRange(); range.selectNodeContents(text);
      const r = range.getBoundingClientRect();
      return {x:r.x, y:r.y, width:r.width, height:r.height};
    })()`);
    const before = await geometry();
    const point = await evaluate(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:r.x+r.width/2, y:r.y+r.height/2};
    })()`);
    const settle = () =>
      evaluate("new Promise(resolve => setTimeout(resolve, 350))");
    const stable = (sample, phase) => {
      for (const dimension of ["x", "y", "width", "height"]) {
        assert(
          Math.abs(sample[dimension] - before[dimension]) < 0.5,
          `${phase} moved or scaled text (${dimension}) in ${selector}`,
        );
      }
    };
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await settle();
    stable(await geometry(), "Hover");
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await settle();
    stable(await geometry(), "Press");
    // Cancel the click so this check never submits the continuation button.
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 8 });
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 8,
      y: 8,
      button: "left",
      clickCount: 1,
    });
    await settle();
    stable(await geometry(), "Release");
  }
  async function assertStableFooterSave(selector) {
    await cdp("Network.emulateNetworkConditions", {
      offline: false,
      latency: 350,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await evaluate(`(() => {
    window.__footerSamples = [];
    window.__sampleFooter = true;
    const sample = () => {
      if (!window.__sampleFooter) return;
      const status = document.querySelector('[role=dialog] span[role=status]');
      const footer = status.parentElement;
      const question = footer.querySelector('[data-slot=button]');
      const details = footer.querySelector('[data-slot=disclosure-trigger]');
      const rect = element => {
        const r = element.getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height};
      };
      window.__footerSamples.push({label:status.textContent.trim(),status:rect(status),question:rect(question),details:rect(details)});
      requestAnimationFrame(sample);
    };
    sample();
  })()`);
    await click(selector);
    await until(
      "document.querySelector('[role=dialog] span[role=status]')?.textContent.trim()==='Saved on this Mac'",
    );
    const footerMotion = await evaluate(`(() => {
    window.__sampleFooter = false;
    const samples = window.__footerSamples;
    const maxDelta = {};
    for (const key of ['status','question','details']) {
      maxDelta[key] = Math.max(...samples.flatMap(sample =>
        ['x','y','width','height'].map(dimension => Math.abs(sample[key][dimension] - samples[0][key][dimension]))));
    }
    delete window.__footerSamples; delete window.__sampleFooter;
    return {samples:samples.length,states:[...new Set(samples.map(s => s.label))],maxDelta};
  })()`);
    await cdp("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    assert(
      footerMotion.states.includes("Saving…"),
      "Footer geometry must be sampled during an actual save",
    );
    assert(
      Object.values(footerMotion.maxDelta).every((delta) => delta < 0.5),
      "Saving changed footer geometry: " + JSON.stringify(footerMotion),
    );
    return footerMotion;
  }
  async function observeTransitions() {
    await evaluate(`(() => {
    window.__cardTransitions = [];
    window.__recordCardTransition = event => {
      if (event.target.closest('[role=radio]')) window.__cardTransitions.push('choice:' + event.propertyName);
      if (event.target.matches('circle[pathLength]')) window.__cardTransitions.push('budget:' + event.propertyName);
    };
    document.addEventListener('transitionrun', window.__recordCardTransition);
  })()`);
  }
  async function stopObservingTransitions() {
    await evaluate(
      "document.removeEventListener('transitionrun', window.__recordCardTransition); delete window.__recordCardTransition; delete window.__cardTransitions",
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

  await observeTransitions();
  await click(
    'section[aria-label="Interactive reply"] [role=radio][value="radio"]',
  );
  assert(
    await evaluate("window.__cardTransitions.includes('choice:scale')"),
    "Selecting a choice must animate its check mark, not only change the final style",
  );
  await stopObservingTransitions();
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
  assert(
    await evaluate(`(() => {
    const r = document.querySelector('[role=dialog]').getBoundingClientRect();
    return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2 && r.left >= 16 && r.right <= innerWidth - 16;
  })()`),
    "Expanded card must be centered and fit the viewport",
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
  await button("", 'button[aria-label="Move Explore a small gallery up"]');
  await observeTransitions();
  await button("+", 'button[aria-label="Increase Food"]');
  assert(
    await evaluate(
      "window.__cardTransitions.includes('budget:stroke-dashoffset')",
    ),
    "Changing the budget must animate the linked ring",
  );
  await stopObservingTransitions();
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
    await evaluate(
      `document.querySelector('[aria-label="Weekend budget"]').querySelector('circle[pathLength]').getAttribute('stroke-dashoffset')`,
    ),
    "45",
    "Budget ring must follow the current allocation",
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
  await evaluate(`(async () => {
    const list = document.querySelector('ol[aria-label="Afternoon itinerary"]');
    list.dispatchEvent(new WheelEvent('wheel', {bubbles: true, deltaY: -500}));
    list.scrollIntoView({block: 'center'});
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  })()`);
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
  const dragPoints = await evaluate(`(() => {
    const grip = document.querySelector('button[aria-label="Drag Lunch with a friend to reorder"]').getBoundingClientRect();
    const first = document.querySelector('ol[aria-label="Afternoon itinerary"] li').getBoundingClientRect();
    return {x: grip.x + grip.width / 2, from: grip.y + grip.height / 2, to: first.y + first.height / 2};
  })()`);
  assert(
    dragPoints.from > 0 && dragPoints.from < 844 && dragPoints.to > 0,
    "Ranking drag targets must be visible: " + JSON.stringify(dragPoints),
  );
  await cdp("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: dragPoints.x, y: dragPoints.from, id: 1 }],
  });
  for (let step = 1; step <= 4; step++) {
    await cdp("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: dragPoints.x,
          y: dragPoints.from + ((dragPoints.to - dragPoints.from) * step) / 4,
          id: 1,
        },
      ],
    });
  }
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(
    "document.querySelector('ol[aria-label=\"Afternoon itinerary\"] li')?.dataset.rankingItem === 'lunch'",
  );
  await button("", 'button[aria-label="Move Lunch with a friend down"]');
  await button("", 'button[aria-label="Move Lunch with a friend down"]');
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  await snapshot("interactive-rich-mobile");
  await evaluate("document.documentElement.dataset.theme = 'dark'");
  await snapshot("interactive-rich-mobile-dark");
  assert(
    await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
    "Dark cards overflowed narrow layout",
  );
  await evaluate(`(async () => {
    document.querySelector('[aria-label="Weekend budget"]').scrollIntoView({block:'center'});
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  })()`);
  await snapshot("interactive-budget-mobile-dark");
  await evaluate("document.documentElement.dataset.theme = 'light'");
  await snapshot("interactive-budget-mobile");
  await cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await button("", 'button[aria-label="Move Lunch with a friend up"]');
  assert(
    await evaluate(
      "Array.from(document.querySelectorAll('[data-ranking-item]')).every(row => row.getAnimations().length === 0)",
    ),
    "Reduced motion must disable reorder animations",
  );
  await button("", 'button[aria-label="Move Lunch with a friend down"]');
  await cdp("Emulation.setEmulatedMedia", { features: [] });

  assert(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "Rich controls overflowed narrow layout",
  );
  await evaluate(
    `document.querySelector('textarea[id*=draft]').closest('section[aria-label="Interactive reply"]').setAttribute('data-rich-card', 'true')`,
  );
  await button("Expand", "[data-rich-card] button");
  await until("!!document.querySelector('[role=dialog] textarea')");
  assert(
    await evaluate(`(() => {
    const r = document.querySelector('[role=dialog]').getBoundingClientRect();
    return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2 &&
      r.left >= 16 && r.right <= innerWidth - 16 && r.top >= 16 && r.bottom <= innerHeight - 16;
  })()`),
    "Narrow expanded card must fit within viewport margins",
  );
  await snapshot("interactive-rich-mobile-expanded");
  await button("Close", "[role=dialog] button");
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
      `(() => {
        const r = document.querySelector('[role=dialog]').getBoundingClientRect();
        return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2 &&
          Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 2 &&
          r.left >= 16 && r.top >= 16 && r.right <= innerWidth - 16;
      })()`,
    ),
    "Wide expansion must remain a centered dialog with viewport margins",
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
  await button("Expand", "[data-repaired-card] button");
  await until("!!document.querySelector('[role=dialog] [role=radio]')");
  await evaluate(
    "Promise.all(document.querySelector('[role=dialog]').getAnimations().map(animation => animation.finished))",
  );
  await assertStableTextPress("[role=dialog] [role=radio]");
  await assertStableTextPress("[role=dialog] [data-slot=button]");
  assert(
    await evaluate(
      "!document.querySelector('[role=dialog] [role=radio][aria-checked=true]')",
    ),
    "Cancelled pointer presses must not select a choice",
  );
  const beforeSelection = await evaluate(
    "document.querySelector('[role=dialog]').getBoundingClientRect().toJSON()",
  );
  const wideFooterMotion = await assertStableFooterSave(
    "[role=dialog] [role=radio]",
  );
  const afterSelection = await evaluate(
    "document.querySelector('[role=dialog]').getBoundingClientRect().toJSON()",
  );
  for (const dimension of ["x", "y", "width", "height"]) {
    assert(
      Math.abs(beforeSelection[dimension] - afterSelection[dimension]) < 0.5,
      "Selecting the first option shifted the centered dialog: " + dimension,
    );
  }
  await snapshot("footer-stable-wide");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const narrowFooterMotion = await assertStableFooterSave(
    "[role=dialog] [role=radio]:not([aria-checked=true])",
  );
  const repeatedFooterMotion = await assertStableFooterSave(
    "[role=dialog] [role=radio]:not([aria-checked=true])",
  );
  await snapshot("footer-stable-mobile");
  await evaluate(`(() => {
    window.__panelSamples = [];
    window.__samplePanel = true;
    const sample = () => {
      if (!window.__samplePanel) return;
      const panel = document.querySelector('[role=dialog]');
      window.__panelSamples.push(panel.getBoundingClientRect().toJSON());
      requestAnimationFrame(sample);
    };
    sample();
  })()`);
  await evaluate(`(() => {
    window.__originalCardFetch = window.fetch;
    window.fetch = (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input, location.origin);
      if (url.pathname.endsWith('/interactive-card') && init.method === 'PATCH') {
        const headers = new Headers(init.headers);
        headers.set('X-Cove-Session-Token', 'expired-browser-session-fixture');
        return window.__originalCardFetch(input, {...init, headers});
      }
      return window.__originalCardFetch(input, init);
    };
  })()`);
  await click("[role=dialog] [role=radio]:not([aria-checked=true])");
  await until(
    "document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('A valid browser session is required.')",
  );
  assert(
    await evaluate(`(() => {
    const panel = document.querySelector('[role=dialog]');
    const close = [...panel.querySelectorAll('button')].find(button => button.textContent.trim() === 'Close').getBoundingClientRect();
    const error = panel.querySelector('[role=alert]').getBoundingClientRect();
    return close.bottom <= panel.getBoundingClientRect().bottom && error.top >= panel.getBoundingClientRect().top && error.bottom <= close.top;
  })()`),
    "Save failure and Close must remain visible inside the fixed panel",
  );
  await snapshot("save-failure-fixed-panel");
  await evaluate(
    "window.fetch = window.__originalCardFetch; delete window.__originalCardFetch",
  );
  await button("Retry save", "[role=dialog] button");
  await until(
    "!document.querySelector('[role=dialog] [role=alert]') && document.querySelector('[role=dialog] span[role=status]')?.textContent.trim()==='Saved on this Mac'",
  );
  await click("[role=dialog] [role=radio]:not([aria-checked=true])");
  await until(
    "document.querySelector('[role=dialog] span[role=status]')?.textContent.trim()==='Saved on this Mac'",
  );
  const failureMotion = await evaluate(`(() => {
    window.__samplePanel = false;
    const samples = window.__panelSamples;
    const maxDelta = Math.max(...samples.flatMap(sample => ['x','y','width','height'].map(dimension => Math.abs(sample[dimension] - samples[0][dimension]))));
    delete window.__panelSamples; delete window.__samplePanel;
    return {samples:samples.length,maxDelta};
  })()`);
  assert(
    failureMotion.maxDelta < 0.5,
    "Save failure/retry shifted the expanded panel: " +
      JSON.stringify(failureMotion),
  );
  console.log(
    "Save failure/retry panel geometry: " + JSON.stringify(failureMotion),
  );
  assert(
    await evaluate(
      "document.querySelector('[role=dialog]').scrollWidth <= document.querySelector('[role=dialog]').clientWidth",
    ),
    "Footer overflows narrow dialog",
  );
  console.log(
    "Footer save geometry: " +
      JSON.stringify({
        wide: wideFooterMotion.maxDelta,
        narrow: narrowFooterMotion.maxDelta,
        repeated: repeatedFooterMotion.maxDelta,
      }),
  );
  await button("Close", "[role=dialog] button");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(
    "document.querySelector('[data-repaired-card]').textContent.includes('Saved on this Mac')",
  );
  assert.equal(
    requests.length,
    beforeRepairGesture,
    "Selecting a repaired choice contacted a Provider",
  );
  await button("Expand", "[data-repaired-card] button");
  await until("!!document.querySelector('[role=dialog]')");
  await button("Ask about this", "[role=dialog] button");
  assert(
    await evaluate(
      "document.activeElement?.tagName === 'TEXTAREA' && !!document.activeElement.closest('[role=dialog]')",
    ),
    "Asking about a card must focus its question input",
  );
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until("!document.querySelector('[role=dialog]')");
  await until("document.activeElement?.textContent.trim() === 'Expand'");
  await reloadPage();
  await until(
    "[...document.querySelectorAll('section[aria-label=\"Interactive reply\"]')].at(-1)?.querySelector('[role=radio][aria-checked=true]')?.textContent==='A gallery'",
  );
  console.log(
    "Stable text acceptance passed: hover, held press, release and first selection preserve text/dialog geometry.",
  );
  console.log(
    "Repaired model output acceptance passed: bounded bracket repair, preserved prose, interactive choice and saved reload.",
  );
  console.log(
    "Nested/local-only acceptance passed: compact JSON normalized, local reveal, no model request, centered wide dialog.",
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
