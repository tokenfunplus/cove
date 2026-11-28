// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  MiniAppAction,
  MiniAppPackage,
  MiniAppSurface,
} from "@cove/api-contract";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import * as client from "@/api/client";
import { AppView, AppWorkspace } from "./AppWorkspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const list: MiniAppAction = {
  title: "List notes",
  op: "query",
  collection: "notes",
  inputs: {},
  surfaces: ["page", "chat", "panel"],
};
const pkg: MiniAppPackage = {
  format: 1,
  publisher: "studio",
  app: "notebook",
  name: "Notebook",
  version: "1.0.0",
  schema_version: 1,
  capabilities: ["records.query", "chat.attach"],
  collections: { notes: { fields: { text: "text" } } },
  pages: [{ id: "home", title: "Notes", actions: ["list"] }],
  actions: {
    list,
    quick: { ...list, title: "Panel notes", surfaces: ["panel"] },
    chat: { ...list, title: "Chat notes", surfaces: ["chat"] },
  },
};
function mount(surface: MiniAppSurface) {
  vi.spyOn(miniApps, "get").mockResolvedValue({
    instance: {
      id: "book",
      name: "Notebook",
      release_id: "release",
      enabled: true,
      revision: 1,
      grants: pkg.capabilities,
    },
    package: pkg,
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const attach = vi.fn();
  render(
    <QueryClientProvider client={cache}>
      <AppWorkspace
        id="book"
        surface={surface}
        back={vi.fn()}
        navigate={vi.fn()}
        attach={attach}
      />
    </QueryClientProvider>,
  );
  return attach;
}

test.each(["chat", "panel", "page"] as const)(
  "discovers actions for the %s surface",
  async (surface) => {
    vi.spyOn(miniApps, "invoke").mockResolvedValue({ records: [] });
    vi.spyOn(client, "request").mockResolvedValue(null);
    mount(surface);
    await screen.findByRole("button", { name: "List notes" });
    for (const [name, allowed, id] of [
      ["Panel notes", "panel", "quick"],
      ["Chat notes", "chat", "chat"],
    ] as const) {
      const button = screen.queryByRole("button", { name });
      if (surface !== allowed) {
        expect(button).toBeNull();
      } else {
        expect(button).not.toBeNull();
        await userEvent.click(button!);
        await waitFor(() =>
          expect(miniApps.invoke).toHaveBeenCalledWith(
            "book",
            expect.objectContaining({ surface, action: id }),
          ),
        );
        await userEvent.click(
          screen.getByRole("button", {
            name: "Ask a model to propose an action",
          }),
        );
        expect(screen.getByRole("checkbox", { name })).toBeDefined();
      }
    }
  },
);

test("loads the next page and attaches selections from both pages", async () => {
  const first = { id: "first", revision: 1, fields: { text: "First note" } };
  const last = { id: "last", revision: 1, fields: { text: "Last note" } };
  vi.spyOn(miniApps, "invoke").mockImplementation(async (_, cmd) =>
    cmd.cursor === "next"
      ? { records: [last] }
      : { records: [first], next_cursor: "next" },
  );
  const snapshot = vi
    .spyOn(miniApps, "attach")
    .mockResolvedValue({ records: [first, last] });
  const attach = mount("panel");
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Select record 1"));
  await user.click(screen.getByRole("button", { name: "Load more records" }));
  await user.click(await screen.findByLabelText("Select record 2"));
  expect(
    screen.queryByRole("button", { name: "Load more records" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Add to current draft (2)" }),
  );
  await waitFor(() => expect(attach).toHaveBeenCalledOnce());
  expect(snapshot).toHaveBeenCalledWith(
    "book",
    expect.objectContaining({
      records: [
        { id: "first", revision: 1 },
        { id: "last", revision: 1 },
      ],
      surface: "panel",
    }),
  );
});

test("refresh invalidates changed and removed selections while retaining unchanged records", async () => {
  const original = [
    { id: "changed", revision: 1, fields: { text: "Original" } },
    { id: "removed", revision: 1, fields: { text: "Removed" } },
    { id: "kept", revision: 1, fields: { text: "Unchanged" } },
  ];
  const invoke = vi
    .spyOn(miniApps, "invoke")
    .mockResolvedValue({ records: original });
  const attachRecords = vi
    .spyOn(miniApps, "attach")
    .mockResolvedValue({ records: [original[2]] });
  const attach = mount("panel");
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Select record 1"));
  await user.click(screen.getByLabelText("Select record 2"));
  await user.click(screen.getByLabelText("Select record 3"));
  await screen.findByRole("button", { name: "Add to current draft (3)" });
  invoke.mockResolvedValue({
    records: [
      { ...original[0], revision: 2, fields: { text: "Updated" } },
      original[2],
    ],
  });
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("Updated");
  await screen.findByRole("button", { name: "Add to current draft (1)" });
  expect(
    screen.getByText(
      "Some selected items changed or are no longer in the loaded results. Review the remaining selection before continuing.",
    ),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText("Select record 1") as HTMLInputElement).checked,
  ).toBe(false);
  expect(
    (screen.getByLabelText("Select record 2") as HTMLInputElement).checked,
  ).toBe(true);
  await user.click(
    screen.getByRole("button", { name: "Add to current draft (1)" }),
  );
  await waitFor(() => expect(attach).toHaveBeenCalledOnce());
  expect(attachRecords).toHaveBeenCalledWith(
    "book",
    expect.objectContaining({ records: [{ id: "kept", revision: 1 }] }),
  );
});

test("opening a query form does not freeze the current record selection", async () => {
  vi.spyOn(miniApps, "invoke").mockResolvedValue({
    records: [{ id: "note", revision: 1, fields: { text: "One note" } }],
  });
  const filter = {
    ...list,
    title: "Find notes",
    inputs: { term: "text" as const },
  };
  const withFilter = {
    ...pkg,
    actions: { ...pkg.actions, filter },
    pages: [{ ...pkg.pages[0], actions: ["list", "filter"] }],
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AppView
        instance={{
          id: "book",
          name: "Notes",
          release_id: "r",
          revision: 1,
          enabled: true,
          grants: pkg.capabilities,
        }}
        pkg={withFilter}
        page={withFilter.pages[0]}
        surface="panel"
        attach={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Select record 1"));
  await user.click(screen.getByRole("button", { name: "Find notes" }));
  await screen.findByLabelText("Term");
  expect(
    (screen.getByLabelText("Select record 1") as HTMLInputElement).disabled,
  ).toBe(false);
  expect(
    (screen.getByLabelText("Select record 1") as HTMLInputElement).checked,
  ).toBe(true);
});

test("editing freezes the selected record and a write-only chat proposal offers a local query", async () => {
  const rows = [
    { id: "a", revision: 1, fields: { text: "Original A" } },
    { id: "b", revision: 1, fields: { text: "Original B" } },
  ];
  const edit: MiniAppAction = {
    title: "Edit note",
    op: "update",
    collection: "notes",
    inputs: { text: "text" },
    values: { text: "$input.text" },
    surfaces: ["page", "chat"],
  };
  const book = {
    ...pkg,
    actions: { ...pkg.actions, edit },
    pages: [{ id: "home", title: "Notes", actions: ["list", "edit"] }],
  };
  const invoke = vi
    .spyOn(miniApps, "invoke")
    .mockImplementation(async (_, cmd) =>
      cmd.action === "list"
        ? { records: rows }
        : { records: [rows[0]], confirmation: "reviewed" },
    );
  const user = userEvent.setup();
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={cache}>
      <AppView
        instance={{
          id: "book",
          name: "Notebook",
          release_id: "r",
          enabled: true,
          revision: 1,
          grants: ["records.query", "records.commit"],
        }}
        pkg={book}
        page={book.pages[0]}
        surface="chat"
        attach={vi.fn()}
        proposal={{
          action: "edit",
          inputs: { text: "Updated" },
          actions: ["edit"],
        }}
      />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByLabelText("Select record 1"));
  await user.click(screen.getByRole("button", { name: "Edit note" }));
  expect(
    (screen.getByLabelText("Select record 2") as HTMLInputElement).disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "book",
      expect.objectContaining({
        action: "edit",
        records: [{ id: "a", revision: 1 }],
      }),
    ),
  );
});

test.each(["changed", "removed"])(
  "background refresh retires a %s write target and explains the reset",
  async (change) => {
    const original = [
      { id: "a", revision: 1, fields: { text: "Original A" } },
      { id: "b", revision: 1, fields: { text: "Original B" } },
    ];
    const edit: MiniAppAction = {
      title: "Edit selected notes",
      op: "update",
      collection: "notes",
      inputs: { text: "text" },
      values: { text: "$input.text" },
      surfaces: ["page"],
    };
    const book = {
      ...pkg,
      capabilities: ["records.query", "records.commit"],
      actions: { list, edit },
      pages: [{ id: "home", title: "Notes", actions: ["list", "edit"] }],
    };
    const invoke = vi
      .spyOn(miniApps, "invoke")
      .mockResolvedValue({ records: original });
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={cache}>
        <AppView
          instance={{
            id: "book",
            name: "Notebook",
            release_id: "r",
            enabled: true,
            revision: 1,
            grants: book.capabilities,
          }}
          pkg={book}
          page={book.pages[0]}
          surface="page"
          attach={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("Select record 1"));
    await user.click(screen.getByLabelText("Select record 2"));
    await user.click(
      screen.getByRole("button", { name: "Edit selected notes" }),
    );
    await screen.findByRole("button", { name: "Preview changes" });
    invoke.mockResolvedValue({
      records:
        change === "removed"
          ? [original[1]]
          : [
              {
                ...original[0],
                revision: 2,
                fields: { text: "Updated elsewhere" },
              },
              original[1],
            ],
    });
    await act(async () => {
      await cache.invalidateQueries({ queryKey: ["mini-app-records", "book"] });
    });
    await screen.findByText(
      "Saved items changed. Reopen the action to review the latest selection.",
    );
    expect(
      screen.queryByText(
        "Some selected items changed or are no longer in the loaded results. Review the remaining selection before continuing.",
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Preview changes" }),
    ).toBeNull();
    expect(
      invoke.mock.calls.every(([, command]) => command.action === "list"),
    ).toBe(true);
    const selected = screen
      .getAllByRole("checkbox")
      .filter((box) => (box as HTMLInputElement).checked);
    expect(selected).toHaveLength(1);
  },
);
