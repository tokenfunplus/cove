// @vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { request } from "@/api/client";
import { AppTaskSaveNotice } from "./AppTaskSaveNotice";

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
