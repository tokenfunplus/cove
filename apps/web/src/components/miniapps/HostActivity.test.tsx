// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { HostActivity } from "./HostActivity";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("global activity loads on demand and requests the selected instance", async () => {
  const history = vi
    .spyOn(miniApps, "hostActivity")
    .mockResolvedValue({
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
  fireEvent.change(screen.getByLabelText("Instance"), {
    target: { value: "book" },
  });
  await waitFor(() => expect(history).toHaveBeenLastCalledWith("book"));
});
