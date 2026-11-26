// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RankingControl } from "./RichCardControls";

const options = ["Walk", "Museum", "Lunch"].map((label) => ({
  value: label.toLowerCase(),
  label,
}));
const animate = vi.fn();
const cancel = vi.fn();
let reduced = false;
function Example({ locked = false }: { locked?: boolean }) {
  const [value, setValue] = useState(options.map((option) => option.value));
  return (
    <RankingControl
      label="Your route"
      options={options}
      value={value}
      locked={locked}
      onChange={setValue}
    />
  );
}
function order() {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((row) => row.dataset.rankingItem);
}
beforeEach(() => {
  reduced = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced })),
  );
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  animate.mockImplementation(() => ({ cancel }));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const top = this.parentElement
        ? [...this.parentElement.children].indexOf(this) * 80
        : 0;
      return {
        top,
        bottom: top + 80,
        left: 0,
        right: 300,
        width: 300,
        height: 80,
        x: 0,
        y: top,
        toJSON() {},
      };
    },
  );
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: animate,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (Element.prototype as Partial<Element>).animate;
});

test("keyboard reorders animate displaced rows, retain focus and announce the new position", () => {
  render(<Example />);
  expect(animate).not.toHaveBeenCalled();
  const grip = screen.getByRole("button", { name: "Drag Museum to reorder" });
  act(() => grip.focus());
  fireEvent.keyDown(grip, { key: "ArrowUp" });
  expect(order()).toEqual(["museum", "walk", "lunch"]);
  expect(document.activeElement).toBe(grip);
  expect(screen.getByRole("status").textContent).toBe(
    "Museum moved to position 1.",
  );
  expect(animate).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(grip, { key: "ArrowDown" });
  expect(order()).toEqual(["walk", "museum", "lunch"]);
  expect(cancel).toHaveBeenCalledTimes(2);
});

test("pointer dragging moves within its own list and stops on release", () => {
  render(<Example />);
  const rows = screen.getAllByRole("listitem");
  const hit = vi.fn().mockReturnValue(rows[2]);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: hit,
  });
  const grip = screen.getByRole("button", { name: "Drag Walk to reorder" });
  fireEvent.pointerDown(grip, { button: 0 });
  fireEvent.pointerMove(grip, { clientX: 50, clientY: 200, buttons: 1 });
  expect(order()).toEqual(["museum", "lunch", "walk"]);
  fireEvent.pointerUp(grip);
  hit.mockReturnValue(rows[0]);
  fireEvent.pointerMove(grip, { clientX: 50, clientY: 0 });
  expect(order()).toEqual(["museum", "lunch", "walk"]);
  delete (document as Partial<Document>).elementFromPoint;
});

test("reduced motion keeps reordering immediate, and submitted lists have no editing controls", () => {
  reduced = true;
  const { rerender } = render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "Move Museum up" }));
  expect(order()[0]).toBe("museum");
  expect(animate).not.toHaveBeenCalled();
  rerender(<Example locked />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getAllByRole("listitem").every((row) => !row.draggable)).toBe(
    true,
  );
});

test("releasing a secondary pointer does not cancel the active reorder", () => {
  render(<Example />);
  const hit = vi.fn().mockReturnValue(screen.getAllByRole("listitem")[2]);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: hit,
  });
  const grip = screen.getByRole("button", { name: "Drag Walk to reorder" });
  fireEvent.pointerDown(grip, { button: 0, pointerId: 1, isPrimary: true });
  fireEvent.pointerDown(grip, { button: 0, pointerId: 2, isPrimary: false });
  fireEvent.pointerUp(grip, { pointerId: 2, isPrimary: false });
  fireEvent.pointerMove(grip, {
    pointerId: 1,
    clientX: 50,
    clientY: 200,
    buttons: 1,
  });
  expect(order()).toEqual(["museum", "lunch", "walk"]);
  fireEvent.pointerCancel(grip, { pointerId: 1 });
  hit.mockReturnValue(screen.getAllByRole("listitem")[0]);
  fireEvent.pointerMove(grip, {
    pointerId: 1,
    clientX: 50,
    clientY: 0,
    buttons: 1,
  });
  expect(order()).toEqual(["museum", "lunch", "walk"]);
  delete (document as Partial<Document>).elementFromPoint;
});
