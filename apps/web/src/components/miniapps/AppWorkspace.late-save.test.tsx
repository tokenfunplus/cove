// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppPackage } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { AppView } from "./AppWorkspace";

vi.mock("./AppProcessing", () => ({ AppProcessing: () => null }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a late confirmed write refreshes records without discarding a newer form or selection", async () => {
  const rows = [
    { id: "a", revision: 1, fields: { text: "Saved A" } },
    { id: "b", revision: 1, fields: { text: "Saved B" } },
  ];
  const pkg: MiniAppPackage = {
    format: 1,
    publisher: "author",
    app: "notes",
    name: "Notes",
    version: "1.0.0",
    schema_version: 1,
    capabilities: ["records.query", "records.commit"],
    collections: { notes: { fields: { text: "text" } } },
    pages: [{ id: "home", title: "Notes", actions: ["list", "add", "other"] }],
    actions: {
      list: {
        title: "List notes",
        op: "query",
        collection: "notes",
        surfaces: ["page"],
      },
      add: {
        title: "Add note",
        op: "create",
        collection: "notes",
        inputs: { text: "text" },
        values: { text: "$input.text" },
        surfaces: ["page"],
      },
      other: {
        title: "Another note",
        op: "create",
        collection: "notes",
        inputs: { text: "text" },
        values: { text: "$input.text" },
        surfaces: ["page"],
      },
    },
  };
  let finish!: () => void;
  let committed = false;
  const saved = { id: "c", revision: 1, fields: { text: "Newly saved C" } };
  const confirmation = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const invoke = vi
    .spyOn(miniApps, "invoke")
    .mockImplementation(async (_, command) => {
      if (command.action === "list") return { records: committed ? [...rows, saved] : rows };
      if (command.confirm) {
        await confirmation;
        committed = true;
        return { records: [saved] };
      }
      return { records: [rows[0]], confirmation: "reviewed" };
    });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppView
        instance={{
          id: "book",
          name: "Notes",
          release_id: "release",
          revision: 1,
          enabled: true,
          grants: pkg.capabilities,
        }}
        pkg={pkg}
        page={pkg.pages[0]}
        surface="page"
        attach={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByLabelText("Select record 2");
  await user.click(screen.getByRole("button", { name: "Add note" }));
  await user.type(
    screen.getByRole("textbox", { name: "Text" }),
    "First request",
  );
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  await user.click(
    await screen.findByRole("button", { name: "Confirm changes" }),
  );
  await waitFor(() =>
    expect(invoke.mock.calls.some(([, command]) => !!command.confirm)).toBe(
      true,
    ),
  );
  await user.click(screen.getByRole("button", { name: "Another note" }));
  await user.type(
    screen.getByRole("textbox", { name: "Text" }),
    "Keep this new draft",
  );
  await user.click(screen.getByLabelText("Select record 2"));
  await act(async () => {
    finish();
    await confirmation;
  });
  await screen.findByText("Newly saved C");
  expect(
    (screen.getByRole("textbox", { name: "Text" }) as HTMLTextAreaElement)
      .value,
  ).toBe("Keep this new draft");
  expect(
    (screen.getByLabelText("Select record 2") as HTMLInputElement).checked,
  ).toBe(true);
});
