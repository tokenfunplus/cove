// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ComposerAppPicker from "./ComposerAppPicker";

const calls = vi.hoisted(() => ({
  attach: undefined as ((body: string) => void) | undefined,
}));
vi.mock("@/components/miniapps/AppPicker", () => ({
  default: ({ attach }: { attach: (body: string) => void }) => {
    calls.attach = attach;
    return null;
  },
}));
afterEach(cleanup);

test("pending snapshots append to the latest draft and expire when the destination changes", () => {
  const change = vi.fn(),
    close = vi.fn();
  const props = { surface: "chat" as const, change, close, busy: false };
  const ui = render(
    <ComposerAppPicker key="first" {...props} draft="Old draft" />,
  );
  const first = calls.attach!;
  ui.rerender(
    <ComposerAppPicker key="first" {...props} draft="More recent draft" />,
  );
  act(() => first("Snapshot"));
  expect(change).toHaveBeenCalledWith("More recent draft\n\nSnapshot");
  ui.rerender(
    <ComposerAppPicker
      key="second"
      {...props}
      draft="Different conversation"
    />,
  );
  expect(() => first("Late snapshot")).toThrow("destination changed");
  ui.rerender(
    <ComposerAppPicker
      key="second"
      {...props}
      busy
      draft="Different conversation"
    />,
  );
  expect(() => calls.attach!("During send")).toThrow("This chat is busy");
  expect(change).toHaveBeenCalledTimes(1);
  ui.rerender(
    <ComposerAppPicker key="second" {...props} draft="Kept while busy" />,
  );
  act(() => calls.attach!("Retried snapshot"));
  expect(change).toHaveBeenLastCalledWith(
    "Kept while busy\n\nRetried snapshot",
  );
  expect(close).toHaveBeenCalledTimes(2);
});
