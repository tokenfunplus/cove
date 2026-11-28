// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppPackage } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { LocalServiceError } from "@/api/client";
import { AppPractice } from "./AppPractice";
import { AppView } from "./AppWorkspace";
const pkg = {
  format: 1,
  publisher: "test",
  app: "study",
  name: "Study",
  version: "1.0.0",
  schema_version: 1,
  capabilities: ["records.query", "records.commit"],
  collections: {
    questions: {
      fields: { question: "text", answer: "text", mastered: "bool" },
    },
  },
} satisfies Omit<MiniAppPackage, "pages" | "actions">;
const practice = {
  query: "due",
  front: "question",
  back: "answer",
  outcomes: ["learn"],
};
const record = {
  id: "one",
  revision: 2,
  fields: {
    question: "First question",
    answer: "Hidden answer",
    mastered: false,
  },
};
const book: MiniAppPackage = {
  ...pkg,
  pages: [{ id: "home", title: "Daily practice", actions: ["due"], practice }],
  actions: {
    due: {
      op: "query",
      title: "Due cards",
      collection: "questions",
      inputs: {},
      surfaces: ["page"],
    },
    learn: {
      op: "update",
      title: "Mark learned",
      collection: "questions",
      inputs: {},
      surfaces: ["page"],
    },
  },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(children: React.ReactNode) {
  return render(
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
      {children}
    </QueryClientProvider>,
  );
}
test("reveals the answer, previews only changes, and retries the same confirmation before advancing", async () => {
  const invoke = vi
    .spyOn(miniApps, "invoke")
    .mockResolvedValueOnce({
      confirmation: "signed",
      records: [{ ...record, fields: { ...record.fields, mastered: true } }],
    })
    .mockRejectedValueOnce(new Error("Temporary save failure"))
    .mockResolvedValueOnce({ records: [] });
  const changed = vi.fn();
  const finish = vi.fn();
  mount(
    <AppPractice
      instance="book"
      revision={1}
      allowReading={false}
      pkg={book}
      practice={practice}
      records={[record]}
      finish={finish}
      changed={changed}
    />,
  );
  expect(screen.queryByText("Hidden answer")).toBeNull();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText("Hidden answer")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Mark learned" }));
  await screen.findByRole("button", { name: "Confirm change" });
  expect(screen.getAllByText("First question")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Confirm change" }));
  await screen.findByText("Temporary save failure");
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByText("Card 1 of 1")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Confirm change" }));
  await screen.findByText("Practice complete");
  const signedCommand = { ...invoke.mock.calls[0][1], confirm: "signed" };
  expect(invoke.mock.calls[1]).toEqual(["book", signedCommand]);
  expect(invoke.mock.calls[2]).toEqual(["book", signedCommand]);
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("1");
  await user.click(screen.getByRole("button", { name: "Return to book" }));
  expect(finish).toHaveBeenCalledOnce();
});

test("a revision conflict offers a refreshed queue without changing the reviewed command", async () => {
  const invoke = vi.spyOn(miniApps, "invoke")
    .mockResolvedValueOnce({ confirmation: "signed", records: [{ ...record, fields: { ...record.fields, mastered: true } }] })
    .mockRejectedValueOnce(new LocalServiceError({ error: { code: "conflict", message: "The card changed. Refresh before trying again.", details: null, request_id: "test" } }));
  const changed = vi.fn();
  const finish = vi.fn();
  mount(<AppPractice instance="book" revision={1} allowReading={false} pkg={book} practice={practice} records={[record]} finish={finish} changed={changed} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  await user.click(screen.getByRole("button", { name: "Mark learned" }));
  await user.click(await screen.findByRole("button", { name: "Confirm change" }));
  await user.click(await screen.findByRole("button", { name: "Return to refreshed queue" }));
  expect(changed).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[1][1]).toMatchObject({ confirm: "signed", records: [{ id: "one", revision: 2 }] });
});
test("empty review queue shows a useful next step without a practice button", async () => {
  vi.spyOn(miniApps, "invoke").mockResolvedValue({ records: [] });
  mount(
    <AppView
      instance={{
        id: "book",
        name: "Book",
        release_id: "release",
        revision: 1,
        enabled: true,
        grants: ["records.query", "records.commit"],
      }}
      pkg={book}
      page={book.pages[0]}
      surface="page"
      attach={vi.fn()}
    />,
  );
  await screen.findByText(/You’re all caught up/);
  expect(screen.queryByRole("button", { name: /Start practice/ })).toBeNull();
});

test("practice uses the current search results when earlier selections are hidden", async () => {
  const other = {
    ...record,
    id: "two",
    fields: { ...record.fields, question: "Second question" },
  };
  vi.spyOn(miniApps, "invoke").mockImplementation(async (_, command) => ({
    records: command.search === "Second" ? [other] : [record],
  }));
  mount(
    <AppView
      instance={{
        id: "book",
        name: "Book",
        release_id: "release",
        revision: 1,
        enabled: true,
        grants: ["records.query", "records.commit"],
      }}
      pkg={book}
      page={book.pages[0]}
      surface="page"
      attach={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Select record 1"));
  await user.type(
    screen.getByRole("searchbox", { name: "Filter records" }),
    "Second",
  );
  await screen.findByText("Second question");
  expect(screen.queryByText("First question")).toBeNull();
  await user.click(
    await screen.findByRole("button", { name: "Start practice (1)" }),
  );
  expect(screen.getByRole("dialog").textContent).toContain("Second question");
  expect(screen.getByRole("dialog").textContent).not.toContain(
    "First question",
  );
});
test("a paginated queue labels the loaded session honestly and keeps practice read-only without a write grant", async () => {
  vi.spyOn(miniApps, "invoke").mockResolvedValue({
    records: [record],
    next_cursor: "more",
  });
  mount(
    <AppView
      instance={{
        id: "book",
        name: "Book",
        release_id: "release",
        revision: 1,
        enabled: true,
        grants: ["records.query"],
      }}
      pkg={book}
      page={book.pages[0]}
      surface="page"
      attach={vi.fn()}
    />,
  );
  await screen.findByText(/1\+ cards ready/);
  expect(
    (
      screen.getByRole("button", {
        name: "Start practice (1)",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await waitFor(() =>
    expect(
      screen.getByText(/This session uses the loaded cards/),
    ).toBeDefined(),
  );
});

test("opens a question in a dialog and binds its write action without requiring checkbox selection", async () => {
  const invoke = vi
    .spyOn(miniApps, "invoke")
    .mockResolvedValue({ records: [record] });
  const page = { ...book.pages[0], actions: ["due", "learn"] };
  mount(
    <AppView
      instance={{
        id: "book",
        name: "Book",
        release_id: "release",
        revision: 1,
        enabled: true,
        grants: ["records.query", "records.commit"],
      }}
      pkg={book}
      page={page}
      surface="page"
      attach={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /First question/ }),
  );
  await screen.findByRole("dialog", { name: "Question details" });
  await user.click(screen.getByRole("button", { name: "Mark learned" }));
  await screen.findByRole("dialog", { name: "Mark learned" });
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "book",
      expect.objectContaining({
        action: "learn",
        records: [{ id: "one", revision: 2 }],
      }),
    ),
  );
});
