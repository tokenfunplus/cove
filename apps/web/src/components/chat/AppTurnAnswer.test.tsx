// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import AppTurnAnswer from "./AppTurnAnswer";

vi.mock("@/components/miniapps/AppWorkspace", () => ({
  AppView: ({ proposal }: { proposal: unknown }) => (
    <output aria-label="Parsed proposal">{JSON.stringify(proposal)}</output>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test.each([
  '```json\n{"action":"list","inputs":{"term":"notes"}}\n```',
  'Suggested: {"action":"list","inputs":{"term":"notes"}}',
  'Proposed action: ```json\n{"action":"list","inputs":{"term":"notes"}}\n```',
])("renders the same normalized action it recognized: %s", async (body) => {
  vi.spyOn(miniApps, "get").mockResolvedValue({
    instance: {
      id: "book",
      name: "Notes",
      release_id: "r",
      enabled: true,
      revision: 1,
      grants: ["records.query"],
    },
    package: {
      format: 1,
      publisher: "author",
      app: "notes",
      name: "Notes",
      version: "1.0.0",
      schema_version: 1,
      capabilities: ["records.query"],
      collections: { notes: { fields: { text: "text" } } },
      pages: [{ id: "home", title: "Notes", actions: ["list"] }],
      actions: {
        list: {
          title: "Find notes",
          op: "query",
          collection: "notes",
          inputs: { term: "text" },
          surfaces: ["chat"],
        },
      },
    },
  });
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
        body={body}
        localRequired={false}
        disabled={false}
      />
    </QueryClientProvider>,
  );
  expect(
    JSON.parse((await screen.findByLabelText("Parsed proposal")).textContent!),
  ).toEqual({
    action: "list",
    inputs: { term: "notes" },
    actions: ["list"],
    origin: "g",
  });
  expect(screen.queryByText("The app action is unavailable.")).toBeNull();
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
