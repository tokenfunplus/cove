import assert from "node:assert/strict";

export async function checkMiniAppScroll(
  { cdp, evaluate, until, snapshot },
  modal,
  snapshotName,
) {
  const target = modal
    ? ".study-dialog-body button:not(:disabled)"
    : '[aria-label="Instance attachments"] input[type="file"]';
  const region = modal ? ".study-dialog-body" : "main.mini-app-shell";
  await until(`!!document.querySelector(${JSON.stringify(target)})`);
  await evaluate(`(() => {
    document.querySelector('[data-mini-scroll-target]')?.removeAttribute('data-mini-scroll-target');
    const nodes = document.querySelectorAll(${JSON.stringify(target)});
    nodes[nodes.length - 1].setAttribute('data-mini-scroll-target', '');
  })()`);
  const measure = `(() => {
    const container = document.querySelector(${JSON.stringify(region)});
    const bounds = container.getBoundingClientRect();
    const rect = document.querySelector('[data-mini-scroll-target]').getBoundingClientRect();
    const top = Math.max(0, bounds.top), bottom = Math.min(innerHeight, bounds.bottom);
    return { top: container.scrollTop, scrollable: container.scrollHeight > container.clientHeight,
      visible: rect.top >= top && rect.bottom <= bottom };
  })()`;
  let start;
  for (const height of [560, 420, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`document.querySelector(${JSON.stringify(region)}).scrollTop = 0`);
    start = await evaluate(measure);
    if (start.scrollable && !start.visible) break;
  }
  assert(start.scrollable, "The intended region has content to scroll");
  assert.equal(start.top, 0, "The intended region starts at the top");
  assert.equal(start.visible, false, "The same bottom control starts clipped before the wheel gesture");
  const point = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(region)});
    const r = el.getBoundingClientRect();
    const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    return { x: Math.min(innerWidth - 30, r.right - 30), y: (top + bottom) / 2 };
  })()`);
  await cdp("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...point,
    deltaX: 0,
    deltaY: 100000,
  });
  await until(`(() => { const current = ${measure}; return current.top > 0 && current.visible; })()`);
  assert(
    (await evaluate(measure)).top > start.top,
    "The wheel gesture moves the intended scroll container",
  );
  await snapshot(snapshotName);
  assert.equal(
    await evaluate(`(() => {
    const el = document.querySelector('[data-mini-scroll-target]'); const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.bottom - 4));
  })()`),
    true,
    "The bottom control is visible and receives pointer events",
  );
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
