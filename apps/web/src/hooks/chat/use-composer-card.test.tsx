// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  parseCard,
  type ConversationView,
  type CardRun,
} from "@cove/api-contract";
import fixtures from "../../../../../packages/api-contract/fixtures/interactive-cards.json";
import { useComposerCard } from "./use-composer-card";
import { useInteractiveCard } from "./use-interactive-card";
import { prepareComposerCard } from "@/lib/chat/interactive-context";
import * as api from "@/api/interactive";
vi.mock("@/api/interactive", () => ({
  loadInteractiveCard: vi.fn(),
  saveInteractiveCard: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const definition = parseCard(fixtures.valid[0].source);
const view = {
  id: "conversation",
  messages: [
    {
      id: "answer",
      body: "```cove-card-v1\n" + fixtures.valid[0].source + "\n```",
    },
  ],
  generation_batches: [
    {
      id: "batch",
      created_at: "2026-01-01",
      interactive: true,
      targets: [{}],
      selected_answer: { generation_id: "gen", assistant_message_id: "answer" },
    },
  ],
} as unknown as ConversationView;
function setup() {
  let saved: CardRun = {
    generation_id: "gen",
    definition,
    values: { next_action: "" },
    checks: {},
    revision: 0,
    can_continue: true,
  };
  vi.mocked(api.loadInteractiveCard).mockImplementation(async () =>
    structuredClone(saved),
  );
  vi.mocked(api.saveInteractiveCard).mockImplementation(async (input) => {
    saved = {
      ...saved,
      values: input.values,
      checks: input.checks,
      revision: saved.revision + 1,
    };
    return structuredClone(saved);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}
test("an opt-in reference flushes current edits and can be removed or restored", async () => {
  const { wrapper } = setup();
  const { result } = renderHook(
    () => ({
      reference: useComposerCard(view, true),
      card: useInteractiveCard("gen"),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.reference?.included).toBe(false));
  act(() => result.current.reference?.toggle(true));
  act(() => result.current.card.edit({ next_action: "radio" }, {}));
  let reference: Awaited<ReturnType<typeof prepareComposerCard>>;
  await act(async () => {
    reference = await prepareComposerCard(view.id);
  });
  expect(reference).toMatchObject({
    intent: "discuss",
    generation_id: "gen",
    revision: 1,
    values: { next_action: "radio" },
  });
  expect(result.current.card.preparing).toBe(true);
  await act(async () => {
    (reference as { release?: () => void })?.release?.();
  });
  expect(result.current.card.preparing).toBe(false);
  act(() => result.current.reference?.toggle(false));
  expect(await prepareComposerCard(view.id)).toBeUndefined();
  act(() => result.current.reference?.toggle(true));
  expect(await prepareComposerCard(view.id)).toMatchObject({
    intent: "discuss",
  });
});
test("failed saves block reference preparation while preserving the draft", async () => {
  const { wrapper } = setup();
  const { result } = renderHook(
    () => ({
      reference: useComposerCard(view, true),
      card: useInteractiveCard("gen"),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.reference?.included).toBe(false));
  act(() => result.current.reference?.toggle(true));
  vi.mocked(api.saveInteractiveCard).mockRejectedValue(
    new Error("Save failed"),
  );
  act(() => result.current.card.edit({ next_action: "radio" }, {}));
  await expect(prepareComposerCard(view.id)).rejects.toThrow("Save failed");
  expect(result.current.card.draft?.values.next_action).toBe("radio");
});
test("comparisons and later ordinary turns do not inherit a reference", async () => {
  const { wrapper } = setup();
  const { result, rerender } = renderHook(
    ({ enabled, current }) => useComposerCard(current, enabled),
    { wrapper, initialProps: { enabled: false, current: view } },
  );
  expect(result.current).toBeUndefined();
  rerender({ enabled: true, current: view });
  await waitFor(() => expect(result.current?.included).toBe(false));
  rerender({
    enabled: true,
    current: {
      ...view,
      generation_batches: [
        ...view.generation_batches!,
        {
          id: "later",
          created_at: "2026-01-02",
          interactive: true,
          targets: [{}],
        } as never,
      ],
    },
  });
  await waitFor(() => expect(result.current).toBeUndefined());
  expect(await prepareComposerCard(view.id)).toBeUndefined();
});
