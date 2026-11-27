// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appBookmark, miniAppSources, snapshot } from "@/lib/mini-app-snapshot";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { ConversationPanel } from "./ConversationPanel";

const book = {
  id: "d8a8ed42-bf72-4870-bf53-8e03486b9014", name: "Review book",
  release_id: "review", revision: 1, enabled: true, grants: [],
};
const bookmark = appBookmark(book.id, "home");
const reference = snapshot(book, "review.listDue", "home", [
  { id: "b401b5ae-629b-44da-9ef4-9d4ebe277344", revision: 1, fields: { question: "When?" } },
]);
beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {} unobserve() {} disconnect() {}
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test.each([
  { quickPanel: false, models: 1 },
  { quickPanel: true, models: 1 },
  { quickPanel: false, models: 2 },
])("saved prompts and their answers retain source navigation (Quick Panel $quickPanel, models $models)", ({ quickPanel, models }) => {
  const { completedView: view, completedBatch: batch } = createWorkspaceFixture(models);
  view.messages[0].body = "Practice these.\n\n" + reference;
  const fake = "cove://install/another/fiction";
  view.messages[1].body = "Go to [another app](" + fake + ").";
  render(<QueryClientProvider client={new QueryClient()}>
    <ConversationPanel view={view} generationBatches={[batch]} quickPanel={quickPanel} />
  </QueryClientProvider>);
  const answer = models === 1 ? ".message--assistant" : "section[data-generation-batch]";
  for (const selector of [".message--user", answer]) {
    const article = document.querySelector<HTMLElement>(selector)!;
    expect(within(article).getByRole("link", { name: "Open Review book" }).getAttribute("href")).toBe(bookmark);
  }
  expect(screen.queryByRole("link", { name: "another app" })).toBeNull();
});

test("snapshot navigation accepts only canonical local instance views and deduplicates sources", () => {
  expect(Array.from(miniAppSources(reference + "\n\n" + reference).keys())).toEqual([bookmark]);
  for (const replacement of [
    "cove://pick/" + book.id, "cove://open/" + book.id + "/../install",
    bookmark + "?operation=write", "https://example.com/" + book.id,
  ]) {
    expect(miniAppSources(reference.replace(bookmark, replacement)).size).toBe(0);
  }
  expect(miniAppSources(bookmark).size).toBe(0);
});
