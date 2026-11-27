// @vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { request } from "@/api/client";
import {
  AppTaskSaveBlockedNotice,
  AppTaskSaveNotice,
} from "./AppTaskSaveNotice";

vi.mock("@/api/client", () => ({
  request: vi.fn(),
  fetchLocalService: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function show(onSaved = vi.fn()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
          },
        })
      }
    >
      <AppTaskSaveNotice
        instance="book"
        task="proposal-job"
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  return onSaved;
}

test("retrying an unsaved proposal uses only the existing task's save endpoint", async () => {
  vi.mocked(request).mockResolvedValue(undefined);
  const onSaved = show();
  expect(screen.getByText(/without running the model again/)).toBeTruthy();
  expect(
    screen.getByText(
      /If you quit before saving, this unsaved result will be lost/,
    ),
  ).toBeTruthy();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Retry saving result" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "/api/mini-apps/instances/book/tasks/proposal-job/retry-save",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
});

test("a failed save remains recoverable using the same task without automatic retries", async () => {
  vi.mocked(request)
    .mockRejectedValueOnce(new Error("Storage is full."))
    .mockResolvedValueOnce(undefined);
  const onSaved = show();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Retry saving result" }));
  await screen.findByRole("alert");
  expect(request).toHaveBeenCalledTimes(1);
  expect(onSaved).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Retry saving result" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(request)
      .mock.calls.every(
        ([path]) =>
          path ===
          "/api/mini-apps/instances/book/tasks/proposal-job/retry-save",
      ),
  ).toBe(true);
});

test("discard requires confirmation and removes only the selected unsaved output", async () => {
  vi.mocked(request).mockResolvedValue(undefined);
  const onSaved = show();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Discard unsaved result" }),
  );
  await screen.findByRole("dialog", { name: "Discard this unsaved result?" });
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(request).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Discard unsaved result" }),
  );
  await user.click(screen.getByRole("button", { name: "Discard result" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "/api/mini-apps/instances/book/tasks/proposal-job/discard-result",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
});

test("the blocked notice identifies the app and opens Activity through draft-aware navigation", async () => {
  vi.mocked(request).mockResolvedValue({
    activity: [{ instance_name: "My reading book", status: "save_failed" }],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <AppTaskSaveBlockedNotice
        error={{ envelope: { error: { code: "task_save_pending" } } }}
      />
    </QueryClientProvider>,
  );
  await screen.findByText(/My reading book/);
  const link = screen.getByRole("link", { name: "Open Activity" });
  expect(link.getAttribute("href")).toBe("/apps?section=activity");
  const navigation = vi.fn();
  window.addEventListener("popstate", navigation);
  await userEvent.setup().click(link);
  expect(navigation).toHaveBeenCalledOnce();
  window.removeEventListener("popstate", navigation);
  window.history.replaceState(null, "", "/");
});

test("a failed discard closes the confirmation and exposes the recoverable storage error", async () => {
  vi.mocked(request).mockRejectedValue(new Error("Disk is unavailable."));
  const onSaved = show();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Discard unsaved result" }),
  );
  await user.click(screen.getByRole("button", { name: "Discard result" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("alert").textContent).toContain(
    "Disk is unavailable",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Retry saving result",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(onSaved).not.toHaveBeenCalled();
});
