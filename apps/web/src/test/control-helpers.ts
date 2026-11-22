import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

export function setupControlTests() {
  const patched: string[] = [];
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"]) {
      if (Reflect.get(Element.prototype, name) !== undefined) continue;
      Object.defineProperty(Element.prototype, name, { configurable: true, value: name === "hasPointerCapture" ? () => false : () => {} });
      patched.push(name);
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of patched.splice(0)) Reflect.deleteProperty(Element.prototype, name);
  });
}

export async function chooseOption(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, label: string) {
  await user.click(field);
  await user.click(await screen.findByRole("option", { name: label }));
}
