// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import AppTurnAnswer from "./AppTurnAnswer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("a normal scoped answer renders without querying app records or reporting a proposal failure", async () => {
  const get = vi.spyOn(miniApps, "get");
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AppTurnAnswer
        generationId="g"
        scope={{
          instance: "book",
          release: "r",
          revision: 1,
          actions: ["list"],
        }}
        body="You can use this app to collect notes."
        localRequired={false}
        disabled={false}
      />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("You can use this app to collect notes."),
  ).toBeDefined();
  expect(get).not.toHaveBeenCalled();
  expect(screen.queryByText("The app action is unavailable.")).toBeNull();
});
