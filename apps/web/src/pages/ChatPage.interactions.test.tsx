// @vitest-environment jsdom

import * as transport from "@/api";
import { conversationKeys } from "@/api/queryKeys";
import { App } from "@/App";
import { WorkspaceToast } from "@/components/layout/WorkspaceToast";
import type { SecureInferenceEvent } from "@/lib/inference/secure-inference";
import {
  createBatchEventFeed,
  createWorkspaceFixture,
} from "@/test/workspace-fixture";
import type { Generation, ProviderModelPrivacyMode } from "@cove/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const privateInference = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock("@/lib/inference/secure-inference", () => ({
  createSecureInferenceTransport: () => ({
    generate: privateInference.generate,
  }),
}));

vi.mock("@/api", async (importOriginal) => {
  const original = await importOriginal<typeof transport>();
  return {
    ...original,
    getSession: vi.fn(),
    getConversations: vi.fn(),
    searchConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    getProviderProfiles: vi.fn(),
    getProviderCatalog: vi.fn(),
    getSettings: vi.fn(),
    createGenerationBatch: vi.fn(),
    subscribeGenerationBatch: vi.fn(),
    getGenerationBatch: vi.fn(),
    getGenerationBatchContext: vi.fn(),
    previewAttachment: vi.fn(),
    previewGenerationContext: vi.fn(),
    cancelGeneration: vi.fn(),
    cancelGenerationBatch: vi.fn(),
    retryGenerationTarget: vi.fn(),
    selectGenerationAnswer: vi.fn(),
    skipGenerationBatchContext: vi.fn(),
    clearChatData: vi.fn(),
    updateSettings: vi.fn(),
    markSecureGenerationEnvironment: vi.fn(),
    markSecureGenerationStreaming: vi.fn(),
    markSecureGenerationResponseVerification: vi.fn(),
    settleSecureGeneration: vi.fn(),
  };
});

let fixture: ReturnType<typeof createWorkspaceFixture>;
let feed: ReturnType<typeof createBatchEventFeed>;
let queryClient: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((media: string) => ({
      media,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // An unexpected real request must fail before it can leave the test process.
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(
        new Error("Unexpected network request in workspace test"),
      ),
  );
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  configureWorkspace();
});

afterEach(() => {
  cleanup();
  feed.close();
  queryClient.clear();
  vi.unstubAllGlobals();
});

function configureWorkspace(targetCount = 1) {
  feed?.close();
  fixture = createWorkspaceFixture(targetCount);
  feed = createBatchEventFeed(fixture.pendingBatch);
  vi.mocked(transport.getSession).mockResolvedValue({
    csrf_token: "synthetic-session",
  });
  vi.mocked(transport.getConversations).mockResolvedValue([
    fixture.conversation,
    fixture.secondConversation,
  ]);
  vi.mocked(transport.searchConversations).mockResolvedValue([]);
  vi.mocked(transport.createConversation).mockResolvedValue({ ...fixture.secondConversation, id: "created-conversation" });
  vi.mocked(transport.getConversation).mockImplementation(async (id) =>
    id === fixture.secondConversation.id
      ? fixture.secondConversation
      : fixture.conversation,
  );
  vi.mocked(transport.getProviderProfiles).mockResolvedValue([fixture.profile]);
  vi.mocked(transport.getProviderCatalog).mockResolvedValue({
    models: fixture.models,
  });
  vi.mocked(transport.getSettings).mockResolvedValue(fixture.settings);
  vi.mocked(transport.createGenerationBatch).mockResolvedValue(
    fixture.pendingBatch,
  );
  vi.mocked(transport.subscribeGenerationBatch).mockImplementation(() =>
    feed.events(),
  );
  vi.mocked(transport.getGenerationBatch).mockResolvedValue(
    fixture.completedBatch,
  );
  vi.mocked(transport.getGenerationBatchContext).mockResolvedValue([]);
}

function configureNearAITarget(
  targetIndex: number,
  mode: ProviderModelPrivacyMode,
) {
  const nearAI = {
    ...fixture.profile,
    id: "nearai",
    kind: "nearai" as const,
    endpoint: "https://cloud-stg-api.near.ai",
  };
  for (const batch of [fixture.pendingBatch, fixture.completedBatch]) {
    const target = batch.targets[targetIndex]!;
    target.provider_id = nearAI.id;
    Object.assign(target.generation.snapshot, {
      provider_id: nearAI.id,
      provider_kind: nearAI.kind,
      privacy_mode: mode,
    });
  }
  fixture.settings.active_model_set[targetIndex]!.provider_id = nearAI.id;
  vi.mocked(transport.getProviderProfiles).mockResolvedValue([
    fixture.profile,
    nearAI,
  ]);
  vi.mocked(transport.getProviderCatalog).mockImplementation(async (id) => ({
    models: fixture.models,
    model_metadata:
      id === nearAI.id
        ? fixture.models.map((model) => ({
            id: model,
            privacy_mode: mode,
            verifiable: mode === "private_tee",
          }))
        : [],
  }));
  const generation: Generation = {
    ...fixture.completedBatch.targets[targetIndex]!.generation,
    conversation_id: fixture.conversation.id,
    client_request_id: fixture.pendingBatch.client_request_id,
    events_url: "/unused-test-stream",
    created_at: fixture.pendingBatch.created_at,
    updated_at: fixture.pendingBatch.updated_at,
    verification: {
      status: mode === "private_tee" ? "verified_model" : "verified_gateway",
    },
  };
  vi.mocked(transport.markSecureGenerationEnvironment).mockResolvedValue({
    ...generation,
    state: "verifying_environment",
  });
  vi.mocked(transport.markSecureGenerationStreaming).mockResolvedValue({
    ...generation,
    state: "streaming",
  });
  vi.mocked(
    transport.markSecureGenerationResponseVerification,
  ).mockResolvedValue({ ...generation, state: "verifying_response" });
  vi.mocked(transport.settleSecureGeneration).mockImplementation(async () => {
    vi.mocked(transport.getConversation).mockResolvedValue(
      fixture.completedView,
    );
    return generation;
  });
  privateInference.generate.mockImplementation(
    async function* (): AsyncGenerator<SecureInferenceEvent> {
      yield { type: "verifying_environment" };
      yield { type: "streaming" };
      yield { type: "delta", delta: "Synthetic private answer" };
      yield { type: "response_ready", completionId: "synthetic-completion" };
      yield {
        type: "completed",
        verification: {
          status:
            mode === "private_tee" ? "verified_model" : "verified_gateway",
          signingKind: mode === "private_tee" ? "provider_tee" : "gateway",
          completionId: "synthetic-completion",
          signingAddress: "synthetic-signer",
          signingAlgorithm: "ed25519",
          signature: "synthetic-signature",
        },
      };
    },
  );
  return generation;
}

async function openWorkspace() {
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  const composer = await screen.findByRole("textbox", { name: "Send message" });
  await waitFor(() => expect(transport.getProviderCatalog).toHaveBeenCalled());
  return { composer, user: userEvent.setup() };
}

async function sendPrompt() {
  const workspace = await openWorkspace();
  await workspace.user.type(workspace.composer, "A test prompt");
  await workspace.user.click(
    screen.getByRole("button", { name: "Send message" }),
  );
  await waitFor(() =>
    expect(transport.subscribeGenerationBatch).toHaveBeenCalledWith(
      fixture.pendingBatch.id,
    ),
  );
  return workspace;
}

test("staying on a conversation preserves unsent text and attachments; discarding completes a switch", async () => {
  vi.mocked(transport.previewAttachment).mockResolvedValue({
    id: "f".repeat(64), name: "draft.md", media_type: "text/plain", size: 6, characters: 6,
    extraction_version: "cove-text-v1", sections: [{ id: "L1", text: "Source" }],
  });
  const { composer, user } = await openWorkspace();
  await user.type(composer, "An unsent prompt\nwith another line");
  await user.upload(screen.getByLabelText("Attach files"), new File(["Source"], "draft.md", { type: "text/markdown" }));
  await screen.findByRole("button", { name: /Preview extracted text/ });
  const selectSecond = () => user.click(within(screen.getByRole("navigation", { name: "Chats" })).getByText("Second chat", { exact: true }));
  await selectSecond();
  let dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Discard unsent draft?")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Stay" }));
  expect((composer as HTMLTextAreaElement).value).toContain("An unsent prompt");
  expect(screen.getByRole("button", { name: "Remove attachment: draft.md" })).toBeTruthy();
  expect(transport.getConversation).not.toHaveBeenCalledWith(fixture.secondConversation.id);
  await selectSecond();
  dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Discard and continue" }));
  await waitFor(() => expect(transport.getConversation).toHaveBeenCalledWith(fixture.secondConversation.id));
  await waitFor(() => expect(document.querySelector(".masthead__title")?.textContent).toBe("Second chat"));
  expect((screen.getByRole("textbox", { name: "Send message" }) as HTMLTextAreaElement).value).toBe("");
  expect(screen.queryByRole("button", { name: "Remove attachment: draft.md" })).toBeNull();
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});

test.each(["surface", "launcher"])("New Chat from the %s protects an unsent draft", async (entry) => {
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Keep this draft");
  if (entry === "surface") await user.click(screen.getByRole("button", { name: "New conversation" }));
  else await act(async () => {
    window.history.replaceState(null, "", "/#new-chat");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  let dialog = await screen.findByRole("dialog");
  expect(transport.createConversation).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Stay" }));
  expect((composer as HTMLTextAreaElement).value).toBe("Keep this draft");
  await user.click(screen.getByRole("button", { name: "New conversation" }));
  dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Discard and continue" }));
  await waitFor(() => expect(transport.createConversation).toHaveBeenCalledTimes(1));
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});

test.each(["switch", "archive", "launcher"])("failed cancellation keeps the current conversation and draft during %s navigation", async (destination) => {
  const { composer, user } = await sendPrompt();
  await user.type(composer, "Keep this next draft");
  vi.mocked(transport.cancelGenerationBatch).mockRejectedValue(new Error("Cancellation failed"));
  if (destination === "launcher") {
    await act(async () => { window.location.hash = "#new-chat"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  } else if (destination === "archive") {
    await user.click(screen.getByRole("button", { name: "Archived chats" }));
  } else {
    await user.click(within(screen.getByRole("navigation", { name: "Chats" })).getByText("Second chat", { exact: true }));
  }
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Discard and continue" }));
  await waitFor(() => expect(transport.cancelGenerationBatch).toHaveBeenCalled());
  await waitFor(() => expect((within(dialog).getByRole("button", { name: "Stay" }) as HTMLButtonElement).disabled).toBe(false));
  expect(document.querySelector(".masthead__title")?.textContent).toBe("First chat");
  expect((composer as HTMLTextAreaElement).value).toBe("Keep this next draft");
  expect(transport.getConversation).not.toHaveBeenCalledWith(fixture.secondConversation.id);
  expect(transport.getConversations).not.toHaveBeenCalledWith({ archived: true });
  expect(transport.createConversation).not.toHaveBeenCalled();
});

test("a failed batch cancellation also blocks switching away from a private run", async () => {
  configureNearAITarget(0, "private_tee");
  privateInference.generate.mockImplementation(async function* (_input: unknown, signal: AbortSignal): AsyncGenerator<SecureInferenceEvent> {
    yield { type: "verifying_environment" };
    yield { type: "streaming" };
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  });
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Private prompt");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(privateInference.generate).toHaveBeenCalled());
  await user.type(composer, "Keep private draft");
  vi.mocked(transport.cancelGenerationBatch).mockRejectedValue(new Error("Cancel failed"));
  await user.click(within(screen.getByRole("navigation", { name: "Chats" })).getByText("Second chat", { exact: true }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Discard and continue" }));
  await waitFor(() => expect(transport.cancelGenerationBatch).toHaveBeenCalled());
  await waitFor(() => expect((within(dialog).getByRole("button", { name: "Stay" }) as HTMLButtonElement).disabled).toBe(false));
  expect(transport.getConversation).not.toHaveBeenCalledWith(fixture.secondConversation.id);
  expect(document.querySelector(".masthead__title")?.textContent).toBe("First chat");
  expect((composer as HTMLTextAreaElement).value).toBe("Keep private draft");
});

test.each(["empty", "draft", "failed"])("New Chat protects editing while %s creation is pending", async (scenario) => {
  const created = { ...fixture.secondConversation, id: "created-chat", title: "Created chat" };
  let complete!: (conversation: typeof created) => void;
  let fail!: (error: Error) => void;
  vi.mocked(transport.createConversation).mockReturnValue(new Promise((resolve, reject) => { complete = resolve; fail = reject; }));
  vi.mocked(transport.getConversation).mockImplementation(async (id) => id === created.id ? created : fixture.conversation);
  const { composer, user } = await openWorkspace();
  if (scenario !== "empty") await user.type(composer, "Approved draft");
  await user.click(screen.getByRole("button", { name: "New conversation" }));
  if (scenario !== "empty") {
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Discard and continue" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
  }
  await waitFor(() => expect(transport.createConversation).toHaveBeenCalledTimes(1));
  expect((composer as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByLabelText("Attach files") as HTMLInputElement).disabled).toBe(true);
  await user.type(composer, "Unapproved edit");
  expect((composer as HTMLTextAreaElement).value).toBe(scenario === "empty" ? "" : "Approved draft");
  await act(async () => { if (scenario === "failed") fail(new Error("Create failed")); else complete(created); });
  if (scenario === "failed") {
    await waitFor(() => expect((composer as HTMLTextAreaElement).disabled).toBe(false));
    expect((composer as HTMLTextAreaElement).value).toBe("Approved draft");
    expect(document.querySelector(".masthead__title")?.textContent).toBe("First chat");
  } else {
    await waitFor(() => expect(document.querySelector(".masthead__title")?.textContent).toBe("Created chat"));
    expect((screen.getByRole("textbox", { name: "Send message" }) as HTMLTextAreaElement).value).toBe("");
  }
});

test("an empty draft switches immediately, and body search opens its matching conversation", async () => {
  vi.mocked(transport.searchConversations).mockResolvedValue([
    { ...fixture.secondConversation, message_id: "matching-message", role: "assistant", excerpt: "SQLite migration checklist" },
  ]);
  const { user } = await openWorkspace();
  await user.type(screen.getByRole("textbox", { name: "Search conversations" }), "SQLite migration checklist");
  const result = await screen.findByRole("button", { name: /Second chat.*SQLite migration checklist/ });
  await user.click(result);
  await waitFor(() => expect(transport.getConversation).toHaveBeenCalledWith(fixture.secondConversation.id));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(transport.searchConversations).toHaveBeenCalledWith("SQLite migration checklist", false, expect.any(AbortSignal));
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});

test("an attachment-only draft is protected while its local preview is pending", async () => {
  vi.mocked(transport.previewAttachment).mockReturnValue(new Promise(() => {}));
  const { user } = await openWorkspace();
  await user.upload(screen.getByLabelText("Attach files"), new File(["Source"], "pending.md", { type: "text/markdown" }));
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "New conversation" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Stay" }));
  expect(screen.getByRole("button", { name: "Remove attachment: pending.md" })).toBeTruthy();
  expect(transport.createConversation).not.toHaveBeenCalled();
});

test("changing the archive filter also asks before discarding a draft", async () => {
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Unsent work");
  await user.click(screen.getByRole("button", { name: "Archived chats" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Stay" }));
  expect((composer as HTMLTextAreaElement).value).toBe("Unsent work");
  expect(transport.getConversations).not.toHaveBeenCalledWith({ archived: true });
});

test("archive navigation confirms and waits for an active response to stop", async () => {
  const { user } = await sendPrompt();
  const archived = { ...fixture.secondConversation, title: "Archived chat", archived: true };
  vi.mocked(transport.getConversations).mockImplementation(async (options) => options?.archived ? [archived] : [fixture.conversation]);
  vi.mocked(transport.getConversation).mockImplementation(async (id) => id === archived.id ? archived : fixture.conversation);
  vi.mocked(transport.cancelGenerationBatch).mockImplementation(async () => {
    expect(transport.getConversations).not.toHaveBeenCalledWith({ archived: true });
    feed.close();
    return { ...fixture.pendingBatch, state: "stopped" };
  });
  await user.click(screen.getByRole("button", { name: "Archived chats" }));
  let dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Archived chats" }));
  dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Change chat view" }));
  await waitFor(() => expect(document.querySelector(".masthead__title")?.textContent).toBe("Archived chat"));
  expect(transport.cancelGenerationBatch).toHaveBeenCalledWith(fixture.pendingBatch.id);
});

test("an unchanged search refreshes when a streamed answer is saved", async () => {
  const { user } = await sendPrompt();
  let saved = false;
  vi.mocked(transport.searchConversations).mockImplementation(async () => saved ? [{
    ...fixture.conversation, excerpt: "Answer from model-one", role: "assistant",
    message_id: fixture.completedBatch.targets[0]!.generation.assistant_message_id,
  }] : []);
  const search = screen.getByRole("textbox", { name: "Search conversations" });
  await user.type(search, "Answer from model-one");
  await screen.findByText("No entries match.");
  saved = true;
  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  await act(async () => { feed.emit(0, "completed"); feed.close(); });
  await screen.findByRole("button", { name: /First chat.*Answer from model-one/ });
  expect((search as HTMLInputElement).value).toBe("Answer from model-one");
  expect(transport.createGenerationBatch).toHaveBeenCalledTimes(1);
});

test("Focus mode preserves the draft and restores the previous sidebar and keyboard focus", async () => {
  const { composer, user } = await openWorkspace();
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  await user.type(composer, "Keep my draft");
  const enter = screen.getByRole("button", { name: "Enter Focus mode" });
  await user.click(enter);
  const surface = screen.getByRole("main");
  expect(surface.getAttribute("data-focus-mode")).toBe("true");
  expect(document.getElementById("conversation-sidebar")?.hidden).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Exit Focus" }));
  expect(screen.getByRole("textbox", { name: "Send message" })).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe("Keep my draft");
  await act(async () => {
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
  });
  expect(surface.getAttribute("data-focus-mode")).toBe("true");
  await user.keyboard("{Escape}");
  expect(surface.hasAttribute("data-focus-mode")).toBe(false);
  expect(document.getElementById("conversation-sidebar")?.hidden).toBe(false);
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  expect(document.activeElement).toBe(enter);
  expect((composer as HTMLTextAreaElement).value).toBe("Keep my draft");
  expect(transport.updateSettings).not.toHaveBeenCalled();
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});

test("Escape closes a Focus context dialog before exiting Focus", async () => {
  vi.mocked(transport.previewGenerationContext).mockResolvedValue([
    { role: "user", content: "Synthetic Focus context" },
  ]);
  const { user } = await openWorkspace();
  await user.click(screen.getByRole("button", { name: "Enter Focus mode" }));
  await user.click(screen.getByRole("button", { name: "Review context" }));
  await screen.findByText("Synthetic Focus context");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("main").getAttribute("data-focus-mode")).toBe("true");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("main").hasAttribute("data-focus-mode")).toBe(false);
});

test("conversation search exits Focus and reveals the search field", async () => {
  const { user } = await openWorkspace();
  await user.click(screen.getByRole("button", { name: "Enter Focus mode" }));
  await user.keyboard("{Control>}k{/Control}");
  await waitFor(() => expect(screen.getByRole("main").hasAttribute("data-focus-mode")).toBe(false));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search conversations" })));
});

test("Focus transitions leave an active stream and its stop control intact", async () => {
  const { user } = await sendPrompt();
  await user.click(screen.getByRole("button", { name: "Enter Focus mode" }));
  await act(async () => feed.emit(0, "delta", "Still streaming in Focus"));
  await screen.findByText("Still streaming in Focus", { exact: true });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Stop generation" }).disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Exit Focus" }));
  expect(screen.getByText("Still streaming in Focus", { exact: true })).toBeTruthy();
  expect(transport.createGenerationBatch).toHaveBeenCalledTimes(1);
  expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();
  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  await act(async () => { feed.emit(0, "completed"); feed.close(); });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Stop generation" })).toBeNull());
});

test("Focus transitions retain locally previewed attachments without reparsing", async () => {
  vi.mocked(transport.previewAttachment).mockResolvedValue({
    id: "f".repeat(64), name: "focus-notes.md", media_type: "text/plain",
    size: 6, characters: 6, extraction_version: "cove-text-v1",
    sections: [{ id: "L1", text: "Source" }],
  });
  const { composer, user } = await openWorkspace();
  await user.upload(screen.getByLabelText("Attach files"), new File(["Source"], "focus-notes.md", { type: "text/markdown" }));
  await screen.findByRole("button", { name: /Preview extracted text/ });
  await user.type(composer, "Use this source");
  await user.click(screen.getByRole("button", { name: "Enter Focus mode" }));
  expect(screen.getByRole("button", { name: "Remove attachment: focus-notes.md" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Exit Focus" }));
  expect(screen.getByRole("button", { name: "Remove attachment: focus-notes.md" })).toBeTruthy();
  expect((composer as HTMLTextAreaElement).value).toBe("Use this source");
  expect(transport.previewAttachment).toHaveBeenCalledTimes(1);
});

test("a streamed answer reconciles with saved history without appearing twice", async () => {
  const { composer } = await sendPrompt();
  expect(transport.createGenerationBatch).toHaveBeenCalledWith(
    fixture.conversation.id,
    {
      body: "A test prompt",
      clientRequestId: expect.any(String),
      expectedTargets: [{ provider_id: "provider-one", model_id: "model-one", require_private_tee: false }],
    },
  );
  expect((composer as HTMLTextAreaElement).value).toBe("");

  await act(async () => {
    feed.emit(0, "started");
    feed.emit(0, "delta", "Answer from model-one");
  });
  await screen.findByText("Answer from model-one", { exact: true });

  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  await act(async () => {
    feed.emit(0, "completed");
    feed.close();
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Stop generation" }),
    ).toBeNull(),
  );
  expect(
    screen.getAllByText("Answer from model-one", { exact: true }),
  ).toHaveLength(1);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Send message" })
      .disabled,
  ).toBe(true);
});

test("an uncertain submission retries with the same idempotency key", async () => {
  vi.mocked(transport.createGenerationBatch).mockRejectedValueOnce(
    new TypeError("Connection lost after submission"),
  );
  await sendPrompt();
  expect(transport.createGenerationBatch).toHaveBeenCalledTimes(2);
  const [first, second] = vi.mocked(transport.createGenerationBatch).mock.calls;
  expect(second).toEqual(first);
});

test("a rejected submission restores the draft and does not retry the Provider command", async () => {
  vi.mocked(transport.createGenerationBatch).mockRejectedValue(
    new transport.LocalServiceError({
      error: {
        code: "provider_unconfigured",
        message: "Missing key",
        details: null,
        request_id: "synthetic-request",
      },
    }),
  );
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Keep my draft");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect((composer as HTMLTextAreaElement).value).toBe("Keep my draft"),
  );
  expect(transport.createGenerationBatch).toHaveBeenCalledTimes(1);
  expect(transport.subscribeGenerationBatch).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Send message" })
      .disabled,
  ).toBe(false);
});

test("comparison streams update independently and the chosen answer is saved", async () => {
  configureWorkspace(2);
  const { user } = await sendPrompt();
  await act(async () => {
    feed.emit(1, "delta", "Answer from model-two");
    feed.emit(0, "delta", "Answer from model-one");
  });
  await screen.findByText("Answer from model-two", { exact: true });
  expect(
    screen.getByText("Answer from model-one", { exact: true }),
  ).toBeTruthy();

  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  await act(async () => {
    feed.emit(1, "completed");
    feed.emit(0, "completed");
    feed.close();
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Stop generation" }),
    ).toBeNull(),
  );
  const choices = screen.getAllByRole("button", { name: "Use for next turn" });
  expect(choices).toHaveLength(2);

  const selectedBatch = {
    ...fixture.completedBatch,
    selected_generation_id: "generation-1",
  };
  vi.mocked(transport.selectGenerationAnswer).mockResolvedValue(undefined);
  vi.mocked(transport.getGenerationBatch).mockResolvedValue(selectedBatch);
  vi.mocked(transport.getConversation).mockResolvedValue({
    ...fixture.completedView,
    generation_batches: [selectedBatch],
  });
  await user.click(choices[1]!);
  await screen.findByRole("button", { name: "Selected · Answer of record" });
  expect(transport.selectGenerationAnswer).toHaveBeenCalledWith("generation-1");
  expect(
    screen.getAllByText("Answer from model-two", { exact: true }),
  ).toHaveLength(1);
});

test("a completed comparison can be explicitly skipped for later context", async () => {
  configureWorkspace(2);
  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  const { user } = await openWorkspace();
  const skippedBatch = { ...fixture.completedBatch, context_skipped: true };
  vi.mocked(transport.skipGenerationBatchContext).mockResolvedValue(undefined);
  vi.mocked(transport.getConversation).mockResolvedValue({
    ...fixture.completedView,
    generation_batches: [skippedBatch],
  });
  await user.click(
    screen.getByRole("button", { name: "Continue without an answer" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Continue without an answer" }),
    ).toBeNull(),
  );
  expect(transport.skipGenerationBatchContext).toHaveBeenCalledWith(
    fixture.completedBatch.id,
  );
  expect(
    screen.getByText("Answer from model-one", { exact: true }),
  ).toBeTruthy();
});

test("retrying a stopped answer addresses its original target and renders the new attempt", async () => {
  const stoppedBatch = {
    ...fixture.pendingBatch,
    state: "stopped" as const,
    targets: fixture.pendingBatch.targets.map((target) => ({
      ...target,
      generation: { ...target.generation, state: "stopped" as const },
    })),
  };
  vi.mocked(transport.getConversation).mockResolvedValue({
    ...fixture.conversation,
    messages: fixture.completedView.messages.slice(0, 1),
    generation_batches: [stoppedBatch],
  });
  fixture.pendingBatch.targets[0]!.generation.id = "attempt-two";
  fixture.completedBatch.targets[0]!.generation.id = "attempt-two";
  const generation: Generation = {
    ...fixture.pendingBatch.targets[0]!.generation,
    conversation_id: fixture.conversation.id,
    client_request_id: "retry-request",
    events_url: "/unused-test-stream",
    created_at: fixture.pendingBatch.created_at,
    updated_at: fixture.pendingBatch.updated_at,
  };
  vi.mocked(transport.retryGenerationTarget).mockResolvedValue(generation);
  vi.mocked(transport.getGenerationBatch).mockResolvedValue(
    fixture.pendingBatch,
  );
  const { user } = await openWorkspace();
  await user.click(screen.getByRole("button", { name: "Retry generation" }));
  await waitFor(() =>
    expect(transport.subscribeGenerationBatch).toHaveBeenCalledWith(
      fixture.pendingBatch.id,
    ),
  );
  expect(transport.retryGenerationTarget).toHaveBeenCalledWith(
    "target-0",
    expect.any(String),
  );
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();

  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  vi.mocked(transport.getGenerationBatch).mockResolvedValue(
    fixture.completedBatch,
  );
  vi.mocked(transport.getGenerationBatchContext).mockResolvedValue([]);
  await act(async () => {
    feed.emit(0, "delta", "Answer from model-one");
    feed.emit(0, "completed");
    feed.close();
  });
  await screen.findByText("Answer from model-one", { exact: true });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry generation" }),
    ).toBeNull(),
  );
});

test("switching an active conversation requires confirmation and sends a stop command", async () => {
  const { user } = await sendPrompt();
  await user.click(
    within(screen.getByRole("navigation", { name: "Chats" })).getByText(
      "Second chat",
      { exact: true },
    ),
  );
  let confirmation = await screen.findByRole("dialog");
  expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();
  await user.click(
    within(confirmation).getByRole("button", { name: "Cancel" }),
  );
  expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();

  await user.click(
    within(screen.getByRole("navigation", { name: "Chats" })).getByText(
      "Second chat",
      { exact: true },
    ),
  );
  confirmation = await screen.findByRole("dialog");
  vi.mocked(transport.cancelGenerationBatch).mockResolvedValue({
    ...fixture.pendingBatch,
    state: "stopped",
  });
  await user.click(
    within(confirmation).getByRole("button", { name: "Switch conversation" }),
  );
  await waitFor(() =>
    expect(transport.getConversation).toHaveBeenCalledWith(
      fixture.secondConversation.id,
    ),
  );
  expect(transport.cancelGenerationBatch).toHaveBeenCalledWith(
    fixture.pendingBatch.id,
  );
});

test.each(["private_tee", "incognito", "chutes"] as const)(
  "a %s target uses browser inference and settles its verification",
  async (mode) => {
    const generation = configureNearAITarget(0, mode);
    const { user, composer } = await openWorkspace();
    await user.type(composer, "A test prompt");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(transport.settleSecureGeneration).toHaveBeenCalledWith(
        generation.id,
        "Synthetic private answer",
        expect.objectContaining({ status: generation.verification!.status }),
      ),
    );
    expect(privateInference.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ id: "nearai" }),
        mode,
        message: "A test prompt",
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
    expect(transport.markSecureGenerationEnvironment).toHaveBeenCalledWith(
      generation.id,
    );
    expect(transport.markSecureGenerationStreaming).toHaveBeenCalledWith(
      generation.id,
    );
    expect(
      transport.markSecureGenerationResponseVerification,
    ).toHaveBeenCalledWith(generation.id);
    expect(transport.subscribeGenerationBatch).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Stop generation" }),
      ).toBeNull(),
    );
  },
);

test("a mixed comparison keeps the batch stream and private inference on independent paths", async () => {
  configureWorkspace(2);
  const privateGeneration = configureNearAITarget(1, "private_tee");
  await sendPrompt();
  await waitFor(() =>
    expect(transport.settleSecureGeneration).toHaveBeenCalledWith(
      privateGeneration.id,
      "Synthetic private answer",
      expect.objectContaining({ status: "verified_model" }),
    ),
  );
  expect(privateInference.generate).toHaveBeenCalledTimes(1);
  expect(transport.subscribeGenerationBatch).toHaveBeenCalledTimes(1);
  await act(async () => {
    feed.emit(0, "delta", "Answer from model-one");
    feed.emit(0, "completed");
    feed.close();
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Stop generation" }),
    ).toBeNull(),
  );
  expect(
    screen.getAllByText("Answer from model-one", { exact: true }),
  ).toHaveLength(1);
  expect(
    screen.getAllByText("Answer from model-two", { exact: true }),
  ).toHaveLength(1);
});

test("a late conversation load cannot replace the newly selected conversation", async () => {
  let finishFirstLoad!: (view: typeof fixture.conversation) => void;
  const firstLoad = new Promise<typeof fixture.conversation>((resolve) => {
    finishFirstLoad = resolve;
  });
  const firstView = {
    ...fixture.conversation,
    messages: [
      {
        id: "old-message",
        conversation_id: fixture.conversation.id,
        role: "user",
        body: "Old conversation content",
        created_at: fixture.conversation.created_at,
      },
    ],
  };
  const secondView = {
    ...fixture.secondConversation,
    messages: [
      {
        id: "new-message",
        conversation_id: fixture.secondConversation.id,
        role: "user",
        body: "Selected conversation content",
        created_at: fixture.secondConversation.created_at,
      },
    ],
  };
  vi.mocked(transport.getConversation).mockImplementation((id) =>
    id === firstView.id ? firstLoad : Promise.resolve(secondView),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("Second chat", { exact: true }));
  await screen.findByText("Selected conversation content", { exact: true });
  await act(async () => {
    finishFirstLoad(firstView);
  });
  expect(
    screen.queryByText("Old conversation content", { exact: true }),
  ).toBeNull();
  expect(
    screen.getByText("Selected conversation content", { exact: true }),
  ).toBeTruthy();
});

test("theme saving updates the workspace and preserves the selected models", async () => {
  vi.mocked(transport.updateSettings).mockImplementation(
    async (settings) => settings,
  );
  const { user } = await openWorkspace();
  await user.click(
    screen.getByRole("button", { name: "Toggle day / night edition" }),
  );
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
  expect(vi.mocked(transport.updateSettings).mock.calls[0]?.[0]).toEqual({
    ...fixture.settings,
    theme: "dark",
  });
  expect(transport.updateSettings).toHaveBeenCalledTimes(1);
});

test("a failed local session shows unavailable state without loading a conversation", async () => {
  vi.mocked(transport.getSession).mockRejectedValue(
    new Error("Local service unavailable"),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  await screen.findByText("Local service unavailable", { exact: true });
  expect(screen.queryByRole("textbox", { name: "Send message" })).toBeNull();
  expect(transport.getConversation).not.toHaveBeenCalled();
});

test("clearing history also removes cached conversation content", async () => {
  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  vi.mocked(transport.clearChatData).mockImplementation(async () => {
    vi.mocked(transport.getConversations).mockResolvedValue([]);
    vi.mocked(transport.getConversation).mockRejectedValue(
      new Error("Conversation deleted"),
    );
  });
  const { user } = await openWorkspace();
  expect(
    queryClient.getQueryData(conversationKeys.detail(fixture.conversation.id)),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: /Chat data/i }));
  await user.click(screen.getByRole("button", { name: "Clear chat data" }));
  const confirmation = await screen.findByRole("dialog", {
    name: "Clear chat data",
  });
  await user.click(
    within(confirmation).getByRole("button", { name: "Clear chat data" }),
  );
  await waitFor(() => expect(transport.clearChatData).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      queryClient.getQueryData(
        conversationKeys.detail(fixture.conversation.id),
      ),
    ).toBeUndefined(),
  );
});

test("settings tabs support arrow keys and restore focus after Escape", async () => {
  await openWorkspace();
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Settings" });
  await user.click(trigger);
  const general = screen.getByRole("tab", { name: /General/ });
  const providers = screen.getByRole("tab", { name: /Provider settings/ });
  const data = screen.getByRole("tab", { name: /Chat data/i });
  general.focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(providers);
  expect(providers.getAttribute("aria-selected")).toBe("true");
  expect(general.tabIndex).toBe(-1);
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(data);
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(general);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("a suggested prompt fills the composer without submitting it", async () => {
  const { composer, user } = await openWorkspace();
  await user.click(screen.getByRole("button", { name: /Write the letter/ }));
  expect((composer as HTMLTextAreaElement).value).toBe(
    "Write the letter you've been putting off",
  );
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});

test("private verification actions appear only after opening their menu", async () => {
  configureNearAITarget(0, "private_tee");
  const { user } = await openWorkspace();
  expect(screen.queryByRole("menu")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Model Verification" }));
  expect(
    await screen.findByRole("menuitem", { name: "Verify private connection" }),
  ).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});

test.each(["model", "gateway"] as const)(
  "saved %s evidence keeps re-verification reachable through its menu",
  async (kind) => {
    const { VerificationDetailsButton } = await import(
      "@/components/verification/VerificationDetailsButton"
    );
    const { englishConversationCopy } = await import("@/messages");
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <VerificationDetailsButton
        verification={{
          status: kind === "model" ? "verified_model" : "verified_gateway",
          evidence: { kind },
        }}
        copy={englishConversationCopy}
        onVerifyAgain={refresh}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: kind === "model" ? "Model Verification" : "Gateway Verification",
      }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Verify Again" }),
    );
    expect(refresh).toHaveBeenCalledWith(kind);
  },
);

test("Escape dismisses the nested add-model search and restores its trigger", async () => {
  const { ModelSelector } = await import(
    "@/components/providers/ModelSelector"
  );
  render(
    <ModelSelector
      profiles={[fixture.profile]}
      activeProviderId={fixture.profile.id}
      activeModelId={fixture.models[0]!}
      activeModelSet={[
        { providerId: fixture.profile.id, modelId: fixture.models[0]! },
      ]}
      catalog={{ status: "ready", models: ["model-one", "model-two"] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
      onAddModel={() => {}}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Model comparison/ }));
  const trigger = screen.getByRole("button", { name: "Add model" });
  await user.click(trigger);
  const search = await screen.findByRole("combobox", { name: "Search models" });
  await user.click(search);
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      document.querySelector(".model-selector__add-menu-items"),
    ).toBeNull(),
  );
  expect(document.activeElement).toBe(trigger);
});

test("private inference uses only the service's frozen selected context", async () => {
  configureNearAITarget(0, "private_tee");
  const frozen = [
    { role: "user" as const, content: "Earlier question" },
    { role: "assistant" as const, content: "Selected answer" },
  ];
  fixture.conversation.messages = [
    {
      id: "old-user",
      conversation_id: fixture.conversation.id,
      role: "user",
      body: "Skipped question",
      created_at: fixture.pendingBatch.created_at,
    },
    {
      id: "old-answer",
      conversation_id: fixture.conversation.id,
      role: "assistant",
      body: "Unselected answer",
      created_at: fixture.pendingBatch.created_at,
    },
  ];
  vi.mocked(transport.getGenerationBatchContext).mockResolvedValue(frozen);
  const { user, composer } = await openWorkspace();
  await user.type(composer, "A test prompt");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(privateInference.generate).toHaveBeenCalled());
  expect(privateInference.generate.mock.calls[0]?.[0].context).toEqual(frozen);
  expect(transport.getGenerationBatchContext).toHaveBeenCalledWith(
    fixture.pendingBatch.id,
  );
});

test("an earlier private target retry reuses its frozen context instead of later history", async () => {
  configureNearAITarget(0, "private_tee");
  const stopped = {
    ...fixture.pendingBatch,
    state: "stopped" as const,
    targets: fixture.pendingBatch.targets.map((target) => ({
      ...target,
      generation: { ...target.generation, state: "stopped" as const },
    })),
  };
  const laterMessage = {
    id: "later",
    conversation_id: fixture.conversation.id,
    role: "user",
    body: "Later history must stay local",
    created_at: fixture.pendingBatch.created_at,
  };
  vi.mocked(transport.getConversation).mockResolvedValue({
    ...fixture.conversation,
    messages: [...fixture.completedView.messages.slice(0, 1), laterMessage],
    generation_batches: [stopped],
  });
  vi.mocked(transport.getGenerationBatch).mockResolvedValue(
    fixture.pendingBatch,
  );
  vi.mocked(transport.getGenerationBatchContext).mockResolvedValue([]);
  const attempt = {
    ...fixture.pendingBatch.targets[0]!.generation,
    conversation_id: fixture.conversation.id,
    client_request_id: "retry",
    events_url: "/unused",
    created_at: fixture.pendingBatch.created_at,
    updated_at: fixture.pendingBatch.updated_at,
  };
  vi.mocked(transport.retryGenerationTarget).mockResolvedValue(attempt);
  const { user } = await openWorkspace();
  await user.click(screen.getByRole("button", { name: "Retry generation" }));
  await waitFor(() => expect(privateInference.generate).toHaveBeenCalled());
  expect(privateInference.generate.mock.calls[0]?.[0].context).toEqual([]);
  expect(privateInference.generate.mock.calls[0]?.[0].message).toBe(
    "A test prompt",
  );
});

test("changing appearance preserves an unsaved settings form and saves only appearance", async () => {
  const { user } = await openWorkspace();
  vi.mocked(transport.updateSettings).mockImplementation(
    async (settings) => settings,
  );
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const prompt = screen.getByRole("textbox", { name: /System Prompt/ });
  await user.type(prompt, "Unsaved prompt");
  await user.click(screen.getByRole("button", { name: /^Dark$/ }));
  await waitFor(() => expect(transport.updateSettings).toHaveBeenCalled());
  expect(vi.mocked(transport.updateSettings).mock.calls[0]?.[0]).toEqual({
    ...fixture.settings,
    theme: "dark",
    locale: "en",
  });
  expect((prompt as HTMLTextAreaElement).value).toBe("Unsaved prompt");
});

test("clearing active ordinary history stops the batch before deleting data", async () => {
  const { user } = await sendPrompt();
  vi.mocked(transport.cancelGenerationBatch).mockImplementation(async () => {
    feed.close();
    return { ...fixture.pendingBatch, state: "stopped" };
  });
  vi.mocked(transport.clearChatData).mockImplementation(async () => {
    vi.mocked(transport.getConversations).mockResolvedValue([]);
  });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: /Chat data/ }));
  await user.click(screen.getByRole("button", { name: "Clear chat data" }));
  await user.click(
    within(
      await screen.findByRole("dialog", { name: "Clear chat data" }),
    ).getByRole("button", { name: "Clear chat data" }),
  );
  await waitFor(() => expect(transport.clearChatData).toHaveBeenCalled());
  expect(
    vi.mocked(transport.cancelGenerationBatch).mock.invocationCallOrder[0],
  ).toBeLessThan(
    vi.mocked(transport.clearChatData).mock.invocationCallOrder[0]!,
  );
  expect(
    queryClient.getQueryData(conversationKeys.detail(fixture.conversation.id)),
  ).toBeUndefined();
});

test("stopping private verification does not wait forever for an SDK callback", async () => {
  const generation = configureNearAITarget(0, "private_tee");
  privateInference.generate.mockImplementation(
    async function* (): AsyncGenerator<SecureInferenceEvent> {
      yield { type: "verifying_environment" };
      yield { type: "streaming" };
      yield { type: "delta", delta: "Pending verification" };
      yield { type: "response_ready", completionId: "pending-completion" };
    },
  );
  const { user, composer } = await openWorkspace();
  await user.type(composer, "A test prompt");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(
      transport.markSecureGenerationResponseVerification,
    ).toHaveBeenCalled(),
  );
  const stopped = { ...fixture.pendingBatch, state: "stopped" as const };
  vi.mocked(transport.cancelGenerationBatch).mockResolvedValue(stopped);
  vi.mocked(transport.cancelGeneration).mockResolvedValue({
    ...generation,
    state: "stopped",
  });
  vi.mocked(transport.getConversation).mockResolvedValue({
    ...fixture.conversation,
    generation_batches: [stopped],
  });
  await user.click(
    screen.getAllByRole("button", { name: "Stop generation" }).at(-1)!,
  );
  await waitFor(() =>
    expect(transport.cancelGeneration).toHaveBeenCalledWith(generation.id),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Stop generation" }),
    ).toBeNull(),
  );
});

test("a changed destination requires an explicit new key before testing or saving", async () => {
  const { ProviderSettings } = await import(
    "@/components/providers/ProviderSettings"
  );
  const save = vi.fn().mockResolvedValue(fixture.profile);
  const probe = vi.fn().mockResolvedValue(fixture.models);
  render(
    <ProviderSettings
      profiles={[fixture.profile]}
      onSave={save}
      onTest={probe}
      onDelete={async () => {}}
      onDeleteKey={async () => {}}
    />,
  );
  const user = userEvent.setup();
  const endpoint = screen.getByRole("textbox", { name: "Endpoint" });
  await user.clear(endpoint);
  await user.type(endpoint, "https://different.example");
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  await user.click(screen.getByRole("button", { name: "Save Provider" }));
  expect(probe).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      "Enter a new API key before changing this Provider destination.",
    ),
  ).toBeTruthy();
});

test("provider save disables overlapping commands until the request finishes", async () => {
  const { ProviderSettings } = await import(
    "@/components/providers/ProviderSettings"
  );
  let finish!: (profile: typeof fixture.profile) => void;
  const save = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <ProviderSettings
      profiles={[fixture.profile]}
      onSave={save}
      onTest={async () => []}
      onDelete={async () => {}}
      onDeleteKey={async () => {}}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Save Provider" }));
  const saving = screen.getByRole("button", { name: "Saving..." });
  await user.click(saving);
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish(fixture.profile));
  expect(
    await screen.findByRole("button", { name: "Save Provider" }),
  ).toBeTruthy();
});

test("an unresolved comparison keeps the next draft until an answer is chosen or skipped", async () => {
  configureWorkspace(2);
  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  vi.mocked(transport.skipGenerationBatchContext).mockImplementation(
    async () => {
      fixture.completedBatch.context_skipped = true;
      vi.mocked(transport.getConversation).mockResolvedValue(
        fixture.completedView,
      );
    },
  );
  const { user, composer } = await openWorkspace();
  await user.type(composer, "Next question{Enter}");
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(
    screen.getByRole("button", { name: "Continue without an answer" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Send message",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect((composer as HTMLTextAreaElement).value).toBe("Next question");
});

test("follow-system appearance responds to OS changes without rewriting the preference", async () => {
  let listener: (() => void) | undefined;
  const media = {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_event: string, callback: () => void) => {
      listener = callback;
    }),
    removeEventListener: vi.fn(),
  };
  vi.mocked(window.matchMedia).mockImplementation((query) =>
    query.includes("prefers-color-scheme")
      ? (media as unknown as MediaQueryList)
      : ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as unknown as MediaQueryList),
  );
  fixture.settings.theme = "system";
  await openWorkspace();
  await waitFor(() => expect(listener).toBeDefined());
  await act(async () => {
    media.matches = true;
    listener?.();
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await act(async () => {
    media.matches = false;
    listener?.();
  });
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(transport.updateSettings).not.toHaveBeenCalled();
});

test("an early failed comparison target waits for the other models before offering retry", async () => {
  configureWorkspace(2);
  const { user } = await sendPrompt();
  await act(async () => feed.emit(1, "failed"));
  const retry = await screen.findByRole("button", { name: "Retry generation" });
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  await user.click(retry);
  expect(transport.retryGenerationTarget).not.toHaveBeenCalled();
  const partial = {
    ...fixture.completedBatch,
    state: "completed_with_errors" as const,
    targets: fixture.completedBatch.targets.map((target, index) =>
      index === 1
        ? {
            ...target,
            generation: {
              ...target.generation,
              state: "failed" as const,
              assistant_message_id: undefined,
            },
          }
        : target,
    ),
  };
  vi.mocked(transport.getGenerationBatch).mockResolvedValue(partial);
  vi.mocked(transport.getConversation).mockResolvedValue({
    ...fixture.completedView,
    messages: fixture.completedView.messages.filter(
      (message) => message.id !== "answer-1",
    ),
    generation_batches: [partial],
  });
  await act(async () => {
    feed.emit(0, "completed");
    feed.close();
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Retry generation",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});

test.each(["context", "transport"])(
  "a private timeout during %s settles the generation",
  async (stage) => {
    const generation = configureNearAITarget(0, "private_tee");
    const originalTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    const timer = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, delay, ...args) => {
        if (delay === 120_000 && typeof callback === "function")
          expire = () => callback(...args);
        return originalTimeout(callback, delay, ...args);
      });
    if (stage === "context") {
      vi.mocked(transport.getGenerationBatchContext).mockImplementation(
        () => new Promise(() => {}),
      );
    } else {
      privateInference.generate.mockImplementation(async function* (
        _request: unknown,
        signal: AbortSignal,
      ): AsyncGenerator<SecureInferenceEvent> {
        yield { type: "verifying_environment" };
        await new Promise((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Stopped", "AbortError")),
            { once: true },
          ),
        );
      });
    }
    try {
      const { user, composer } = await openWorkspace();
      await user.type(composer, "A test prompt");
      await user.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() =>
        expect(transport.getGenerationBatchContext).toHaveBeenCalled(),
      );
      if (stage === "transport")
        await waitFor(() =>
          expect(privateInference.generate).toHaveBeenCalled(),
        );
      expect(expire).toBeDefined();
      await act(async () => {
        expire!();
      });
      await waitFor(() =>
        expect(transport.settleSecureGeneration).toHaveBeenCalledWith(
          generation.id,
          "",
          expect.objectContaining({ failure_code: "timeout" }),
        ),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Stop generation" }),
        ).toBeNull(),
      );
    } finally {
      timer.mockRestore();
    }
  },
);

test("workspace notifications restart their timeout on repeat and can be dismissed manually", () => {
  vi.useFakeTimers();
  try {
    const dismiss = vi.fn();
    const message = { message: "Verification failed", tone: "error" as const };
    const toast = render(
      <WorkspaceToast feedback={message} onDismiss={dismiss} />,
    );
    act(() => vi.advanceTimersByTime(4000));
    toast.rerender(
      <WorkspaceToast feedback={{ ...message }} onDismiss={dismiss} />,
    );
    act(() => vi.advanceTimersByTime(4000));
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2000));
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() =>
      screen.getByRole("button", { name: "Dismiss notification" }).click(),
    );
    expect(dismiss).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test("the provider setup action opens the Provider tab directly", async () => {
  vi.mocked(transport.getProviderProfiles).mockResolvedValue([]);
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  const chat = await screen.findByRole("region", {
    name: fixture.conversation.title,
  });
  const setup = within(chat).getByRole("button", {
    name: "Open Provider settings",
  });
  await userEvent.setup().click(setup);
  expect(
    (
      await screen.findByRole("tab", { name: "Provider settings" })
    ).getAttribute("aria-selected"),
  ).toBe("true");
});

test("files are previewed, sent with an idempotent submission, and cleared after acceptance", async () => {
  const snapshot = {
    id: "a".repeat(64),
    name: "notes.md",
    media_type: "text/plain" as const,
    size: 6,
    characters: 6,
    extraction_version: "cove-text-v1",
    sections: [{ id: "L1", text: "Source" }],
  };
  vi.mocked(transport.previewAttachment).mockResolvedValue(snapshot);
  vi.mocked(transport.previewGenerationContext).mockResolvedValue([
    { role: "user", content: "A draft and Source" },
  ]);
  const { composer, user } = await openWorkspace();
  await user.upload(
    screen.getByLabelText("Attach files"),
    new File(["Source"], "notes.md", { type: "text/markdown" }),
  );
  await screen.findByRole("button", { name: /Preview extracted text/ });
  expect(transport.previewAttachment).toHaveBeenCalledWith({
    name: "notes.md",
    data: btoa("Source"),
  });
  await user.type(composer, "Use the source");
  await user.click(screen.getByRole("button", { name: "Review context" }));
  await screen.findByText("A draft and Source");
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(transport.createGenerationBatch).toHaveBeenCalledWith(
      fixture.conversation.id,
      expect.objectContaining({
        body: "Use the source",
        attachments: [{ name: "notes.md", data: btoa("Source") }],
      }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Remove attachment: notes.md" }),
    ).toBeNull(),
  );
});

test("attachment validation blocks sending and a rejected submission retains its files", async () => {
  const snapshot = {
    id: "b".repeat(64),
    name: "notes.txt",
    media_type: "text/plain" as const,
    size: 6,
    characters: 6,
    extraction_version: "cove-text-v1",
    sections: [{ id: "L1", text: "Source" }],
  };
  vi.mocked(transport.previewAttachment).mockRejectedValueOnce(
    new Error("The file could not be parsed."),
  );
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Use the source");
  await user.upload(
    screen.getByLabelText("Attach files"),
    new File(["bad"], "bad.txt"),
  );
  await screen.findByText("The file could not be parsed.");
  expect(
    screen
      .getByRole("button", { name: "Send message" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await user.click(
    screen.getByRole("button", { name: "Remove attachment: bad.txt" }),
  );
  vi.mocked(transport.previewAttachment).mockResolvedValue(snapshot);
  await user.upload(
    screen.getByLabelText("Attach files"),
    new File(["Source"], "notes.txt"),
  );
  await screen.findByRole("button", { name: /Preview extracted text/ });
  vi.mocked(transport.createGenerationBatch).mockRejectedValue(
    new transport.LocalServiceError({
      error: {
        code: "invalid_attachment",
        message: "The context is too large.",
        details: null,
        request_id: "test",
      },
    }),
  );
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("The context is too large.");
  expect(
    screen.getByRole("button", { name: "Remove attachment: notes.txt" }),
  ).toBeTruthy();
  expect((composer as HTMLTextAreaElement).value).toBe("Use the source");
});

test("NearAI receives the authoritative attachment input rather than the visible user message", async () => {
  configureNearAITarget(0, "private_tee");
  const encryptedInput = "Visible prompt plus frozen source text";
  fixture.pendingBatch.input_content = encryptedInput;
  fixture.completedBatch.input_content = encryptedInput;
  const { composer, user } = await openWorkspace();
  await user.type(composer, "A test prompt");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(privateInference.generate).toHaveBeenCalled());
  expect(privateInference.generate.mock.calls[0]?.[0].message).toBe(
    encryptedInput,
  );
});

test("stopping during file submission cancels the newly accepted batch before starting browser inference", async () => {
  configureNearAITarget(0, "private_tee");
  let accept!: (batch: typeof fixture.pendingBatch) => void;
  vi.mocked(transport.createGenerationBatch).mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  const stopped = {
    ...fixture.pendingBatch,
    state: "stopped" as const,
    targets: fixture.pendingBatch.targets.map((target) => ({
      ...target,
      generation: { ...target.generation, state: "stopped" as const },
    })),
  };
  vi.mocked(transport.cancelGenerationBatch).mockResolvedValue(stopped);
  const { composer, user } = await openWorkspace();
  await user.type(composer, "A pending submission");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(transport.createGenerationBatch).toHaveBeenCalled(),
  );
  await user.click(screen.getByRole("button", { name: "Stop generation" }));
  expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();
  await act(async () => {
    accept(fixture.pendingBatch);
  });
  await waitFor(() =>
    expect(transport.cancelGenerationBatch).toHaveBeenCalledWith(
      fixture.pendingBatch.id,
    ),
  );
  expect(privateInference.generate).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Stop generation" }),
    ).toBeNull(),
  );
});

test("private stream failure preserves the bounded Provider reason in settlement and the UI", async () => {
  configureNearAITarget(0, "incognito");
  const reason =
    "Provider error: The upstream model service failed to generate a response (server_error). Try again later or select another model.";
  privateInference.generate.mockImplementation(async function* () {
    yield { type: "verifying_environment" };
    yield { type: "streaming" };
    yield { type: "failed", code: "stream_failed", reason };
  });
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Reply OK");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(transport.settleSecureGeneration).toHaveBeenCalledWith(
      fixture.pendingBatch.targets[0]!.generation.id,
      "",
      expect.objectContaining({
        failure_code: "stream_failed",
        evidence_summary: reason,
      }),
    ),
  );
});
