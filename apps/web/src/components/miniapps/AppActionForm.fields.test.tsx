// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MiniAppFields, MiniAppPackage } from "@cove/api-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { AppActionForm } from "./AppActionForm";

vi.mock("./AppProcessing", () => ({ AppProcessing: () => null }));
vi.mock("./AppFileInput", () => ({ AppFileInput: () => null }));
vi.mock("./AppModelTask", () => ({ AppModelTask: () => null }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const pkg: MiniAppPackage = {
  format: 1,
  publisher: "studio",
  app: "notes",
  name: "Notes",
  version: "1.0.0",
  schema_version: 1,
  capabilities: ["records.commit"],
  collections: {
    notes: { fields: { body: "text", active: "bool", remindOn: "date" } },
  },
  pages: [],
  actions: {
    add: {
      title: "Add a note",
      op: "create",
      collection: "notes",
      surfaces: ["page"],
      inputs: { body: "text", active: "bool", remindOn: "date" },
      defaults: { active: false, remindOn: "2030-01-04" },
      values: {
        body: "$input.body",
        active: "$input.active",
        remindOn: "$input.remindOn",
      },
    },
  },
};
function mount(initial?: MiniAppFields, source = pkg) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppActionForm
        instance={{
          id: "book",
          name: "Notes",
          release_id: "release",
          revision: 1,
          enabled: true,
          grants: ["records.commit"],
        }}
        pkg={source}
        initial={initial}
        actionId="add"
        surface="page"
        selected={[]}
        localRequired={false}
        query={vi.fn()}
        saved={vi.fn()}
        close={vi.fn()}
        candidate={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

test("defaulted options stay out of the main form and are preserved without opening them", async () => {
  const invoke = vi
    .spyOn(miniApps, "invoke")
    .mockResolvedValue({ records: [], confirmation: "reviewed" });
  mount();
  const options = screen.getByText("More options").closest("details")!;
  expect(options.open).toBe(false);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Body" }), "A note");
  expect(screen.getByLabelText("Active").closest("details")).toBe(options);
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "book",
      expect.objectContaining({
        inputs: { body: "A note", active: false, remindOn: "2030-01-04" },
      }),
    ),
  );
});

test("proposed non-default options open automatically and remain editable", async () => {
  mount({ body: "Proposed note", active: true, remindOn: "2030-01-05" });
  const options = screen.getByText("More options").closest("details")!;
  expect(options.open).toBe(true);
  expect((screen.getByLabelText("Active") as HTMLInputElement).checked).toBe(
    true,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText("More options"));
  expect(options.open).toBe(false);
});

test("a proposal equal to a resolved date default does not expand ordinary options", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 28, 12));
  const date = new Date();
  date.setDate(date.getDate() + 2);
  const resolved = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  mount(
    { body: "Proposed note", active: false, remindOn: resolved },
    {
      ...pkg,
      actions: {
        add: {
          ...pkg.actions.add,
          defaults: { active: false, remindOn: "$today+2" },
        },
      },
    },
  );
  expect(screen.getByText("More options").closest("details")!.open).toBe(false);
});

test("optional values can be reviewed and edited explicitly before confirmation", async () => {
  const invoke = vi.spyOn(miniApps, "invoke").mockResolvedValue({
    records: [
      {
        id: "note",
        revision: 1,
        fields: { body: "A note", active: true, remindOn: "2030-01-05" },
      },
    ],
    confirmation: "reviewed",
  });
  mount();
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Body" }), "A note");
  await user.click(screen.getByText("More options"));
  await user.click(screen.getByRole("checkbox", { name: "Active" }));
  const date = screen.getByLabelText("Remind On");
  await user.clear(date);
  await user.type(date, "2030-01-05");
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  await screen.findByRole("button", { name: "Confirm changes" });
  expect(invoke).toHaveBeenCalledWith(
    "book",
    expect.objectContaining({
      inputs: { body: "A note", active: true, remindOn: "2030-01-05" },
    }),
  );
  expect(screen.getByText("Record details").closest("details")!.open).toBe(
    true,
  );
});
