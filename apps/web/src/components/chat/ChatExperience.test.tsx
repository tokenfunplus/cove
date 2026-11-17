// @vitest-environment jsdom
import { render, screen, cleanup, act } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  GenerationActivity,
  FailureActions,
  ChatExperienceContext,
} from "./ChatExperience";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test("a quiet stream shows elapsed time and a stop action, then resumes after new text", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const stop = vi.fn();
  const { rerender } = render(
    <GenerationActivity
      phase="streaming"
      body=""
      onStop={stop}
      stopWhenStalledOnly
    />,
  );
  expect(screen.queryByText("Stop generation")).toBeNull();
  act(() => vi.advanceTimersByTime(16000));
  expect(screen.getByText("Taking longer than usual.")).toBeTruthy();
  screen.getByText("Stop generation").click();
  expect(stop).toHaveBeenCalledOnce();
  rerender(
    <GenerationActivity
      phase="streaming"
      body="New text"
      onStop={stop}
      stopWhenStalledOnly
    />,
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("Receiving response")).toBeTruthy();
  expect(screen.queryByText("Taking longer than usual.")).toBeNull();
});
test("credential failures offer settings and model recovery while active work disables navigation", () => {
  render(
    <ChatExperienceContext.Provider
      value={{ chooseModel: vi.fn(), openSettings: vi.fn(), busy: true }}
    >
      <FailureActions code="authentication_failed" />
    </ChatExperienceContext.Provider>,
  );
  expect(
    (screen.getByText("Open Provider settings") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByText("Choose another model") as HTMLButtonElement).disabled,
  ).toBe(true);
});
