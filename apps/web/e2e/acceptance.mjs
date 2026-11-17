import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  mkdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
process.chdir(repoRoot);
const evidenceDir = path.resolve(
  process.env.COVE_BROWSER_ARTIFACT_DIR ?? ".artifacts/frontend-acceptance",
);
await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
const browserBinary =
  process.env.COVE_BROWSER_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const require = createRequire(import.meta.url);

const temp = await mkdtemp(path.join(os.tmpdir(), "cove-stage4-browser-"));
const control = randomBytes(24).toString("hex");
let service, chrome;
const requests = [];
let sawApiKeyHeader = false;
const attempts = new Map();
let catalogGate;
const provider = http.createServer(async (request, response) => {
  if (request.headers["x-api-key"]) sawApiKeyHeader = true;
  if (
    (request.headers.authorization ?? "").includes("invalid") ||
    (request.headers["x-api-key"] ?? "").includes("invalid")
  ) {
    response.writeHead(401);
    response.end("{}");
    return;
  }
  if (request.method === "GET") {
    if (catalogGate) await catalogGate.promise;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        data: [
          { id: "model-one" },
          { id: "model-two" },
          { id: "model-three" },
          { id: "model-four" },
          ...Array.from({ length: 80 }, (_, index) => ({
            id: "catalog/model-" + String(index + 1).padStart(3, "0"),
          })),
        ],
      }),
    );
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  requests.push(input);
  const prompt = input.messages.at(-1)?.content ?? "";
  const attemptKey = input.model + ":" + prompt;
  const attempt = (attempts.get(attemptKey) ?? 0) + 1;
  attempts.set(attemptKey, attempt);
  if (
    prompt.includes("Retry fixture") &&
    input.model === "model-two" &&
    attempt === 1
  ) {
    response.writeHead(500);
    response.end("{}");
    return;
  }

  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(
    "data: " +
      JSON.stringify({
        choices: [{ delta: { content: "Browser answer from " + input.model } }],
      }) +
      "\n\n",
  );
  if (prompt.includes('"name":"source-notes.md"')) {
    const sources = prompt
      .split("\n")
      .filter((line) => line.startsWith('{"id":"'))
      .map((line) => JSON.parse(line));
    for (const source of sources)
      response.write(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: `\n\n[${source.name}, ${source.sections[0].id}](cove:${source.id}:${source.sections[0].id})`,
                },
              },
            ],
          }) +
          "\n\n",
      );
  }
  if (prompt.includes("Long fixture"))
    response.write(
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                content:
                  "\n\n## A long answer\n\n" +
                  "A readable paragraph with enough detail to scroll.\n\n".repeat(
                    80,
                  ) +
                  '```javascript\nconst longLine = \"' +
                  "x".repeat(180) +
                  '\";\n```',
              },
            },
          ],
        }) +
        "\n\n",
    );
  setTimeout(
    () => response.end("data: [DONE]\n\n"),
    prompt.includes("Slow fixture") ? 3500 : 150,
  );
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
try {
  service = spawn(
    ".artifacts/cove-local-service",
    [
      "--control-token",
      control,
      "--port",
      "19520",
      "--insecure-file-secret-store",
    ],
    {
      env: {
        ...process.env,
        COVE_DATA_DIR: temp,
        COVE_INSECURE_FILE_SECRET_STORE: "1",
      },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const lines = createInterface({ input: service.stdout });
  const ready = JSON.parse(
    (await once(lines, "line", { signal: AbortSignal.timeout(10000) }))[0],
  );
  const origin = ready.url;
  const launch = await fetch(
    origin + "/launch?token=" + encodeURIComponent(ready.launch_token),
    { redirect: "manual" },
  );
  const launchLocation = new URL(launch.headers.get("Location"), origin);
  const browserSession = new URLSearchParams(launchLocation.hash.slice(1)).get("cove-session");
  assert(browserSession, "Launch did not issue a browser session");
  assert.equal(launch.headers.getSetCookie().length, 0);
  const session = await fetch(origin + "/api/session", {
    headers: { "X-Cove-Session-Token": browserSession },
  }).then((r) => r.json());
  const headers = {
    "X-Cove-Session-Token": browserSession,
    Origin: origin,
    "Content-Type": "application/json",
    "X-Cove-CSRF-Token": session.csrf_token,
  };
  async function api(route, method = "GET", body) {
    const response = await fetch(origin + route, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert(
      response.ok,
      "Fixture API returned " + response.status + " for " + route,
    );
    return response.status === 204 ? undefined : response.json();
  }
  const profile = await api("/api/models", "POST", {
    kind: "openai_compatible",
    name: "Browser fixture",
    endpoint: "http://127.0.0.1:" + provider.address().port,
    auth_method: "bearer",
    secret: randomBytes(12).toString("hex"),
  });
  const settings = await api("/api/settings");
  await api("/api/settings", "PATCH", {
    ...settings,
    active_model_set: ["model-one", "model-two"].map((model_id) => ({
      provider_id: profile.id,
      model_id,
    })),
  });
  const conversation = await api("/api/conversations", "POST", {
    title: "A little room for bright ideas",
  });
  catalogGate = Promise.withResolvers();
  chrome = spawn(
    browserBinary,
    [
      "--headless",
      "--no-first-run",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--no-proxy-server",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--remote-debugging-port=0",
      "--user-data-dir=" + path.join(temp, "chrome"),
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let browserError;
  let browserDiagnostics = "";
  let browserStartupPhase = "waiting for DevToolsActivePort";
  chrome.on("error", (error) => {
    browserError = error;
  });
  chrome.stderr.on("data", (chunk) => {
    browserDiagnostics = (browserDiagnostics + chunk.toString()).slice(-16_384);
  });
  const startupFailure = () =>
    [
      "Browser debugging endpoint did not start",
      `Startup phase: ${browserStartupPhase}`,
      browserError?.message,
      `Exit code: ${chrome.exitCode}; signal: ${chrome.signalCode}`,
      browserDiagnostics,
    ]
      .filter(Boolean)
      .join("\n")
      .replaceAll(control, "[redacted]")
      .replace(/([?&]token=)[^\s"<>]+/g, "$1[redacted]");
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let tab;
  const browserDeadline = Date.now() + 60_000;
  while (Date.now() < browserDeadline) {
    assert(
      !browserError && chrome.exitCode === null && chrome.signalCode === null,
      startupFailure(),
    );
    try {
      const debugPort = (
        await readFile(path.join(temp, "chrome", "DevToolsActivePort"), "utf8")
      )
        .split("\n")[0]
        .trim();
      // The file, HTTP endpoint, and initial page can become ready separately.
      if (
        /^\d+$/.test(debugPort) &&
        Number(debugPort) > 0 &&
        Number(debugPort) <= 65535
      ) {
        browserStartupPhase = "waiting for a page target on the debugging endpoint";
        const tabs = await fetch(
          "http://127.0.0.1:" + debugPort + "/json/list",
          {
            signal: AbortSignal.timeout(1000),
          },
        ).then((response) => response.json());
        tab = tabs.find(
          (candidate) =>
            candidate.type === "page" && candidate.webSocketDebuggerUrl,
        );
        if (tab) break;
      }
    } catch {}
    await pause(100);
  }
  assert(tab, startupFailure());
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await once(socket, "open");
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const task = pending.get(data.id);
      pending.delete(data.id);
      data.error
        ? task.reject(new Error(data.error.message))
        : task.resolve(data.result);
    }
    if (data.method === "Runtime.exceptionThrown")
      exceptions.push(data.params.exceptionDetails.text);
  });
  function rawCdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function cdp(method, params = {}) {
    const result = await rawCdp(method, params);
    if (
      method === "Emulation.setDeviceMetricsOverride" ||
      method === "Emulation.setEmulatedMedia"
    ) {
      await rawCdp("Page.captureScreenshot", { format: "png" });
      await pause(100);
    }
    return result;
  }
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  async function evaluate(expression) {
    const result = await cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert(
      !result.exceptionDetails,
      "Browser evaluation failed: " +
        (result.exceptionDetails?.exception?.description ??
          result.exceptionDetails?.text ??
          ""),
    );
    return result.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    await snapshot("failure");
    throw new Error("Browser condition timed out: " + expression);
  }
  async function loadPage(method, params = {}) {
    await cdp("Page.enable");
    let timeout;
    let onLoad;
    // Navigation replaces the execution context; wait for the load event first.
    const loaded = new Promise((resolve, reject) => {
      onLoad = (event) => {
        if (JSON.parse(event.data).method === "Page.loadEventFired") resolve();
      };
      socket.addEventListener("message", onLoad);
      timeout = setTimeout(() => reject(new Error("Browser navigation did not finish")), 15000);
    });
    try {
      await Promise.all([loaded, cdp(method, params)]);
    } finally {
      clearTimeout(timeout);
      socket.removeEventListener("message", onLoad);
    }
  }
  function reloadPage() {
    return loadPage("Page.reload");
  }
  async function click(selector) {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(
      `(async()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!e.contains(hit)){e.scrollIntoView({block:'nearest'});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}})()`,
    );
    const point = await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,ok:!!hit&&(e.contains(hit)||hit.contains(e))};})()`,
    );
    assert(point.ok, "Pointer is blocked for " + selector);
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await pause(150);
  }
  async function send(text) {
    await until('!!document.querySelector("#generation-input")');
    await evaluate(
      `(()=>{const t=document.querySelector('#generation-input');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await until(
      `!document.querySelector('button[aria-label="Send message"]').disabled`,
    );
    await evaluate(
      `document.querySelector('button[aria-label="Send message"]').click()`,
    );
    await until(
      `document.body.textContent.includes('Browser answer from model-one') && document.body.textContent.includes('Browser answer from model-two') && !document.querySelector('button[aria-label="Stop generation"]')`,
    );
  }
  // A cold browser can outlive the 45-second launch token. Mint it only after
  // DevTools is ready, then navigate from the blank startup page.
  const token = await fetch(origin + "/internal/control/launch-token", {
    method: "POST",
    headers: { "X-Cove-Control-Token": control },
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json());
  await loadPage("Page.navigate", {
    url: origin + "/launch?token=" + encodeURIComponent(token.launch_token),
  });
  await until('!!document.querySelector(".conversation-welcome")');
  assert.equal(await evaluate("window.location.hash"), "", "Launch proof must be removed from the address bar");
  assert.equal(await evaluate("document.cookie"), "", "Cove credentials must stay out of cookies");
  await until(
    `document.querySelector('.model-selector')?.dataset.catalogStatus === 'loading' && !!document.querySelector('#generation-input')`,
  );
  const layoutAt = async (width) => {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height: width < 768 ? 844 : 900,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await pause(500);
    return evaluate(`['.workspace__header','.message-list','.conversation-welcome','#generation-input','.generation-composer__send'].map(selector => {
      const { top, height } = document.querySelector(selector).getBoundingClientRect();
      return { top, height };
    })`);
  };
  await fill("#generation-input", "Draft while loading");
  assert(
    await evaluate(
      `document.querySelector('.generation-composer__send').disabled`,
    ),
  );
  const loadingLayout = new Map();
  for (const width of [390, 1440])
    loadingLayout.set(width, await layoutAt(width));
  catalogGate.resolve();
  await until(
    `document.querySelector('.model-selector')?.dataset.catalogStatus === 'ready'`,
  );
  for (const width of [390, 1440]) {
    assert.deepEqual(
      await layoutAt(width),
      loadingLayout.get(width),
      "Catalog loading shifted the workspace at width " + width,
    );
  }
  assert.equal(
    await evaluate(`document.querySelector('#generation-input').value`),
    "Draft while loading",
  );
  await fill("#generation-input", "");

  assert.equal(
    await evaluate(
      `!!document.querySelector('.model-selector__add-menu-items')`,
    ),
    false,
  );
  async function snapshot(name) {
    await pause(350);
    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(
      path.join(evidenceDir, name + ".png"),
      Buffer.from(shot.data, "base64"),
    );
  }
  async function assertLayout(name) {
    const metrics = await evaluate(
      `({width:innerWidth, scroll:document.documentElement.scrollWidth, main:document.querySelector('.workspace__main').getBoundingClientRect().width, composer:document.querySelector('.generation-composer').getBoundingClientRect().toJSON(), font:document.fonts.check('14px "Geist Variable"')})`,
    );
    assert(
      metrics.scroll <= metrics.width + 1,
      name + " overflows horizontally",
    );
    assert(
      metrics.main >= metrics.width - (metrics.width >= 980 ? 300 : 1),
      name + " loses space to a missing sidebar",
    );
    assert(
      metrics.composer.bottom <= (await evaluate("innerHeight")) + 1,
      name + " composer leaves viewport",
    );
    assert(metrics.font, name + " local font failed to load");
    assert.equal(
      await evaluate(
        `!document.querySelector('.generation-composer__send:disabled') || getComputedStyle(document.querySelector('.generation-composer__send:disabled')).cursor==='not-allowed'`,
      ),
      true,
    );
  }
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [981, 800],
    [980, 800],
    [979, 800],
    [768, 1024],
    [390, 844],
    [320, 740],
  ]) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await pause(250);
    await assertLayout("Empty " + width);
    const controlRects = await evaluate(
      `['.model-selector__provider-select', '.model-selector__fields .front-select__input', '.model-selector__comparison-toggle'].map(s => document.querySelector(s).getBoundingClientRect().toJSON())`,
    );
    for (const rect of controlRects.slice(1)) {
      assert(
        Math.abs(rect.top - controlRects[0].top) <= 1 &&
          Math.abs(rect.height - controlRects[0].height) <= 1,
        "Model controls are misaligned at width " + width,
      );
    }
    await snapshot("empty-light-" + width);
  }
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click('button[aria-label="Collapse sidebar"]');
  await until(`!!document.querySelector('.conversation-sidebar--collapsed')`);
  assert(
    await evaluate(
      `document.querySelector('.conversation-list__new').getBoundingClientRect().width > 0`,
    ),
  );
  await snapshot("collapsed-sidebar");
  await click('button[aria-label="Settings"]');
  await click('button[aria-label="Close settings"]');
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "k",
    code: "KeyK",
    modifiers: 4,
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "k",
    code: "KeyK",
  });
  await until(
    `!document.querySelector('.conversation-sidebar--collapsed') && document.activeElement === document.querySelector('.conversation-list__search input')`,
  );
  await evaluate(
    `document.querySelector('button[aria-label="Toggle day / night edition"]').click()`,
  );
  await until(`document.documentElement.dataset.theme==='dark'`);
  await snapshot("empty-dark-1440");
  async function chooseSkin(id) {
    await click('button[aria-label="Settings"]');
    await click(`label:has(input[name="workspace-skin"][value="${id}"])`);
    await until(
      `document.documentElement.dataset.skin === ${JSON.stringify(id)}`,
    );
    await click('button[aria-label="Close settings"]');
    await until(`!document.querySelector('[role="dialog"]')`);
  }
  for (const id of ["blueprint", "studio", "grove", "continuum"]) {
    await chooseSkin(id);
    await assertLayout(id + " dark");
    await snapshot("skin-" + id + "-dark");
  }
  await evaluate(
    `document.querySelector('button[aria-label="Toggle day / night edition"]').click()`,
  );
  await until(`document.documentElement.dataset.theme==='light'`);
  for (const id of ["continuum", "blueprint", "studio"]) {
    await chooseSkin(id);
    await assertLayout(id + " light");
    await snapshot("skin-" + id + "-light");
  }
  await reloadPage();
  await until(
    `!!document.querySelector('.conversation-welcome') && document.documentElement.dataset.skin === "studio"`,
  );
  await chooseSkin("continuum");
  await evaluate(
    `document.querySelector('button[aria-label="Settings"]').click()`,
  );
  await until(`!!document.querySelector('[role="dialog"]')`);
  await until(
    `document.querySelector('#settings-general').getBoundingClientRect().height>100`,
  );
  await click("#settings-tab-provider");
  await click("#provider-settings [data-slot=select-trigger]");
  await until(`!!document.querySelector('[data-slot=select-content]')`);
  await click("[data-slot=select-item]");
  await until(`!document.querySelector('[data-slot=select-content]')`);
  await click(".prov__foot button:first-child");
  await until(
    `document.querySelector('#provider-settings').textContent.includes('Connection verified')`,
  );
  await click("#provider-settings .front-select__input");
  await until(`!!document.querySelector('.front-select__options')`);
  assert(
    await evaluate(
      `document.activeElement===document.querySelector('#provider-settings .front-select__input')`,
    ),
    "Search field lost modal focus",
  );
  async function assertModelListScroll(name) {
    const before = await evaluate(`(()=>{
      const list = document.querySelector('.front-select__options');
      list.scrollTop = 0;
      const rect = list.getBoundingClientRect();
      return {rect: rect.toJSON(), maxHeight: Math.min(320, innerHeight * .45),
        scrollHeight: list.scrollHeight, height: list.clientHeight,
        parentScroll: document.querySelector('.settings-dialog__sections').scrollTop};
    })()`);
    assert(
      before.scrollHeight > before.height,
      "Catalog fixture must overflow",
    );
    const x = before.rect.left + before.rect.width / 2;
    if (name === "mobile") {
      await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
      const y = before.rect.bottom - 40;
      await cdp("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let distance = 30; distance <= 180; distance += 30) {
        await cdp("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - distance }],
        });
        await pause(35);
      }
      await cdp("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await cdp("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y: before.rect.top + Math.min(80, before.rect.height / 2),
        deltaX: 0,
        deltaY: 360,
      });
    }
    await pause(250);
    const after = await evaluate(`({
      scroll: document.querySelector('.front-select__options').scrollTop,
      parentScroll: document.querySelector('.settings-dialog__sections').scrollTop,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      insideDialog: document.querySelector('[role="dialog"]').contains(document.querySelector('.front-select__options'))
    })`);
    if (name === "mobile") {
      await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
    }
    await snapshot("model-list-" + name);
    assert(
      after.scroll > 0,
      "Model list blocked scrolling: " + JSON.stringify({ before, after }),
    );
    assert(
      before.rect.height <= before.maxHeight + 1,
      "Model list exceeded its height limit: " + JSON.stringify(before),
    );
    assert(
      before.rect.left >= 0 &&
        before.rect.right <= after.viewportWidth + 1 &&
        before.rect.top >= 0 &&
        before.rect.bottom <= after.viewportHeight + 1,
      "Model list escaped the viewport: " + JSON.stringify(before),
    );
    assert.equal(
      after.parentScroll,
      before.parentScroll,
      "Scrolling the model list moved its settings panel",
    );
  }
  await assertModelListScroll("desktop");
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await until(`!document.querySelector('.front-select__options')`);
  assert(
    await evaluate(`!!document.querySelector('.settings-dialog__panel')`),
    "Closing the model list dismissed settings",
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await click("#provider-settings .front-select__toggle");
  await until(`!!document.querySelector('.front-select__options')`);
  await assertModelListScroll("mobile");
  await evaluate(
    `(()=>{const input=document.querySelector('#provider-settings .front-select__input');input.focus();input.select();})()`,
  );
  await cdp("Input.insertText", { text: "model-t" });
  await until(
    `document.querySelector('#provider-settings .front-select__input').value==='model-t' && document.querySelector('.front-select__options')?.textContent.includes('model-two')`,
  );
  await chooseOption("model-two");
  await until(
    `document.querySelector('#provider-settings .front-select__input').value==='model-two'`,
  );
  assert(
    await evaluate(`!!document.querySelector('.settings-dialog__panel')`),
    "Model selection dismissed its settings dialog",
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click("#settings-tab-general");
  await clickText("Follow system");
  await cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await until(`document.documentElement.dataset.theme==='dark'`);
  await cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await until(`document.documentElement.dataset.theme==='light'`);
  assert.equal((await api("/api/settings")).theme, "system");
  await snapshot("settings-general-light");
  await evaluate(`document.querySelector('#settings-tab-provider').click()`);
  await until(
    `document.querySelector('#settings-provider').getBoundingClientRect().height>100`,
  );
  await snapshot("settings-provider-light");
  await evaluate(`document.querySelector('#settings-tab-chat-data').click()`);
  await until(
    `document.querySelector('#settings-chat-data').getBoundingClientRect().height>100`,
  );
  await snapshot("settings-data-light");
  await evaluate(
    `document.querySelector('button[aria-label="Close settings"]').click()`,
  );
  await until(`!document.querySelector('[role="dialog"]')`);
  const chatArea = () =>
    evaluate(
      `document.querySelector('.message-list').getBoundingClientRect().toJSON()`,
    );
  const closedChatArea = await chatArea();
  await evaluate(
    `document.querySelector('.model-selector__comparison-toggle').click()`,
  );
  assert.deepEqual(
    await chatArea(),
    closedChatArea,
    "Opening the model set moved the chat",
  );
  await snapshot("model-comparison-controls");
  await click(".model-selector__chip .front-select__input");
  await chooseOption("model-one");
  assert.equal(
    await evaluate(
      `document.querySelector('.model-selector__comparison-toggle').getAttribute('aria-expanded')`,
    ),
    "true",
    "Choosing a target dismissed the model set",
  );
  await evaluate(
    `document.querySelector('.model-selector__add-button').click()`,
  );
  await until(`!!document.querySelector('.model-selector__add-menu-items')`);
  await snapshot("model-add-menu");
  const menuRect = await evaluate(
    `document.querySelector('.model-selector__add-menu-items').getBoundingClientRect().toJSON()`,
  );
  assert(
    menuRect.left >= 0 &&
      menuRect.right <= 1440 &&
      menuRect.top >= 0 &&
      menuRect.bottom <= 900,
    "Model menu escapes viewport",
  );
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await until(`!document.querySelector('.model-selector__add-menu-items')`);
  await evaluate(
    `document.querySelector('.model-selector__comparison-toggle').click()`,
  );
  await send("First browser prompt");
  for (const id of ["studio", "blueprint", "continuum"]) {
    await chooseSkin(id);
    await until(
      `document.body.textContent.includes('Browser answer from model-two')`,
    );
    await snapshot("conversation-" + id + "-light");
  }

  let view = await api("/api/conversations/" + conversation.id);
  assert.equal(view.generation_batches.length, 1);
  assert.equal(view.generation_batches[0].state, "completed");
  assert.equal(view.messages.filter((m) => m.role === "assistant").length, 2);
  const normalReadingLayout = await evaluate(`({
    height:document.querySelector('.message-list').clientHeight,
    width:document.querySelector('.model-comparison-grid').getBoundingClientRect().width,
    sidebar:document.querySelector('.conversation-sidebar').className
  })`);
  const focusEntryPlacement = await evaluate(`({
    entry:document.querySelector('.workspace__focus-enter').getBoundingClientRect().toJSON(),
    comparison:document.querySelector('.model-selector__comparison-toggle').getBoundingClientRect().toJSON()
  })`);
  assert(focusEntryPlacement.entry.left >= focusEntryPlacement.comparison.right, "Focus must follow Model comparison");
  await fill("#generation-input", "Keep this Focus draft");
  await click('button[aria-label="Enter Focus mode"]');
  await until(`document.querySelector('main').dataset.focusMode==='true'`);
  await pause(250);
  const focusReadingLayout = await evaluate(`({
    height:document.querySelector('.message-list').clientHeight,
    width:document.querySelector('.model-comparison-grid').getBoundingClientRect().width,
    header:document.querySelector('.workspace__header').getBoundingClientRect().height,
    composer:document.querySelector('.generation-composer').getBoundingClientRect().height,
    sidebar:getComputedStyle(document.querySelector('.conversation-sidebar')).display
  })`);
  await writeFile(path.join(evidenceDir, "focus-layout.json"), JSON.stringify({ normal: normalReadingLayout, focus: focusReadingLayout }, null, 2));
  assert(focusReadingLayout.height > normalReadingLayout.height + 100, "Focus must give more height to responses");
  assert(focusReadingLayout.width > normalReadingLayout.width, "Focus must widen comparisons");
  assert(focusReadingLayout.header <= 60 && focusReadingLayout.composer <= 90, "Focus chrome must remain compact");
  assert.equal(focusReadingLayout.sidebar, "none");
  await until(`getComputedStyle(document.querySelector('.model-answer-card__body .message__markdown')).fontSize==='15px'`);
  await snapshot("focus-comparison-light-1440");
  for (const [width, height] of [[980, 800], [768, 1024], [390, 844], [320, 740]]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await pause(250);
    await assertLayout("Focus " + width);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.model-comparison-grid__cards')).gridTemplateColumns.trim().split(/\\s+/).length`), width >= 768 ? 2 : 1, "Focus comparisons must use available width");
    assert(await evaluate(`document.querySelector('.workspace__focus-exit').getBoundingClientRect().right<=innerWidth`), "Focus exit must stay on screen");
    assert(await evaluate(`document.querySelector('.generation-composer').getBoundingClientRect().height<=90`), "Focus input must stay compact on narrow screens");
    if (width === 390) await snapshot("focus-comparison-light-390");
  }
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await fill("#generation-input", "Focus line one\nFocus line two\nFocus line three");
  await until(`document.querySelector('#generation-input').getBoundingClientRect().height>=72`);
  assert(await evaluate(`document.querySelector('#generation-input').getBoundingClientRect().height<=144`), "Focus multiline drafts must grow within their reading-space limit");
  await fill("#generation-input", "Keep this Focus draft");
  await until(`document.querySelector('#generation-input').getBoundingClientRect().height<=40`);
  await click('button[aria-label="Toggle day / night edition"]');
  await snapshot("focus-comparison-dark-1440");
  await click('button[aria-label="Toggle day / night edition"]');
  await click('.workspace__header button[aria-label="Privacy Status"]');
  await until(`!!document.querySelector('[role="dialog"]')`);
  async function escapeKey() {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  }
  await escapeKey();
  await until(`!document.querySelector('[role="dialog"]')`);
  assert.equal(await evaluate(`document.querySelector('main').dataset.focusMode`), "true", "Escape must dismiss a dialog before Focus");
  // Radix restores the dialog trigger after unmount. Wait before another keypress.
  await until(`document.activeElement?.matches('.workspace__header button[aria-label="Privacy Status"]')`);
  await escapeKey();
  await until(`!document.querySelector('main').dataset.focusMode`);
  assert.equal(await evaluate(`document.querySelector('.conversation-sidebar').className`), normalReadingLayout.sidebar);
  assert.equal(await evaluate(`document.querySelector('#generation-input').value`), "Keep this Focus draft");
  // Keyboard focus is restored by an effect after the layout changes.
  await until(`document.activeElement?.classList.contains('workspace__focus-enter')`);
  await click('button[aria-label="Enter Focus mode"]');
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 4 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", modifiers: 4 });
  await until(`!document.querySelector('main').dataset.focusMode && document.activeElement===document.querySelector('.conversation-list__search input')`);
  assert.equal(await evaluate(`document.querySelector('#generation-input').value`), "Keep this Focus draft");
  await fill("#generation-input", "");
  await evaluate(
    `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Use for next turn');if(!b)throw new Error('Choice missing');b.click();})()`,
  );
  await until(
    `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Selected · Answer of record')`,
  );
  await reloadPage();
  await pause(500);
  await until(
    `document.readyState==='complete' && !!document.querySelector('button[aria-label="Toggle day / night edition"]')`,
  );
  await until(
    `document.body.textContent.includes('Browser answer from model-one') && !![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Selected · Answer of record')`,
  );
  await evaluate(
    `document.querySelector('button[aria-label="Toggle day / night edition"]').click()`,
  );
  await until(`document.documentElement.dataset.theme==='dark'`);
  assert.equal((await api("/api/settings")).theme, "dark");
  await evaluate(
    `document.querySelector('button[aria-label="Settings"]').click()`,
  );
  await until(`!!document.querySelector('[role="dialog"]')`);
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await until(`!document.querySelector('[role="dialog"]')`);
  await send("Second browser prompt");
  view = await api("/api/conversations/" + conversation.id);
  assert.equal(view.generation_batches.length, 2);
  assert.equal(view.messages.filter((m) => m.role === "assistant").length, 4);
  assert.equal(exceptions.length, 0);
  await until(
    `(()=>{const n=document.querySelector('.message-list');return n.scrollHeight-n.scrollTop-n.clientHeight<2})()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll(".message__verification-lanes").length`,
    ),
    0,
    "Ordinary Provider displays private verification lanes",
  );
  await snapshot("comparison-dark-1440");
  await evaluate(
    `document.querySelector('button[aria-label="Settings"]').click()`,
  );
  await until(`!!document.querySelector('[role="dialog"]')`);
  await snapshot("settings-general-dark");
  await evaluate(
    `document.querySelector('button[aria-label="Close settings"]').click()`,
  );
  await until(`!document.querySelector('[role="dialog"]')`);
  const desktop = await cdp("Page.captureScreenshot", { format: "png" });
  await writeFile(
    path.join(evidenceDir, "desktop.png"),
    Buffer.from(desktop.data, "base64"),
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await until(
    `!!document.querySelector('button[aria-label="Expand sidebar"]')`,
  );
  await assertLayout("Comparison 390");
  await until(
    `(()=>{const n=document.querySelector('.message-list');return n.scrollHeight-n.scrollTop-n.clientHeight<2})()`,
  );
  await snapshot("comparison-dark-390");
  await evaluate(
    `document.querySelector('button[aria-label="Expand sidebar"]').click()`,
  );
  await until(`!!document.querySelector('.mobile-sidebar-dialog__panel')`);
  await snapshot("sidebar-dark-390");
  await evaluate(
    `document.querySelector('.mobile-sidebar-dialog__panel button[aria-label="Settings"]').click()`,
  );
  await until(`!!document.querySelector('.settings-dialog__panel')`);
  await snapshot("settings-general-dark-390");
  await evaluate(`document.querySelector('#settings-tab-provider').click()`);
  await snapshot("settings-provider-dark-390");
  await evaluate(`document.querySelector('#settings-tab-chat-data').click()`);
  await snapshot("settings-data-dark-390");
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await until(`!document.querySelector('[role="dialog"]')`);
  await evaluate(
    `document.querySelector('button[aria-label="Privacy Status"]').click()`,
  );
  await until(`!!document.querySelector('.privacy-status-panel')`);
  await snapshot("privacy-dark-390");
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await until(`!document.querySelector('[role="dialog"]')`);
  await cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await evaluate(
    `document.querySelector('button[aria-label="Expand sidebar"]').click()`,
  );
  await until(`!!document.querySelector('.mobile-sidebar-dialog__panel')`);
  await evaluate(
    `document.querySelector('button[aria-label="New conversation"]').click()`,
  );
  await until('!!document.querySelector(".conversation-welcome")');
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.conversation-welcome')).animationDuration`,
    ),
    "1e-05s",
  );
  assert.equal(exceptions.length, 0);
  const narrow = await cdp("Page.captureScreenshot", { format: "png" });
  await writeFile(
    path.join(evidenceDir, "mobile.png"),
    Buffer.from(narrow.data, "base64"),
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pause(250);
  async function fill(selector, value) {
    await click(selector);
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).select()`,
    );
    await cdp("Input.insertText", { text: value });
  }
  async function clickText(text, scope = "body") {
    const found = await evaluate(
      `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope + " button, " + scope + " [role=menuitem]")})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0);if(!e)return false;e.setAttribute('data-fixture-click','true');return true})()`,
    );
    assert(found, "Visible action missing: " + text);
    await click("[data-fixture-click]");
    await evaluate(
      `document.querySelector('[data-fixture-click]')?.removeAttribute('data-fixture-click')`,
    );
  }
  async function escape() {
    await cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
    });
    await cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
    });
    await pause(100);
  }
  async function rowAction(text) {
    await click(".conversation--selected + .conversation-actions button");
    await clickText(text);
  }
  // Rename, search, pin, archive, restore and export through their real UI actions.
  await rowAction("Rename conversation");
  await fill("#conversation-title", "Review conversation");
  await clickText("Save title");
  await until(
    `document.querySelector('.masthead__title').textContent==='Review conversation'`,
  );
  await rowAction("Pin");
  await until(
    `document.querySelector('.conversation-list').textContent.includes('Pinned')`,
  );
  await rowAction("Unpin");
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "k",
    code: "KeyK",
    modifiers: 4,
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "k",
    code: "KeyK",
  });
  assert(
    await evaluate(
      `document.activeElement===document.querySelector('.conversation-list__search input')`,
    ),
    "Search shortcut did not focus",
  );
  await fill(".conversation-list__search input", "Review conversation");
  await until(`document.querySelectorAll('.conversation-row').length===1`);
  assert.equal(
    await evaluate(`document.querySelectorAll('.conversation-row').length`),
    1,
  );
  await fill(".conversation-list__search input", "");
  // Body search uses persisted local text, and navigation protects unsent work.
  const searchPhrase = "SQLite migration checklist \u4f60\u597d";
  const searchFixture = await api("/api/conversations", "POST", { title: "Local search fixture" });
  await api("/api/conversations/" + searchFixture.id + "/messages", "POST", {
    body: searchPhrase, client_request_id: randomBytes(16).toString("hex"),
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const view = await api("/api/conversations/" + searchFixture.id);
    if (view.generation_batches[0]?.targets.every((target) => target.generation.state === "completed")) break;
    await pause(100);
    if (attempt === 99) throw new Error("Search fixture did not finish");
  }
  const beforeSearchRequests = requests.length;
  await fill("#generation-input", "Preserve this unsent draft");
  await click('button[aria-label="New conversation"]');
  await until(`document.querySelector('.confirmation-dialog__panel')?.textContent.includes('Discard unsent draft?')`);
  await clickText("Stay", ".confirmation-dialog__panel");
  assert.equal(await evaluate(`document.querySelector('#generation-input').value`), "Preserve this unsent draft");
  await fill(".conversation-list__search input", searchPhrase);
  await until(`document.querySelector('.conversation-list')?.textContent.includes(${JSON.stringify(searchPhrase)})`);
  await click(".conversation-row .conversation");
  await until(`!!document.querySelector('.confirmation-dialog__panel')`);
  await clickText("Stay", ".confirmation-dialog__panel");
  assert.equal(await evaluate(`document.querySelector('.masthead__title').textContent`), "Review conversation");
  assert.equal(await evaluate(`document.querySelector('#generation-input').value`), "Preserve this unsent draft");
  await click(".conversation-row .conversation");
  await until(`!!document.querySelector('.confirmation-dialog__panel')`);
  await clickText("Discard and continue", ".confirmation-dialog__panel");
  await until(`document.querySelector('.masthead__title').textContent==='Local search fixture' && !!document.querySelector('[data-timeline-anchor]')`);
  assert.equal(await evaluate(`document.querySelector('#generation-input').value`), "");
  assert.equal(requests.length, beforeSearchRequests, "Search or draft navigation contacted a Provider");
  await snapshot("body-search-and-draft-protection");
  await api("/api/conversations/" + searchFixture.id, "DELETE");
  await reloadPage();
  await until(`document.querySelector('.masthead__title')?.textContent==='Review conversation' && !!document.querySelector('#generation-input')`);
  await rowAction("Archive");
  await clickText("Archived chats");
  await until(
    `document.querySelector('.conversation--selected')?.textContent.includes('Review conversation')`,
  );
  assert(
    await evaluate(
      `document.querySelector('.conversation-panel__archived')!==null`,
    ),
    "Archived conversation has no notice",
  );
  assert(
    await evaluate(`!document.querySelector('#generation-input')`),
    "Archived conversation still accepts input",
  );
  await rowAction("Unarchive");
  await clickText("All chats");
  await until(`!!document.querySelector('#generation-input')`);
  await rowAction("Download");
  const downloads = path.join(temp, "downloads");
  await mkdir(downloads);
  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  await clickText("Download as JSON");
  let downloadFiles = [];
  for (let i = 0; i < 50; i++) {
    downloadFiles = await readdir(downloads);
    if (downloadFiles.some((n) => n.endsWith(".json"))) break;
    await pause(100);
  }
  assert(
    downloadFiles.some((n) => n.endsWith(".json")),
    "Conversation export did not download",
  );
  // Expand from two to four models using the search menu, then stream independent answers.
  await click(".model-selector__comparison-toggle");
  for (const model of ["model-three", "model-four"]) {
    await click(".model-selector__add-button");
    await until(`!!document.querySelector('.model-selector__add-menu-items')`);
    await evaluate(
      `(()=>{const e=[...document.querySelectorAll('.model-selector__add-option')].find(e=>e.textContent.includes(${JSON.stringify(model)}));if(!e)throw Error('Missing add option');e.setAttribute('data-fixture-model','yes')})()`,
    );
    await click("[data-fixture-model]");
    await until(`!document.querySelector('.model-selector__add-menu-items')`);
  }
  assert.equal(
    await evaluate(`document.querySelectorAll('.model-selector__chip').length`),
    4,
  );
  await snapshot("four-model-controls");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(250);
  await assertLayout("Four-model mobile controls");
  const modelPanel = await evaluate(
    `document.querySelector('.model-selector__comparison').getBoundingClientRect().toJSON()`,
  );
  assert(
    modelPanel.width > 0 &&
      modelPanel.left >= 0 &&
      modelPanel.right <= 390 &&
      modelPanel.bottom <= 844,
    "The model set escapes the mobile viewport",
  );
  await snapshot("four-model-controls-390");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pause(250);
  await click(".model-selector__comparison-toggle");
  // Exercise local parsing and the authenticated preview through the production UI.
  const notesPath = path.join(temp, "source-notes.md");
  await writeFile(notesPath, "First source line\nSecond source line", {
    mode: 0o600,
  });
  const documentRoot = await cdp("DOM.getDocument");
  const fileInput = await cdp("DOM.querySelector", {
    nodeId: documentRoot.root.nodeId,
    selector: 'input[type="file"][aria-label="Attach files"]',
  });
  await cdp("DOM.setFileInputFiles", {
    nodeId: fileInput.nodeId,
    files: [notesPath, path.join(repoRoot, "apps/web/e2e/fixtures/source.pdf")],
  });
  await until(
    `document.querySelectorAll('button[aria-label^="Remove attachment:"]').length === 2 && [...document.querySelectorAll('button')].filter(b => b.textContent.includes('Preview extracted text')).length === 2`,
  );
  await evaluate(
    `document.querySelectorAll('button').forEach(b=>{if(b.textContent.includes('Preview extracted text') && b.closest('div').textContent.includes('source.pdf')) b.setAttribute('data-pdf-preview','true')})`,
  );
  await click("[data-pdf-preview]");
  await until(
    `document.querySelector('[role=dialog]')?.textContent.includes('Synthetic PDF source')`,
  );
  await snapshot("source-pdf-preview");
  const sourceDialogAudits = [];
  const sourceAxe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  async function auditSourceDialog(surface) {
    if (await evaluate("typeof globalThis.axe === 'undefined'")) await evaluate(sourceAxe);
    const previousTheme = await evaluate("document.documentElement.dataset.theme");
    for (const theme of ["light", "dark"]) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      const violations = await evaluate("axe.run(document.querySelector('[role=dialog]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
      sourceDialogAudits.push({surface,theme,violations});
      assert.equal(violations.length, 0, `${surface} ${theme}: ${JSON.stringify(violations)}`);
      await snapshot(surface + "-" + theme);
    }
    await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(previousTheme)}`);
  }
  await auditSourceDialog("source-preview");
  await clickText("Close", "[role=dialog]");
  const beforeContextPreview = requests.length;
  await clickText("Review context");
  await until(
    `document.querySelector('[role=dialog]')?.textContent.includes('Second source line') && document.querySelector('[role=dialog]')?.textContent.includes('Synthetic PDF source')`,
  );
  await auditSourceDialog("source-draft-context");
  assert.equal(
    requests.length,
    beforeContextPreview,
    "Context preview contacted a Provider",
  );
  await clickText("Close", "[role=dialog]");
  await fill("#generation-input", "Four model fixture");
  await click('button[aria-label="Send message"]');
  await until(
    `document.querySelectorAll('.model-answer-card').length===4 && !document.querySelector('button[aria-label="Stop generation"]')`,
  );
  const current = (await api("/api/conversations")).find(
    (c) => c.title === "Review conversation",
  );
  let latest = await api("/api/conversations/" + current.id);
  assert.equal(latest.generation_batches[0].targets.length, 4);
  const fileBatch = latest.generation_batches[0];
  assert.equal(fileBatch.attachments.length, 2);
  const fileRequests = requests.filter(
    (r) => r.messages.at(-1)?.content === fileBatch.input_content,
  );
  assert.equal(
    fileRequests.length,
    4,
    "All comparison models must receive the same source input",
  );
  assert(fileBatch.input_content.includes("Synthetic PDF source"));
  const originalDownload = await fetch(
    origin +
      "/api/generation-batches/" +
      fileBatch.id +
      "/attachments/" +
      fileBatch.attachments[0].id,
    { headers },
  );
  assert.equal(
    await originalDownload.text(),
    "First source line\nSecond source line",
  );
  assert(
    originalDownload.headers
      .get("content-disposition")
      .startsWith("attachment;"),
  );
  // Page.reload acknowledges before navigation; wait for a new document instead
  // of letting the old page's already-rendered answers satisfy the condition.
  await evaluate("globalThis.__coveSourceReloadPending = true");
  await reloadPage();
  await until(
    `globalThis.__coveSourceReloadPending !== true && document.querySelector('.model-selector')?.dataset.catalogStatus === 'ready' && document.querySelectorAll('.model-answer-card').length === 4 && !![...document.querySelectorAll('button')].find(b=>b.textContent==='source.pdf, P1' && b.getBoundingClientRect().width > 0)`,
  );
  await clickText("source.pdf, P1");
  await until(
    `document.querySelector('[role=dialog]')?.textContent.includes('Synthetic PDF source')`,
  );
  await clickText("Download original file", "[role=dialog]");
  let downloadedSource;
  for (let attempt = 0; attempt < 50 && !downloadedSource; attempt++) {
    downloadedSource = await readFile(path.join(downloads, "source.pdf")).catch(() => undefined);
    if (!downloadedSource) await pause(100);
  }
  assert(downloadedSource?.subarray(0, 5).toString() === "%PDF-", "The source dialog did not download the original PDF");
  await snapshot("source-citation-reloaded");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await snapshot("source-citation-390");
  assert(
    await evaluate(`document.documentElement.scrollWidth <= innerWidth`),
    "Source preview overflows the narrow viewport",
  );
  await clickText("Close", "[role=dialog]");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await clickText("View context");
  await until(
    `document.querySelector('[role=dialog]')?.textContent.includes('Synthetic PDF source')`,
  );
  await snapshot("source-context-snapshot");
  await auditSourceDialog("source-saved-context");
  await writeFile(path.join(evidenceDir, "source-accessibility.json"), JSON.stringify(sourceDialogAudits, null, 2));
  await clickText("Close", "[role=dialog]");
  const selected = latest.generation_batches[0].targets[1].generation.id;
  await evaluate(
    `document.querySelectorAll('.model-answer-card .pick')[1].click()`,
  );
  await until(
    `document.querySelectorAll('.pick[aria-pressed=true]').length===1`,
  );
  await fill("#generation-input", "Selected context fixture");
  await click('button[aria-label="Send message"]');
  await until(
    `document.querySelectorAll('.model-answer-card').length===8 && !document.querySelector('button[aria-label="Stop generation"]')`,
  );
  latest = await api("/api/conversations/" + current.id);
  const follow = latest.generation_batches.at(-1);
  const context = await api(
    "/api/generation-batches/" + follow.id + "/context",
  );
  assert.equal(context.length, 2);
  assert(context[1].content.includes("model-two"));
  assert.equal(
    requests
      .filter((r) => r.messages.at(-1)?.content === "Selected context fixture")
      .every(
        (r) => r.messages.filter((m) => m.role === "assistant").length === 1,
      ),
    true,
  );
  await clickText("Continue without an answer");
  await fill("#generation-input", "Retry fixture");
  await click('button[aria-label="Send message"]');
  await until(
    `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry generation' && !b.disabled)`,
  );
  await clickText("Retry generation");
  await until(
    `![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Retry generation') && !document.querySelector('button[aria-label="Stop generation"]')`,
  );
  await clickText("Continue without an answer");
  await fill("#generation-input", "Slow fixture");
  await click('button[aria-label="Enter Focus mode"]');
  await until(`document.querySelector('main').dataset.focusMode==='true'`);
  const composerPosition = () =>
    evaluate(
      `['#generation-input', '.generation-composer__send'].map(selector => document.querySelector(selector).getBoundingClientRect().toJSON())`,
    );
  const idleComposer = await composerPosition();
  await click('button[aria-label="Send message"]');
  await until(`document.querySelectorAll('.generation-stop').length>0`);
  assert.deepEqual(
    await composerPosition(),
    idleComposer,
    "The composer moved when Send became Stop",
  );
  await click(".generation-stop");
  await until(`document.querySelector('.model-answer-card--stopped')!==null`);
  await click('.generation-composer__send[aria-label="Stop generation"]');
  await until(
    `!document.querySelector('button[aria-label="Stop generation"]')`,
  );
  assert.deepEqual(
    await composerPosition(),
    idleComposer,
    "The composer moved when Stop became Send",
  );
  await snapshot("focus-four-model-stopped");
  await click(".workspace__focus-exit");
  await snapshot("four-model-stopped");
  await clickText("Continue without an answer");
  await fill("#generation-input", "Long fixture");
  await click('button[aria-label="Send message"]');
  await until(
    `document.querySelectorAll('.message__markdown pre').length>0 && !document.querySelector('button[aria-label="Stop generation"]')`,
  );
  await evaluate(
    `const list=document.querySelector('.message-list');list.scrollTop=0;list.dispatchEvent(new Event('scroll',{bubbles:true}));`,
  );
  await until(`!!document.querySelector('.conversation-panel__latest')`);
  await click(".conversation-panel__latest");
  await pause(200);
  assert(
    await evaluate(
      `(()=>{const n=document.querySelector('.message-list');return n.scrollHeight-n.clientHeight-n.scrollTop<120})()`,
    ),
    "Jump to latest failed",
  );
  await evaluate(`const node=document.querySelector('.message-list');node.scrollTop=0;node.dispatchEvent(new Event('scroll',{bubbles:true}));`);
  await click('button[aria-label="Enter Focus mode"]');
  await until(`document.querySelector('main').dataset.focusMode==='true'`);
  await pause(250);
  assert(await evaluate(`(()=>{const n=document.querySelector('.message-list');return n.scrollHeight-n.clientHeight-n.scrollTop>200})()`), "Focus must preserve the reader's position instead of jumping to the end");
  assert(await evaluate(`document.querySelector('.conversation-panel__latest').getBoundingClientRect().bottom<document.querySelector('[data-workspace-region="composer"]').getBoundingClientRect().top`), "Jump to latest must not overlap the composer or context choice");
  await evaluate(`(()=>{const list=document.querySelector('.message-list');const card=[...document.querySelectorAll('.model-answer-card')].find(e=>e.querySelector('pre'));list.scrollTop+=card.getBoundingClientRect().top-list.getBoundingClientRect().top+180;list.dispatchEvent(new Event('scroll',{bubbles:true}));})()`);
  await pause(200);
  const pinnedModelHeader = await evaluate(`(()=>{const list=document.querySelector('.message-list').getBoundingClientRect();const card=[...document.querySelectorAll('.model-answer-card')].find(e=>e.querySelector('pre'));const header=card.querySelector('.model-answer-card__header').getBoundingClientRect();return {top:header.top,listTop:list.top};})()`);
  assert(pinnedModelHeader.top >= pinnedModelHeader.listTop - 1 && pinnedModelHeader.top <= pinnedModelHeader.listTop + 20, "Focus must keep model identity visible while reading a long comparison: " + JSON.stringify(pinnedModelHeader));
  await snapshot("focus-long-markdown");
  const timelineMarkerCount = await evaluate(`document.querySelectorAll('[data-timeline-marker]').length`);
  assert(timelineMarkerCount >= 2, "Long conversations must expose timeline positions");
  assert.equal(timelineMarkerCount, await evaluate(`document.querySelectorAll('[data-timeline-anchor]').length`), "Comparison answers must share one marker per user turn");
  const firstTimelineId = await evaluate(`document.querySelector('[data-timeline-marker]').dataset.timelineMarker`);
  const timelineScrollBeforeHover = await evaluate(`document.querySelector('.message-list').scrollTop`);
  const timelineMarkerRect = await evaluate(`document.querySelector('[data-timeline-marker]').getBoundingClientRect().toJSON()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: timelineMarkerRect.x + timelineMarkerRect.width / 2, y: timelineMarkerRect.y + timelineMarkerRect.height / 2 });
  await until(`(()=>{const card=document.querySelector('[data-timeline-preview]');if(!card)return false;const r=card.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth})()`);
  const timelinePreviewRect = await evaluate(`document.querySelector('[data-timeline-preview]').getBoundingClientRect().toJSON()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: (timelineMarkerRect.left + timelinePreviewRect.right) / 2, y: timelineMarkerRect.y + timelineMarkerRect.height / 2 });
  await pause(250);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: timelinePreviewRect.x + timelinePreviewRect.width / 2, y: timelinePreviewRect.y + timelinePreviewRect.height / 2 });
  await pause(250);
  assert(await evaluate(`!!document.querySelector('[data-timeline-preview] h3')`), "The preview must stay open across the marker-to-card gap");
  assert.equal(await evaluate(`document.querySelector('.message-list').scrollTop`), timelineScrollBeforeHover, "Hovering a timeline marker must preserve reading position");
  await click('[data-timeline-preview] button[aria-label="Save bookmark"]');
  await until(`!!document.querySelector('[data-timeline-preview] button[aria-label="Remove bookmark"][aria-pressed="true"]')`);
  const timelineSavedReferences = await evaluate(`localStorage.getItem('cove.timeline.bookmarks.'+document.querySelector('[data-timeline-conversation]').dataset.timelineConversation)`);
  assert.equal(timelineSavedReferences, JSON.stringify([firstTimelineId]), "Bookmarks must persist identifiers only");
  await snapshot("timeline-preview-desktop");
  await escapeKey();
  await until(`!document.querySelector('[data-timeline-preview]')`);
  assert.equal(await evaluate(`document.querySelector('main').dataset.focusMode`), "true", "Escape must dismiss the timeline preview before Focus");
  await click('[data-timeline-marker]');
  await until(`document.querySelector('[data-timeline-marker]').getAttribute('aria-current')==='location'`);
  assert(await evaluate(`document.querySelector('.message-list').scrollTop<100`), "Clicking a marker must navigate to its turn");
  await escapeKey();
  await click(".workspace__focus-exit");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(250);
  assert.equal(await evaluate("document.documentElement.scrollWidth"), 390);
  await snapshot("long-markdown-390");
  await click('[data-timeline-marker]');
  await until(`!!document.querySelector('[data-timeline-preview]')`);
  assert(await evaluate(`(()=>{const r=document.querySelector('[data-timeline-preview]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`), "Timeline previews must fit narrow screens");
  await snapshot("timeline-preview-390");
  await evaluate(`window.__timelineFixtureBeforeReload=true`);
  await reloadPage();
  await until(`!window.__timelineFixtureBeforeReload && !!document.querySelector('[data-timeline-marker]')`);
  assert((await evaluate(`document.querySelector('[data-timeline-marker]').getAttribute('aria-label')`)).includes("Bookmarked"), "Timeline bookmarks must survive reloads");
  await click('[data-timeline-marker]');
  await click('[data-timeline-preview] button[aria-label="Remove bookmark"]');
  await until(`!document.querySelector('[data-timeline-marker]').getAttribute('aria-label').includes('Bookmarked')`);
  await escapeKey();
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pause(250);
  // Delete confirmation can be dismissed, then remove only its intended conversation.
  await rowAction("Delete");
  await clickText("Cancel", ".confirmation-dialog__panel");
  assert((await api("/api/conversations")).some((c) => c.id === current.id));
  await rowAction("Delete");
  await clickText("Delete", ".confirmation-dialog__panel");
  assert(!(await api("/api/conversations")).some((c) => c.id === current.id));
  await click(".model-selector__comparison-toggle");
  for (let i = 0; i < 3; i++) await click(".model-selector__chip-remove");
  await click(".model-selector__comparison-toggle");
  await click('button[aria-label="New conversation"]');
  await until(`!!document.querySelector('.conversation-welcome')`);
  await fill("#generation-input", "Normal fixture");
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    text: "\r",
    unmodifiedText: "\r",
    windowsVirtualKeyCode: 13,
    modifiers: 8,
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
  });
  await cdp("Input.insertText", { text: "Unicode: \u4f60\u597d" });
  assert.equal(
    await evaluate(`document.querySelector('#generation-input').value`),
    "Normal fixture\nUnicode: \u4f60\u597d",
  );
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
  });
  await until(
    `document.querySelector('.message--assistant')!==null && !document.querySelector('button[aria-label="Stop generation"]')`,
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.message--assistant').length`),
    1,
  );
  assert.equal(await evaluate(`document.querySelectorAll('.pick').length`), 0);
  await click(".message--assistant .message__privacy-toggle");
  await until(`!document.querySelector('.message__privacy-footnote').hidden`);
  await click(".message__snapshot summary");
  await until(`document.querySelector('.message__snapshot').open`);
  await snapshot("message-disclosures");
  // Persist model settings, export all local records and clear history through the confirmation.
  await click('button[aria-label="Settings"]');
  await until(
    `!!document.querySelector('.workspace-settings__prompt textarea')`,
  );
  await fill(".workspace-settings__prompt textarea", "Browser system prompt");
  await clickText("Save settings");
  await until(
    `document.querySelector('.workspace-settings').textContent.includes('Settings saved')`,
  );
  assert.equal(
    (await api("/api/settings")).system_prompt,
    "Browser system prompt",
  );
  await click("#settings-tab-chat-data");
  const beforeExport = (await readdir(downloads)).length;
  await clickText("JSON", ".chat-data__export");
  for (
    let i = 0;
    i < 50 && (await readdir(downloads)).length === beforeExport;
    i++
  )
    await pause(100);
  assert(
    (await readdir(downloads)).length > beforeExport,
    "Workspace export did not download",
  );
  await clickText("Clear chat data", ".danger");
  await clickText("Cancel", ".confirmation-dialog__panel");
  assert((await api("/api/conversations")).length > 0);
  await clickText("Clear chat data", ".danger");
  await clickText("Clear chat data", ".confirmation-dialog__panel");
  await until(
    `document.querySelector('.chat-data').textContent.includes('No conversations') || !document.querySelector('.conversation-row')`,
  );
  assert.equal((await api("/api/conversations")).length, 0);
  assert.equal(
    (await api("/api/settings")).system_prompt,
    "Browser system prompt",
  );
  assert((await api("/api/models")).some((p) => p.configured));
  await escape();
  async function chooseOption(label) {
    await until(
      `[...document.querySelectorAll('[role=option]')].some(e=>e.textContent.trim()===${JSON.stringify(label)})`,
    );
    await evaluate(
      `(async()=>{
        document.querySelectorAll('[data-fixture-option]').forEach(e=>e.removeAttribute('data-fixture-option'));
        const e=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getBoundingClientRect().width>0);
        if(!e)throw Error('Option missing');
        e.setAttribute('data-fixture-option','yes');
        let previous=e.getBoundingClientRect(),stable=0;
        for(let i=0;i<20 && stable<2;i++){
          await new Promise(requestAnimationFrame);
          const next=e.getBoundingClientRect();
          stable=Math.abs(next.top-previous.top)<0.5 && Math.abs(next.left-previous.left)<0.5 && Math.abs(next.height-previous.height)<0.5?stable+1:0;
          previous=next;
        }
        if(stable<2)throw Error('Option layout did not settle');
      })()`,
    );
    await click("[data-fixture-option]");
  }
  async function openProviders(name) {
    await click('button[aria-label="Settings"]');
    await click("#settings-tab-provider");
    if (name) {
      await click("#provider-settings [data-slot=select-trigger]");
      await chooseOption(name);
    }
  }
  // Create an X-API-Key profile, validate rotation, remove its key and profile.
  await openProviders();
  await click("#provider-settings [data-slot=select-trigger]");
  await chooseOption("New Provider");
  await evaluate(
    `(()=>{const inputs=document.querySelectorAll('.prov__body label input');inputs[0].id='fixture-provider-name';inputs[1].id='fixture-provider-endpoint';})()`,
  );
  await fill("#fixture-provider-name", "Second fixture provider");
  await fill(
    "#fixture-provider-endpoint",
    "http://127.0.0.1:" + provider.address().port,
  );
  await fill("#provider-settings .rotate input", "fixture-valid-key");
  await click('#provider-settings [aria-label="Authentication"]');
  await chooseOption("X-API-Key");
  await click(".prov__foot button:first-child");
  await until(
    `document.querySelector('#provider-settings').textContent.includes('Connection verified')`,
  );
  await clickText("Save Provider");
  await until(`!document.querySelector('.settings-dialog__panel')`);
  let secondProfile = (await api("/api/models")).find(
    (p) => p.name === "Second fixture provider",
  );
  assert(
    secondProfile?.configured && secondProfile.auth_method === "x_api_key",
  );
  assert(sawApiKeyHeader);
  await openProviders("Second fixture provider");
  await clickText("Rotate key");
  await fill("#provider-settings .rotate input", "invalid-key-fixture");
  await click(".prov__foot button:first-child");
  await until(
    `document.querySelector('#provider-settings').textContent.includes('rejected the API key')`,
  );
  await clickText("Save Provider");
  await until(
    `!document.querySelector('#provider-settings fieldset').disabled`,
  );
  assert(
    (await api("/api/models")).find((p) => p.id === secondProfile.id)
      .configured,
    "Rejected rotation erased the original key",
  );
  await fill("#provider-settings .rotate input", "fixture-replacement-key");
  await clickText("Save Provider");
  await until(`!document.querySelector('.settings-dialog__panel')`);
  await openProviders("Second fixture provider");
  await clickText("Remove Key");
  await until(
    `document.querySelector('#provider-settings').textContent.includes('Key not configured')`,
  );
  assert.equal(
    (await api("/api/models")).find((p) => p.id === secondProfile.id)
      .configured,
    false,
  );
  await clickText("Remove Provider");
  await until(
    `!document.querySelector('#provider-settings fieldset').disabled`,
  );
  assert(!(await api("/api/models")).some((p) => p.id === secondProfile.id));
  await until(
    `document.querySelectorAll("#provider-settings [data-slot=select-trigger]").length >= 3`,
  );
  await clickText("OpenAI-compatible", "#provider-settings");
  await chooseOption("NearAI preset");
  assert(
    await evaluate(
      `document.querySelector('#provider-settings [aria-label="Authentication"]').disabled`,
    ),
    "Preset authentication can be edited",
  );
  assert(
    await evaluate(
      `document.querySelectorAll('#provider-settings .prov__body label input')[1].readOnly`,
    ),
    "Preset endpoint can be edited",
  );
  await escape();
  // A skin override changes the same controls without palette-specific component branches.
  await evaluate(
    `document.documentElement.style.setProperty('--primary','#315ec7');document.documentElement.style.setProperty('--radius','12px')`,
  );
  await until(
    `getComputedStyle(document.querySelector('.conversation-list__new')).backgroundColor === 'rgb(49, 94, 199)'`,
  );
  await evaluate(
    `document.documentElement.style.removeProperty('--primary');document.documentElement.style.removeProperty('--radius')`,
  );
  // WCAG rules are evaluated in the same production browser and CSP context.
  const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  await evaluate(axe);
  await click('button[aria-label="New conversation"]');
  await until(`!!document.querySelector('.conversation-welcome')`);
  const audits = [];
  async function auditSurface(surface, skin, theme) {
    const violations = await evaluate(
      `axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,count:v.nodes.length,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))`,
    );
    audits.push({ surface, skin, theme, violations });
  }
  for (const skin of ["continuum", "blueprint", "studio", "grove"]) {
    await chooseSkin(skin);
    for (const theme of ["light", "dark"]) {
      if (
        await evaluate(
          `document.documentElement.dataset.theme !== ${JSON.stringify(theme)}`,
        )
      ) {
        await click('button[aria-label="Toggle day / night edition"]');
        await until(
          `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`,
        );
      }
      await assertLayout(skin + " " + theme + " audit");
      await auditSurface("welcome", skin, theme);
      await click('button[aria-label="Settings"]');
      await click("#settings-tab-general");
      await auditSurface("settings", skin, theme);
      await escape();
    }
  }
  await writeFile(
    path.join(evidenceDir, "accessibility.json"),
    JSON.stringify(audits, null, 2),
  );
  assert(
    !audits.some((a) =>
      a.violations.some(
        (v) => v.impact === "critical" || v.impact === "serious",
      ),
    ),
    "Accessibility findings require review",
  );
  assert.equal(exceptions.length, 0);
  socket.close();
  console.log(
    "Production browser acceptance passed: chat, comparison, context, retry/stop, conversation management, exports, Provider lifecycle, responsive layout, and accessibility.",
  );
  console.log(
    "Captured synthetic desktop and narrow-screen evidence. Browser runtime exceptions: 0.",
  );
} finally {
  catalogGate?.resolve();
  if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
    const exit = once(chrome, "exit");
    chrome.kill();
    await exit;
  }
  if (service && service.exitCode === null) {
    const exit = once(service, "exit");
    service.kill();
    await exit;
  }
  await new Promise((resolve) => provider.close(resolve));
  // Chrome subprocesses can finish profile writes just after the main process
  // exits on Linux. Retry transient ENOTEMPTY/EBUSY cleanup failures.
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
