// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useLauncherNavigation } from "./use-launcher-navigation";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

test("launcher settings waits for the Browser Session and consumes its intent", () => {
  window.history.replaceState(null, "", "/?view=chat#settings");
  const onOpenSettings = vi.fn();
  const onNewChat = vi.fn(async () => {});
  const { rerender } = renderHook(
    ({ ready }) => useLauncherNavigation({
      connection: ready ? "ready" : "loading", onNewChat, onOpenSettings,
    }),
    { initialProps: { ready: false } },
  );
  expect(onOpenSettings).not.toHaveBeenCalled();
  rerender({ ready: true });
  expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("general");
  expect(onNewChat).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("");
  expect(window.location.search).toBe("?view=chat");
  rerender({ ready: true });
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});

test("launcher New Chat creates one conversation under Strict Mode", async () => {
  window.history.replaceState(null, "", "/#new-chat");
  const onNewChat = vi.fn(async () => {});
  const onOpenSettings = vi.fn();
  renderHook(
    () => useLauncherNavigation({ connection: "ready", onNewChat, onOpenSettings }),
    { wrapper: StrictMode },
  );
  await act(async () => {});
  expect(onNewChat).toHaveBeenCalledTimes(1);
  expect(onOpenSettings).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("");
});

test("Provider setup waits for authorization and opens the Provider section once", () => {
  window.history.replaceState(null, "", "/#provider-setup");
  const onNewChat = vi.fn(async () => {});
  const onOpenSettings = vi.fn();
  const { rerender } = renderHook(({ ready }) => useLauncherNavigation({
    connection: ready ? "ready" : "loading", onNewChat, onOpenSettings,
  }), { initialProps: { ready: false }, wrapper: StrictMode });
  expect(onOpenSettings).not.toHaveBeenCalled();
  rerender({ ready: true });
  expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("provider");
  expect(onNewChat).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("");
  rerender({ ready: true });
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});

test("unrecognized fragments never dispatch launcher commands", () => {
  window.history.replaceState(null, "", "/#delete-history");
  const onNewChat = vi.fn(async () => {});
  const onOpenSettings = vi.fn();
  renderHook(() => useLauncherNavigation({ connection: "ready", onNewChat, onOpenSettings }));
  expect(onNewChat).not.toHaveBeenCalled();
  expect(onOpenSettings).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#delete-history");
});

test("a continued conversation opens once after authorization", () => {
  const id = "12345678-1234-4234-9234-123456789abc";
  window.history.replaceState(null, "", `/#conversation=${id}`);
  const onOpenConversation = vi.fn(async () => {});
  const onNewChat = vi.fn(async () => {});
  const onOpenSettings = vi.fn();
  const { rerender } = renderHook(
    ({ ready }) => useLauncherNavigation({ connection: ready ? "ready" : "loading", onNewChat, onOpenSettings, onOpenConversation }),
    { initialProps: { ready: false }, wrapper: StrictMode },
  );
  expect(onOpenConversation).not.toHaveBeenCalled();
  rerender({ ready: true });
  expect(onOpenConversation).toHaveBeenCalledExactlyOnceWith(id);
  expect(window.location.hash).toBe("");
  expect(onNewChat).not.toHaveBeenCalled();
  expect(onOpenSettings).not.toHaveBeenCalled();
});
