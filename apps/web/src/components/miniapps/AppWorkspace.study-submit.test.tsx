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
const record = {
  id: "a",
  revision: 1,
  fields: { question: "Original question", answer: "Original answer" },
};
const pkg: MiniAppPackage = {
  format: 1,
  publisher: "author",
  app: "study",
  name: "Study",
  version: "1.0.0",
  schema_version: 1,
  capabilities: ["records.query", "records.commit"],
  collections: { cards: { fields: { question: "text", answer: "text" } } },
  pages: [
    {
      id: "home",
      title: "Review",
      actions: ["due", "add"],
      practice: {
        query: "due",
        front: "question",
        back: "answer",
        outcomes: ["learn"],
      },
    },
  ],
  actions: {
    due: {
      op: "query",
      title: "Due cards",
      collection: "cards",
      surfaces: ["page"],
    },
    add: {
      op: "create",
      title: "Add card",
      collection: "cards",
      inputs: { question: "text", answer: "text" },
      values: { question: "$input.question", answer: "$input.answer" },
      surfaces: ["page"],
    },
    learn: {
      op: "update",
      title: "Learned",
      collection: "cards",
      surfaces: ["page"],
    },
  },
};
function mount() {
  return render(
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
          name: "Study",
          release_id: "r",
          enabled: true,
          revision: 1,
          grants: pkg.capabilities,
        }}
        pkg={pkg}
        page={pkg.pages[0]}
        surface="page"
        attach={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
test("a study write keeps its dialog open until confirmation is saved", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(miniApps, "invoke").mockImplementation(async (_, command) => {
    if (command.action === "due") return { records: [record] };
    if (command.confirm) {
      await pending;
      return { records: [{ ...record, id: "new" }] };
    }
    return { records: [record], confirmation: "signed" };
  });
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Add card" }));
  await user.type(
    screen.getByRole("textbox", { name: "Question" }),
    "New question",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Answer" }),
    "New answer",
  );
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  await user.click(
    await screen.findByRole("button", { name: "Confirm changes" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Close dialog",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true),
  );
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Add card" })).toBeTruthy();
  await act(async () => {
    finish();
    await pending;
  });
  await screen.findByText("Saved 1 record to Study.");
  expect(screen.queryByRole("dialog", { name: "Add card" })).toBeNull();
});
test("practice's own record refresh does not report an unexpected stale selection", async () => {
  let revision = 1;
  vi.spyOn(miniApps, "invoke").mockImplementation(async (_, command) => {
    if (command.action === "due") return { records: [{ ...record, revision }] };
    if (command.confirm) {
      revision++;
      return { records: [{ ...record, revision }] };
    }
    return { records: [record], confirmation: "signed" };
  });
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Select record 1"));
  await user.click(screen.getByRole("button", { name: "Start practice (1)" }));
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  await user.click(screen.getByRole("button", { name: "Learned" }));
  await user.click(
    await screen.findByRole("button", { name: "Confirm change" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Return to book" }),
  );
  expect(screen.queryByText(/Some selected items changed/)).toBeNull();
  expect(
    (screen.getByLabelText("Select record 1") as HTMLInputElement).checked,
  ).toBe(false);
});
