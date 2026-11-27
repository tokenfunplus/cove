// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { HostActivity } from "./HostActivity";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("global activity loads on demand and requests the selected instance", async () => {
  const history = vi.spyOn(miniApps, "hostActivity").mockResolvedValue({
    activity: [
      {
        instance_id: "book",
        instance_name: "Review",
        operation_id: "save",
        action: "review.add",
        release_id: "r",
        surface: "page",
        status: "completed",
        time: 1,
      },
    ],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <HostActivity
        instances={[
          {
            id: "book",
            name: "Review",
            release_id: "r",
            enabled: true,
            revision: 1,
            grants: [],
          },
        ]}
      />
    </QueryClientProvider>,
  );
  expect(history).not.toHaveBeenCalled();
  const details = screen.getByText("Host activity").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByText("Review", { selector: "strong" });
  fireEvent.change(screen.getByLabelText("App"), {
    target: { value: "book" },
  });
  await waitFor(() => expect(history).toHaveBeenLastCalledWith("book"));
});

test("activity can save a retained result after its app is disabled without starting another model task", async () => {
  let saved = false;
  const history = vi
    .spyOn(miniApps, "hostActivity")
    .mockImplementation(async () => ({
      activity: [
        {
          instance_id: "book",
          instance_name: "Review",
          operation_id: "paid-task",
          action: "review.generate",
          release_id: "r",
          surface: "page",
          status: saved ? "completed" : "save_failed",
          time: 1,
        },
      ],
    }));
  const retry = vi
    .spyOn(miniApps, "retryTaskSave")
    .mockImplementation(async () => {
      saved = true;
    });
  const start = vi.spyOn(miniApps, "startTask");
  const propose = vi.spyOn(miniApps, "startProposal");
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <HostActivity
        expanded
        instances={[
          {
            id: "book",
            name: "Review",
            release_id: "r",
            enabled: false,
            revision: 2,
            grants: [],
          },
        ]}
      />
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", {
    name: "Retry saving result",
  });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  await userEvent.setup().click(button);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry saving result" }),
    ).toBeNull(),
  );
  expect(retry).toHaveBeenCalledExactlyOnceWith("book", "paid-task");
  expect(history.mock.calls.length).toBeGreaterThan(1);
  expect(start).not.toHaveBeenCalled();
  expect(propose).not.toHaveBeenCalled();
});
