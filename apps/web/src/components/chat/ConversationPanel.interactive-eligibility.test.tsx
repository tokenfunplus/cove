// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { ConversationPanel } from "./ConversationPanel";
vi.mock("@/components/interactive/InteractiveAnswer", () => ({
  InteractiveAnswer: ({ onContinue }: { onContinue?: unknown }) => (
    <button disabled={!onContinue}>Card continuation</button>
  ),
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("a cached card cannot continue in archives or after an ordinary batch is accepted", () => {
  const fixture = createWorkspaceFixture();
  const card = {
    ...fixture.completedBatch,
    interactive: true,
    selected_answer: {
      generation_id: fixture.completedBatch.targets[0].generation.id,
      assistant_message_id:
        fixture.completedBatch.targets[0].generation.assistant_message_id!,
      provider_name: fixture.profile.name,
      model_id: fixture.completedBatch.targets[0].model_id,
    },
  };
  const view = { ...fixture.completedView, generation_batches: [card] };
  const client = new QueryClient();
  const onContinue = vi.fn();
  const props = {
    activeModelSet: [
      { providerId: fixture.profile.id, modelId: fixture.profile.model_id },
    ],
    interactive: { enabled: true, onContinue },
  };
  const renderPanel = (archived = false, next = false) => (
    <QueryClientProvider client={client}>
      <ConversationPanel
        {...props}
        generationBatches={[card]}
        view={{ ...view, archived }}
        generationBatch={
          next
            ? {
                ...fixture.pendingBatch,
                id: "later-ordinary",
                interactive: false,
              }
            : undefined
        }
      />
    </QueryClientProvider>
  );
  const { rerender } = render(renderPanel());
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Card continuation" })
      .disabled,
  ).toBe(false);
  rerender(renderPanel(true));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Card continuation" })
      .disabled,
  ).toBe(true);
  rerender(renderPanel(false, true));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Card continuation" })
      .disabled,
  ).toBe(true);
});
