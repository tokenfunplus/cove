// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppPackage } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
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
  expect(invoke.mock.calls[1][1]).toEqual(invoke.mock.calls[2][1]);
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("1");
  await user.click(screen.getByRole("button", { name: "Return to book" }));
  expect(finish).toHaveBeenCalledOnce();
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
