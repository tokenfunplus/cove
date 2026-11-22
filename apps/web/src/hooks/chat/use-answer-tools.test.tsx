// @vitest-environment jsdom
import * as api from "@/api";
import { AnswerToolsPanel } from "@/components/chat/AnswerToolsPanel";
import { useAnswerTools } from "@/hooks/chat/use-answer-tools";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { englishConversationCopy } from "@/messages";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import type { ConversationView, GenerationBatch } from "@cove/api-contract";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/api", async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  getConversations: vi.fn(),
  createGenerationBatch: vi.fn(),
  subscribeGenerationBatch: vi.fn(),
  getGenerationBatch: vi.fn(),
  cancelGenerationBatch: vi.fn(),
}));

let fixture = createWorkspaceFixture();
let cache: QueryClient;
let view: ConversationView;
let batch: GenerationBatch;
const source = {
  messageId: "original-answer",
  conversationId: "original-conversation",
  body: "Before quoted passage after. Other private context.",
};

beforeEach(() => {
  vi.resetAllMocks();
  fixture = createWorkspaceFixture();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  view = {
    ...fixture.secondConversation,
    messages: [],
    generation_batches: [],
  };
  batch = { ...fixture.pendingBatch, conversation_id: view.id };
  vi.mocked(api.createConversation).mockResolvedValue(view);
  vi.mocked(api.getConversations).mockResolvedValue([
    fixture.conversation,
    view,
  ]);
  vi.mocked(api.getConversation).mockImplementation(async () => view);
  vi.mocked(api.createGenerationBatch).mockImplementation(async () => batch);
  vi.mocked(api.getGenerationBatch).mockImplementation(async () => batch);
  vi.mocked(api.subscribeGenerationBatch).mockImplementation(
    async function* () {
      batch = {
        ...batch,
        state: "completed",
        targets: batch.targets.map((target) => ({
          ...target,
          generation: {
            ...target.generation,
            state: "completed",
            assistant_message_id: "side-answer",
          },
        })),
      };
      view = {
        ...view,
        messages: [
          {
            id: "side-answer",
            conversation_id: view.id,
            generation_batch_id: batch.id,
            role: "assistant",
            body: "clear wording",
            provider_snapshot:
              fixture.pendingBatch.targets[0].generation.snapshot,
            created_at: view.created_at,
          },
        ],
        generation_batches: [batch],
      };
      yield {
        event_id: "1",
        batch_id: batch.id,
        generation_id: batch.targets[0].generation.id,
        target_id: batch.targets[0].id,
        type: "completed",
      };
    },
  );
});
afterEach(() => {
  cleanup();
  cache.clear();
});

function mount() {
  return renderHook(
    () =>
      useAnswerTools({
        activeModelSet: [
          { providerId: fixture.profile.id, modelId: "model-one" },
        ],
        providerProfiles: [fixture.profile],
        catalogs: {
          [fixture.profile.id]: { status: "ready", models: ["model-one"] },
        },
        selectionStatus: "ready",
        copy: englishConversationCopy,
        externalBusy: false,
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      ),
    },
  );
}

test("quoted follow-ups use a separate conversation and send only the chosen passage", async () => {
  const { result } = mount();
  act(() => result.current.openAsk(source, "quoted passage", "Explain"));
  expect(api.createConversation).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.sendQuestion();
  });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(api.createConversation).toHaveBeenCalledWith(expect.any(String), { title: expect.any(String), source_conversation_id: source.conversationId });
  expect(api.createGenerationBatch).toHaveBeenCalledWith(
    view.id,
    expect.objectContaining({
      body: expect.stringContaining('"passage":"quoted passage"'),
    }),
  );
  expect(
    vi.mocked(api.createGenerationBatch).mock.calls[0][1].body,
  ).not.toContain("Other private context");
  expect(fixture.conversation.messages).toEqual([]);
  expect(result.current.sideConversation?.messages[0].body).toBe(
    "clear wording",
  );
});

test("selection revisions are reviewed before applying and can be undone without changing the source", async () => {
  const { result } = mount();
  act(() => result.current.openEditor(source));
  act(() => {
    result.current.setRevisionInstruction("Simplify");
    result.current.setRevisionRange({ start: 7, end: 21 });
  });
  await act(async () => {
    await result.current.requestRevision();
  });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(api.createConversation).toHaveBeenCalledWith(expect.any(String), { title: expect.any(String), source_conversation_id: source.conversationId });
  expect(result.current.history.content).toBe(source.body);
  act(() => result.current.setCandidate("clear wording"));
  act(() => result.current.applyCandidate());
  expect(result.current.history.content).toBe(
    "Before clear wording after. Other private context.",
  );
  act(() => result.current.dispatch({ type: "undo" }));
  expect(result.current.history.content).toBe(source.body);
  expect(source.body).toContain("quoted passage");
});

test("a stale revision cannot replace edits made since its request", async () => {
  const { result } = mount();
  act(() => result.current.openEditor(source));
  act(() => result.current.setRevisionInstruction("Simplify"));
  await act(async () => {
    await result.current.requestRevision();
  });
  act(() =>
    result.current.dispatch({ type: "edit", content: "Newer local edits" }),
  );
  act(() => result.current.setCandidate("old revision"));
  act(() => result.current.applyCandidate());
  expect(result.current.history.content).toBe("Newer local edits");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});


test("replacing a source protects an unsent revision instruction even without draft edits", () => {
  const { result } = mount();
  act(() => result.current.openEditor(source));
  act(() => result.current.setRevisionInstruction("Unsent changes"));
  const next = { ...source, messageId: "another-answer", body: "Another answer" };
  act(() => result.current.openEditor(next));
  expect(result.current.replacement?.source).toEqual(next);
  expect(result.current.documentSource).toEqual(source);
  expect(result.current.revisionInstruction).toBe("Unsent changes");
  act(() => result.current.confirmReplacement());
  expect(result.current.documentSource).toEqual(next);
  expect(result.current.revisionInstruction).toBe("");
});

test("content changes invalidate the current selection but preserve a submitted revision range", async () => {
  const { result } = mount();
  act(() => result.current.openEditor({ ...source, body: "alpha beta gamma" }));
  act(() => result.current.dispatch({ type: "edit", content: "prefix alpha beta gamma" }));
  act(() => {
    result.current.setRevisionInstruction("Simplify");
    result.current.setRevisionRange({ start: 13, end: 17 });
  });
  await act(async () => { await result.current.requestRevision(); });
  act(() => result.current.dispatch({ type: "undo" }));
  expect(result.current.history.content).toBe("alpha beta gamma");
  expect(result.current.revisionRange).toBeUndefined();
  expect(result.current.revisionTask?.range).toEqual({ start: 13, end: 17 });
  act(() => result.current.setRevisionRange({ start: 6, end: 10 }));
  act(() => result.current.dispatch({ type: "redo" }));
  expect(result.current.revisionRange).toBeUndefined();
  act(() => result.current.setRevisionRange({ start: 13, end: 17 }));
  act(() => result.current.dispatch({ type: "edit", content: "Changed" }));
  expect(result.current.revisionRange).toBeUndefined();
});


test.each(["failed", "stopped"] as const)("a %s revision remains visible after settlement without a saved answer", async phase => {
  vi.mocked(api.subscribeGenerationBatch).mockImplementation(async function* () {
    batch = { ...batch, state: phase, targets: batch.targets.map(target => ({ ...target,
      generation: { ...target.generation, state: phase, error: phase === "failed" ? { code: "provider_unavailable", message: "Unavailable" } : undefined },
    })) };
    view = { ...view, messages: [], generation_batches: [batch] };
  });
  const { result } = mount();
  act(() => result.current.openEditor(source));
  act(() => result.current.setRevisionInstruction("Simplify"));
  await act(async () => { await result.current.requestRevision(); });
  await waitFor(() => expect(result.current.busy).toBe(false));
  const { container } = render(<AnswerToolsPanel tools={result.current} />);
  expect(container.querySelector(`.model-answer-card--${phase}`)).toBeTruthy();
  expect(container.textContent).not.toContain("Preparing revision");
});


test("a completed revision represented in saved history does not duplicate its live card", async () => {
  const { result } = mount();
  act(() => result.current.openEditor(source));
  act(() => result.current.setRevisionInstruction("Simplify"));
  await act(async () => { await result.current.requestRevision(); });
  await waitFor(() => expect(result.current.sideConversation?.messages).toHaveLength(1));
  const { container } = render(<AnswerToolsPanel tools={result.current} />);
  expect(container.querySelectorAll(".model-answer-card--completed")).toHaveLength(1);
});

test("unchanged draft actions preserve the current selection", () => {
  const { result } = mount();
  act(() => result.current.openEditor(source));
  act(() => result.current.setRevisionRange({ start: 7, end: 21 }));
  act(() => result.current.dispatch({ type: "edit", content: source.body }));
  act(() => result.current.dispatch({ type: "checkpoint" }));
  expect(result.current.revisionRange).toEqual({ start: 7, end: 21 });
});
