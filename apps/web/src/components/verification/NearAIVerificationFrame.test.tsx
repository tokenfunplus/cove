// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NearAIVerificationFrame } from "./NearAIVerificationFrame";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
});

function message(frame: HTMLIFrameElement, type: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://cloud-stg.near.ai",
        source: frame.contentWindow,
        data: { type, version: 1, requestId: "component-fixture" },
      }),
    );
  });
}

test("viewer times out, reloads, follows the theme, and closes only after handshake", async () => {
  vi.useFakeTimers();
  const onClose = vi.fn();
  const { container, unmount } = render(
    <NearAIVerificationFrame
      evidence={{ kind: "model" }}
      modelId="fixture"
      onClose={onClose}
    />,
  );
  const frame = container.querySelector("iframe")!;
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(frame.tabIndex).toBe(-1);
  message(frame, "NEAR_AI_VERIFICATION_CLOSE");
  expect(onClose).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole("alert").textContent).toContain("unavailable");
  expect(frame.hasAttribute("src")).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Reload verification center" }),
  );
  message(frame, "NEAR_AI_VERIFICATION_CENTER_READY");
  expect(screen.queryByRole("status")).toBeNull();
  expect(frame.tabIndex).toBe(0);
  await act(async () => {
    document.documentElement.dataset.theme = "dark";
  });
  expect(new URL(frame.src).searchParams.get("darkMode")).toBe("true");
  expect(screen.getByRole("status").textContent).toContain("Loading");
  message(frame, "NEAR_AI_VERIFICATION_CENTER_READY");
  message(frame, "NEAR_AI_VERIFICATION_CLOSE");
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(frame.hasAttribute("src")).toBe(false);
});

test("missing evidence remains local without creating an iframe", () => {
  const { container } = render(<NearAIVerificationFrame onClose={vi.fn()} />);
  expect(container.querySelector("iframe")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Saved details");
});
