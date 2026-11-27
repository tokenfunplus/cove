import assert from "node:assert/strict";

export async function checkMiniAppScroll(
  { cdp, evaluate, until, snapshot },
  modal,
) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 900,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const target = modal
    ? ".study-dialog button:not(:disabled)"
    : '[aria-label="Instance attachments"]';
  await until(`!!document.querySelector(${JSON.stringify(target)})`);
  const point = await evaluate(`(() => {
    const el = ${modal ? 'document.querySelector(".study-dialog")' : 'document.querySelector("main")'};
    const r = el.getBoundingClientRect();
    return { x: Math.min(innerWidth - 30, r.right - 30), y: innerHeight / 2 };
  })()`);
  await cdp("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...point,
    deltaX: 0,
    deltaY: 100000,
  });
  await until(`(() => {
    const nodes = document.querySelectorAll(${JSON.stringify(target)});
    const el = nodes[nodes.length - 1];
    const r = el.getBoundingClientRect();
    return r.bottom <= innerHeight && r.top >= 0;
  })()`);
  await snapshot(
    modal
      ? "mini-app-install-scroll-bottom"
      : "mini-app-attachments-scroll-bottom",
  );
  assert.equal(
    await evaluate(`(() => {
    const nodes = document.querySelectorAll(${JSON.stringify(target)});
    const el = nodes[nodes.length - 1]; const r = el.getBoundingClientRect();
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
