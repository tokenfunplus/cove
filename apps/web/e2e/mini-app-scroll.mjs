import assert from "node:assert/strict";

export async function checkMiniAppScroll(
  { cdp, evaluate, until, snapshot },
  modal,
  snapshotName,
) {
  await until(`!!document.querySelector('.study-dialog-body button:not(:disabled), [aria-label="Instance attachments"] input[type="file"]')`);
  await evaluate(`(() => {
    document.querySelector('[data-mini-scroll-target]')?.removeAttribute('data-mini-scroll-target');
    document.querySelector('[data-mini-scroll-region]')?.removeAttribute('data-mini-scroll-region');
    const dialog = document.querySelector('.study-dialog-body');
    const region = dialog ?? document.querySelector('main.mini-app-shell');
    region.setAttribute('data-mini-scroll-region', '');
    const nodes = region.querySelectorAll(dialog ? 'button:not(:disabled)' : '[aria-label="Instance attachments"] input[type="file"]');
    nodes[nodes.length - 1].setAttribute('data-mini-scroll-target', '');
    window.__miniAppScrollMeasure = () => {
      const bounds = region.getBoundingClientRect();
      const rect = document.querySelector('[data-mini-scroll-target]').getBoundingClientRect();
      const top = Math.max(0, bounds.top), bottom = Math.min(innerHeight, bounds.bottom);
      return { top: region.scrollTop, scrollable: region.scrollHeight > region.clientHeight,
        modal: Boolean(dialog), visible: rect.top >= top && rect.bottom <= bottom };
    };
  })()`);
  let start;
  for (const height of [560, 420, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate("document.querySelector('[data-mini-scroll-region]').scrollTop = 0");
    start = await evaluate("window.__miniAppScrollMeasure()");
    if (start.scrollable && !start.visible) break;
  }
  assert.equal(start.modal, modal, "The intended region is selected");
  assert(start.scrollable, "The intended region has content to scroll");
  assert.equal(start.top, 0, "The intended region starts at the top");
  assert.equal(start.visible, false, "The same bottom control starts clipped before the wheel gesture");
  const point = await evaluate(`(() => {
    const el = document.querySelector('[data-mini-scroll-region]');
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
  await until("(() => { const current = window.__miniAppScrollMeasure(); return current.top > 0 && current.visible; })()");
  assert(
    (await evaluate("window.__miniAppScrollMeasure()")).top > start.top,
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
