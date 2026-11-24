// @vitest-environment jsdom
import { setupControlTests, chooseOption } from "@/test/control-helpers";

import * as transport from "@/api";
import * as conversationApi from "@/api/conversations";
import * as localApi from "@/api/local-models";
import * as projectApi from "@/api/projects";
import * as debateApi from "@/api/debates";
import { runDebateBrowserTurn } from "@/lib/inference/debate-browser-turn";
import { defaultDebateRules } from "@/components/debate/DebateSetupDialog";
import { historyFiltersStorageKey, historyQueryFilter } from "@/components/conversations/history-filters";
import { conversationKeys } from "@/api/queryKeys";
import { createLocalServiceQueryClient } from "@/api/queryClient";
import { useChatWorkspace } from "@/hooks/workspace/use-chat-workspace";
import { quickPanelFocusEvent, quickPanelImportEvent } from "@/lib/quick-panel";
import { App } from "@/App";
import { ProjectsPage } from "@/components/projects/ProjectsPage";
import { WorkspaceToast } from "@/components/layout/WorkspaceToast";
import type { SecureInferenceEvent } from "@/lib/inference/secure-inference";
import {
  createBatchEventFeed,
  createWorkspaceFixture,
} from "@/test/workspace-fixture";
import type { DebateView, Generation, ProviderModelPrivacyMode } from "@cove/api-contract";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const privateInference = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@/api/debates", () => ({ getDebate: vi.fn(), createDebate: vi.fn(), controlDebate: vi.fn(), updateDebateRules: vi.fn(), addDebateIntervention: vi.fn(), watchDebate: vi.fn(), getDebateExport: vi.fn() }));
vi.mock("@/lib/inference/debate-browser-turn", () => ({ runDebateBrowserTurn: vi.fn() }));

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
    updateConversation: vi.fn(),
    getConversation: vi.fn(),
    getProviderProfiles: vi.fn(),
    getProviderCatalog: vi.fn(),
    testProviderConnection: vi.fn(),
    getSettings: vi.fn(),
    createGenerationBatch: vi.fn(),
    subscribeGenerationBatch: vi.fn(),
    getGenerationBatch: vi.fn(),
    getGenerationBatchContext: vi.fn(),
    getProjectBatchContext: vi.fn(),
    previewAttachment: vi.fn(),
    prepareWebSource: vi.fn(),
    releaseWebSource: vi.fn(),
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
const historyBrowserMethods: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.removeItem(historyFiltersStorageKey);
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"]) {
    if (Reflect.get(Element.prototype, name) !== undefined) continue;
    Object.defineProperty(Element.prototype, name, { configurable: true, value: name === "hasPointerCapture" ? () => false : () => {} });
    historyBrowserMethods.push(name);
  }
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
  queryClient = createLocalServiceQueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  configureWorkspace();
});

setupControlTests();

afterEach(() => {
  cleanup();
  feed.close();
  queryClient.clear();
  vi.restoreAllMocks();

  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  window.localStorage.removeItem(historyFiltersStorageKey);
  for (const name of historyBrowserMethods.splice(0)) Reflect.deleteProperty(Element.prototype, name);
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
  vi.mocked(transport.releaseWebSource).mockResolvedValue(undefined);
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

test.each(["filter", "selected-archive"])("empty-draft %s navigation blocks edits until the request finishes", async (operation) => {
  const { composer, user } = await openWorkspace();
  let finish!: () => void;
  if (operation === "filter") {
    vi.mocked(transport.getConversations).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve([fixture.secondConversation]); }));
    await user.click(screen.getByRole("button", { name: "Archived chats" }));
    await waitFor(() => expect(transport.getConversations).toHaveBeenCalledWith({ archived: true }));
  } else {
    vi.mocked(transport.updateConversation).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve(); }));
    vi.mocked(transport.getConversations).mockResolvedValue([fixture.secondConversation]);
    await user.click(screen.getByRole("button", { name: /Conversation actions: First chat/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(transport.updateConversation).toHaveBeenCalled());
  }
  expect((composer as HTMLTextAreaElement).disabled).toBe(true);
  await user.type(composer, "Do not lose this edit");
  expect((composer as HTMLTextAreaElement).value).toBe("");
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => finish());
  await waitFor(() => expect(document.querySelector(".masthead__title")?.textContent).toBe("Second chat"));
  expect((screen.getByRole("textbox", { name: "Send message" }) as HTMLTextAreaElement).disabled).toBe(false);
});

test("history filters compose with local search and preserve the open conversation and draft", async () => {
  fixture.secondConversation.debate_id = fixture.secondConversation.id;
  fixture.secondConversation.debate_status = "paused";
  fixture.secondConversation.debate_round = 3;
  fixture.secondConversation.updated_at = new Date().toISOString();
  vi.mocked(transport.searchConversations).mockResolvedValue([{ ...fixture.secondConversation, excerpt: "needle in the matching history", role: "assistant" }]);
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Keep this draft while filtering.");
  await user.click(screen.getByRole("button", { name: "Filter history" }));
  await user.click(screen.getByRole("combobox", { name: "Conversation type" }));
  await user.click(await screen.findByRole("option", { name: "Debate" }));
  await user.click(screen.getByRole("combobox", { name: "Last activity" }));
  await user.click(await screen.findByRole("option", { name: "Last 7 days" }));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const navigation = screen.getByRole("navigation", { name: "Chats" });
  expect(within(navigation).queryByText("First chat", { exact: true })).toBeNull();
  expect(within(navigation).getByText("Paused · Round 3")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Send message" })).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe("Keep this draft while filtering.");
  await user.type(screen.getByRole("textbox", { name: "Search conversations" }), "needle");
  await screen.findByText(/needle in the matching history/);
  expect(transport.searchConversations).toHaveBeenCalledWith("needle", false, expect.any(AbortSignal), { ...historyQueryFilter({ activity: "7d", kind: "debate" }), projectId: "" });
  expect(JSON.parse(window.localStorage.getItem(historyFiltersStorageKey)!)).toEqual({ activity: "7d", kind: "debate" });
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
  expect(transport.getConversation).not.toHaveBeenCalledWith(fixture.secondConversation.id);
});

test("saved history filters restore and an empty filtered list offers a direct reset", async () => {
  window.localStorage.setItem(historyFiltersStorageKey, JSON.stringify({ activity: "30d", kind: "debate" }));
  const { composer, user } = await openWorkspace();
  expect(await screen.findByText("No conversations match these filters.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear activity filter" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear type filter" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByRole("navigation", { name: "Chats" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Clear type filter" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "Send message" })).toBe(composer);
  expect(JSON.parse(window.localStorage.getItem(historyFiltersStorageKey)!)).toEqual({ activity: "all", kind: "all" });
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
  expect(transport.searchConversations).toHaveBeenCalledWith("SQLite migration checklist", false, expect.any(AbortSignal), { projectId: "" });
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

test("Debate Focus preserves a browser turn and intervention draft while restoring navigation and dialog focus", async () => {
  configureWorkspace(2);
  fixture.conversation.debate_id = fixture.conversation.id;
  const view: DebateView = {
    session: { id: fixture.conversation.id, client_request_id: "debate-request", topic: "Should a CTO keep writing code?", seats: fixture.settings.active_model_set.map((seat, index) => ({ ...seat, role: index ? "Challenger" : "Advocate" })), rules: defaultDebateRules, status: "running", round: 2, position: 0, opening_done: [true, true], total_turns: 2, browser_required: true, created_at: fixture.conversation.created_at, updated_at: fixture.conversation.updated_at },
    turns: [{ id: "browser-turn", debate_id: fixture.conversation.id, sequence: 3, round: 2, seat: 0, role: "Advocate", rule_version: 1, execution: "browser", state: "streaming", body: "A perspective still being verified.", snapshot: fixture.pendingBatch.targets[0]!.generation.snapshot, configuration: fixture.pendingBatch.targets[0]!.generation.configuration_snapshot, context_ids: [], created_at: fixture.conversation.created_at, updated_at: fixture.conversation.updated_at }],
    interventions: [], has_more: false,
  };
  vi.mocked(debateApi.getDebate).mockResolvedValue(view);
  vi.mocked(debateApi.watchDebate).mockResolvedValue(undefined);
  vi.mocked(runDebateBrowserTurn).mockImplementation(async (_commands, signal) => {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  });
  render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
  const composer = await screen.findByRole("textbox", { name: "Your intervention" });
  const user = userEvent.setup();
  await waitFor(() =>
    expect(document.querySelector('[data-workspace-region="workspace-header"] .masthead__title')?.textContent).toBe(view.session.topic),
  );
  await waitFor(() => expect(runDebateBrowserTurn).toHaveBeenCalledTimes(1));
  const browserSignal = vi.mocked(runDebateBrowserTurn).mock.calls[0]![1];
  await user.type(composer, "Consider a team of thirty engineers.");
  const enter = screen.getByRole("button", { name: "Enter Focus mode" });
  await user.click(enter);
  expect(screen.getByRole("main").getAttribute("data-focus-mode")).toBe("true");
  expect(document.getElementById("conversation-sidebar")?.hidden).toBe(true);
  expect(screen.getByRole("list", { name: "Debate participants" }).querySelectorAll('[data-active-speaker="true"]').length).toBe(1);
  expect(screen.queryByRole("complementary", { name: "Live brief" })).toBeNull();
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "New debate" })).toBeTruthy();
  expect(document.querySelector('[data-workspace-region="workspace-header"] .masthead__title')?.textContent).toBe(view.session.topic);
  await user.click(screen.getByRole("button", { name: "Live brief" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("main").getAttribute("data-focus-mode")).toBe("true");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("main").hasAttribute("data-focus-mode")).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Enter Focus mode" }));
  expect(document.getElementById("conversation-sidebar")?.hidden).toBe(false);
  expect(screen.getByRole("textbox", { name: "Your intervention" })).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe("Consider a team of thirty engineers.");
  expect(browserSignal.aborted).toBe(false);
  expect(runDebateBrowserTurn).toHaveBeenCalledTimes(1);
  expect(debateApi.controlDebate).not.toHaveBeenCalled();
  expect(debateApi.createDebate).not.toHaveBeenCalled();
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
  await user.click(screen.getByRole("button", { name: "Tools" }));
  expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Read webpage" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Review context" }));
  await screen.findByText("Synthetic Focus context");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review context" })).toBeNull());
  expect(screen.getByRole("main").getAttribute("data-focus-mode")).toBe("true");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Chat tools" })).toBeNull());
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

test.each(["before opening", "during streaming"])("local Qwen starts and stops when internet is lost %s", async (offlineAt) => {
  Object.assign(fixture.profile, {
    id: "cove-local", kind: "local", name: "On this Mac",
    endpoint: "http://127.0.0.1", model_id: "qwen-small-chat",
    runtime_location: "On this Mac", destination: "This Mac",
  });
  fixture.models.splice(0, fixture.models.length, "qwen-small-chat");
  fixture.settings.active_model_set = [{ provider_id: "cove-local", model_id: "qwen-small-chat" }];
  for (const batch of [fixture.pendingBatch, fixture.completedBatch]) {
    for (const target of batch.targets) {
      target.provider_id = "cove-local";
      target.model_id = "qwen-small-chat";
      Object.assign(target.generation.snapshot, {
        provider_kind: "local", provider_id: "cove-local",
        provider_name: "On this Mac", model_id: "qwen-small-chat",
      });
    }
  }
  if (offlineAt === "before opening") onlineManager.setOnline(false);
  const { user } = await sendPrompt();
  await act(async () => feed.emit(0, "delta", "Synthetic offline answer"));
  await screen.findByText("Synthetic offline answer", { exact: true });
  if (offlineAt === "during streaming") {
    await act(async () => window.dispatchEvent(new Event("offline")));
  }
  vi.mocked(transport.cancelGenerationBatch).mockImplementation(async () => {
    feed.close();
    return { ...fixture.pendingBatch, state: "stopped" };
  });
  await user.click(screen.getByRole("button", { name: "Stop generation" }));
  await waitFor(() => expect(transport.cancelGenerationBatch).toHaveBeenCalledWith(fixture.pendingBatch.id));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Stop generation" })).toBeNull());
  expect(transport.createGenerationBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(transport.createGenerationBatch).mock.calls[0]?.[1]?.expectedTargets).toEqual([
    { provider_id: "cove-local", model_id: "qwen-small-chat", require_private_tee: false },
  ]);
  expect(onlineManager.isOnline()).toBe(false);
  expect(privateInference.generate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
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
        expect.objectContaining({ source: "browser", duration_ms: expect.any(Number) }),
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
        expect.objectContaining({ source: "browser", duration_ms: expect.any(Number) }),
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

test("Provider settings test the active chat connection when a similarly named connection comes first", async () => {
  configureNearAITarget(0, "private_tee");
  const production = {
    ...fixture.profile,
    name: "nearai",
    endpoint: "https://cloud-api.near.ai",
  };
  const staging = {
    ...fixture.profile,
    id: "nearai",
    kind: "nearai" as const,
    name: "NearAI",
    endpoint: "https://cloud-stg-api.near.ai",
  };
  vi.mocked(transport.getProviderProfiles).mockResolvedValue([
    production,
    staging,
  ]);
  vi.mocked(transport.testProviderConnection).mockResolvedValue({
    models: fixture.models,
  });

  const { user } = await openWorkspace();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: /Provider settings/ }));
  expect(
    (screen.getByRole("textbox", { name: "Endpoint" }) as HTMLInputElement).value,
  ).toBe(staging.endpoint);
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  await waitFor(() =>
    expect(vi.mocked(transport.testProviderConnection).mock.calls[0]?.[0]).toMatchObject({
      id: staging.id,
      kind: "nearai",
      endpoint: staging.endpoint,
    }),
  );
});

test("local model discovery is reachable from settings without starting generation", async () => {
  const { user, composer } = await openWorkspace();
  await user.type(composer, "Keep this draft");
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: "On this Mac" }));
  expect(screen.getByRole("tab", { name: "On this Mac" }).getAttribute("aria-selected")).toBe("true");
  const panel = document.getElementById("settings-local-models")!;
  await user.click(within(panel).getByRole("button",{name:"Discover"}));
  expect(within(panel).getAllByRole("article")).toHaveLength(14);
  await chooseOption(user,within(panel).getByRole("combobox", { name: "Task" }),"Write offline");
  await user.click(within(panel).getByRole("button", { name: "Installed" }));
  await user.click(within(panel).getByRole("button", { name: "Discover" }));
  expect(within(panel).getByRole("combobox", { name: "Task" }).textContent).toBe("Write offline");
  expect(within(panel).getByText("Qwen2.5 0.5B Instruct")).toBeTruthy();
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((composer as HTMLTextAreaElement).value).toBe("Keep this draft");
});

test.each(["Installed", "Discover"])("%s selects the requested local model and preserves the draft", async (view) => {
  const modelId = "qwen3-abliterated-chat";
  const name = "Qwen3 0.6B Abliterated Q5_K_M";
  const localProfile = { ...fixture.profile, id: "cove-local", kind: "local" as const, name: "On this Mac", endpoint: "http://127.0.0.1", configured: true };
  vi.mocked(transport.getProviderProfiles).mockResolvedValue([fixture.profile, localProfile]);
  vi.mocked(transport.getProviderCatalog).mockImplementation(async id => ({ models: id === "cove-local" ? ["qwen-small-chat", modelId] : fixture.models }));
  vi.mocked(transport.updateSettings).mockImplementation(async settings => settings);
  vi.spyOn(localApi, "getLocalModels").mockResolvedValue([{
    id: modelId, name, role: "chat", state: "installed", runtime_ready: true,
    bytes: 444415104, downloaded_bytes: 444415104, revision: "fixture", sha256: "a".repeat(64),
    runtime_version: "fixture", filename: "fixture.gguf", source_url: "https://example.test/model",
  }]);
  const { user, composer } = await openWorkspace();
  await user.type(composer, "Keep this local trial draft");
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: "On this Mac" }));
  const panel = document.getElementById("settings-local-models")!;
  if (view === "Discover") await user.click(within(panel).getByRole("button", { name: "Discover" }));
  const heading = await within(panel).findByText(name);
  await user.click(within(heading.closest("article")!).getByRole("button", { name: "Use in this chat" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(vi.mocked(transport.updateSettings).mock.calls.at(-1)![0].active_model_set).toEqual([{ provider_id: "cove-local", model_id: modelId }]);
  expect((composer as HTMLTextAreaElement).value).toBe("Keep this local trial draft");
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
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
        expect.objectContaining({ source: "browser", duration_ms: expect.any(Number) }),
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

test.each(["ordinary", "NearAI"])("webpages are previewed, included in context, and submitted through %s inference", async (mode) => {
  if (mode === "NearAI") {
    configureNearAITarget(0, "private_tee");
    fixture.pendingBatch.input_content = "Question plus authoritative saved webpage evidence";
  }
  const snapshot = {
    id: "c".repeat(64), name: "Research article.html", media_type: "text/html" as const,
    size: 100, characters: 22, extraction_version: "cove-web-readability-v1",
    sections: [{ id: "L1", text: "Saved webpage evidence" }],
    web: { original_url: "https://fixture.example/article", final_url: "https://fixture.example/article", fetched_at: "2026-11-20T08:00:00Z", content_sha256: "d".repeat(64) },
  };
  vi.mocked(transport.prepareWebSource).mockResolvedValue({ source_token: "web-source-token", snapshot });
  vi.mocked(transport.previewGenerationContext).mockResolvedValue([{ role: "user", content: "Question and saved webpage evidence" }]);
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Read https://fixture.example/article");
  await user.click(screen.getByRole("button", { name: "Read webpage" }));
  const dialog = screen.getByRole("dialog", { name: "Read webpage" });
  expect((within(dialog).getByRole("textbox", { name: "Webpage URL" }) as HTMLInputElement).value).toBe(snapshot.web.original_url);
  await user.click(within(dialog).getByRole("button", { name: "Read webpage" }));
  await user.click(await screen.findByRole("button", { name: /Preview extracted text/ }));
  expect(screen.getByRole("link", { name: "Open original webpage" }).getAttribute("href")).toBe(snapshot.web.final_url);
  expect(screen.getByText("Saved webpage evidence")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Review context" }));
  await screen.findByText("Question and saved webpage evidence");
  expect(transport.previewGenerationContext).toHaveBeenCalledWith(expect.objectContaining({ webSourceTokens: ["web-source-token"], attachments: [] }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(transport.createGenerationBatch).toHaveBeenCalledWith(fixture.conversation.id, expect.objectContaining({ webSourceTokens: ["web-source-token"], attachments: [] })));
  if (mode === "NearAI") {
    await waitFor(() => expect(privateInference.generate).toHaveBeenCalledWith(
      expect.objectContaining({ message: fixture.pendingBatch.input_content }),
      expect.any(AbortSignal), expect.any(Object),
    ));
  }
});

test("removing a webpage during download aborts the request and discards a late result", async () => {
  let complete!: (value: Awaited<ReturnType<typeof transport.prepareWebSource>>) => void;
  vi.mocked(transport.prepareWebSource).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const { user } = await openWorkspace();
  await user.click(screen.getByRole("button", { name: "Read webpage" }));
  const dialog = screen.getByRole("dialog", { name: "Read webpage" });
  await user.type(within(dialog).getByRole("textbox", { name: "Webpage URL" }), "https://fixture.example/slow");
  await user.click(within(dialog).getByRole("button", { name: "Read webpage" }));
  await screen.findByText("Reading webpage…");
  const signal = vi.mocked(transport.prepareWebSource).mock.calls[0]![1];
  await user.click(screen.getByRole("button", { name: "Remove attachment: https://fixture.example/slow" }));
  expect(signal.aborted).toBe(true);
  await act(async () => complete({ source_token: "late-token", snapshot: { id: "a".repeat(64), name: "Late page", media_type: "text/html", size: 1, characters: 1, extraction_version: "test", sections: [{ id: "L1", text: "Late result" }] } }));
  expect(screen.queryByText("Late page")).toBeNull();
  expect(transport.releaseWebSource).toHaveBeenCalledWith("late-token");
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

test("Gateway reasoning remains separate through streaming, settlement, and saved rendering", async () => {
  const generation = configureNearAITarget(0, "incognito");
  const saved = fixture.completedView.messages.find(message => message.role === "assistant")!;
  saved.body = "Synthetic private answer";
  saved.reasoning = "Plan the response without tags.";
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  privateInference.generate.mockImplementation(async function* (): AsyncGenerator<SecureInferenceEvent> {
    yield { type: "verifying_environment" };
    yield { type: "streaming" };
    yield { type: "reasoning", delta: saved.reasoning! };
    await pending;
    yield { type: "delta", delta: saved.body };
    yield { type: "response_ready", completionId: "synthetic-completion" };
    yield { type: "completed", verification: { status: "verified_gateway", signingKind: "gateway", completionId: "synthetic-completion" } };
  });
  const { composer, user } = await openWorkspace();
  await user.type(composer, "A reasoning fixture");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Plan the response without tags.");
  expect(screen.getByText("Reasoning", {exact:true}).closest("[data-reasoning]")?.getAttribute("data-state")).toBe("open");
  await act(async () => { finish(); });
  await waitFor(() => expect(transport.settleSecureGeneration).toHaveBeenCalledWith(
    generation.id, saved.body, expect.objectContaining({status:"verified_gateway"}),
    expect.objectContaining({source:"browser"}), saved.reasoning,
  ));
  await waitFor(() => expect(screen.getByText("Reasoning", {exact:true}).closest("[data-reasoning]")?.getAttribute("data-state")).toBe("closed"));
  expect(screen.getByText(saved.body, {exact:true})).toBeTruthy();
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
        expect.objectContaining({ source: "browser", duration_ms: expect.any(Number) }),
    ),
  );
});

test("editing a saved prompt runs selected models in a new branch and adopts its generation",async()=>{
 configureWorkspace(2);
 const source=structuredClone(fixture.completedView);
 const branchPending={...structuredClone(fixture.pendingBatch),id:"branch-batch",conversation_id:"branch-conversation",user_message_id:"branch-user",targets:[structuredClone(fixture.pendingBatch.targets[0]!)]};
 const branchCompleted={...structuredClone(fixture.completedBatch),id:branchPending.id,conversation_id:branchPending.conversation_id,user_message_id:branchPending.user_message_id,targets:[structuredClone(fixture.completedBatch.targets[0]!)]};
 const branchView={...source,id:branchPending.conversation_id,title:"Branch: First chat",branch:{source_conversation_id:source.id,source_batch_id:fixture.completedBatch.id,source_title:source.title},messages:[{...source.messages[0]!,id:branchPending.user_message_id,conversation_id:branchPending.conversation_id,body:"Edited question"}],generation_batches:[branchPending]};
 vi.mocked(transport.getConversation).mockImplementation(async id=>id===branchView.id?branchView:source);
 vi.mocked(transport.getConversations).mockResolvedValue([source,branchView]);
 vi.mocked(transport.createGenerationBatch).mockResolvedValue(branchPending);
 vi.mocked(transport.getGenerationBatch).mockResolvedValue(branchCompleted);
 feed.close();feed=createBatchEventFeed(branchPending);
 const {user}=await openWorkspace();
 await user.click(await screen.findByRole("button",{name:"Edit and resend"}));
 const edited=screen.getByRole("textbox",{name:"Edited prompt"});await user.clear(edited);await user.type(edited,"Edited question");
 await user.click(screen.getByRole("checkbox",{name:"Test Provider · model-two"}));
 await user.click(screen.getByRole("button",{name:"Send in new branch"}));
 await waitFor(()=>expect(transport.createGenerationBatch).toHaveBeenCalledWith(source.id,expect.objectContaining({body:"Edited question",editOfBatchId:fixture.completedBatch.id,expectedTargets:[{provider_id:fixture.profile.id,model_id:"model-one",require_private_tee:false}]})));
 await screen.findByText(/Branch of First chat/);
 expect(screen.getByRole("button",{name:"Stop generation"})).toBeTruthy();
 expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();
 await act(async()=>{feed.emit(0,"delta","Branch answer");});
 await screen.findByText("Branch answer",{exact:true});
 expect(source.messages[0]!.body).not.toBe("Edited question");
});

test("a rejected edited submission keeps its editor and branch intent for another attempt",async()=>{
 vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
 vi.mocked(transport.createGenerationBatch).mockRejectedValue(new transport.LocalServiceError({error:{code:"generation_selection_changed",message:"Selection changed",details:null,request_id:"fixture"}}));
 const {user}=await openWorkspace();await user.click(await screen.findByRole("button",{name:"Edit and resend"}));
 const text=screen.getByRole("textbox",{name:"Edited prompt"});await user.clear(text);await user.type(text,"Keep this edited question");
 await user.click(screen.getByRole("button",{name:"Send in new branch"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Send in new branch"}).hasAttribute("disabled")).toBe(false));
 expect(screen.getByRole("dialog",{name:"Edit prompt and branch"})).toBeTruthy();
 expect((screen.getByRole("textbox",{name:"Edited prompt"}) as HTMLTextAreaElement).value).toBe("Keep this edited question");
 expect((document.querySelector('#generation-input') as HTMLTextAreaElement).value).toBe("");
 const call=vi.mocked(transport.createGenerationBatch).mock.calls[0]!;
 expect(call[1].editOfBatchId).toBe(fixture.completedBatch.id);
});

test("a newly created private branch is owned by this window and is not cancelled as restored work",async()=>{
 configureNearAITarget(0,"incognito");
 const source=fixture.completedView;
 const branchBatch={...fixture.pendingBatch,id:"private-branch-batch",conversation_id:"private-branch"};
 const completed={...fixture.completedBatch,id:branchBatch.id,conversation_id:branchBatch.conversation_id};
 const branch={...source,id:branchBatch.conversation_id,title:"Private branch",messages:[{...source.messages[0]!,id:branchBatch.user_message_id!,conversation_id:branchBatch.conversation_id,body:"Edited private question"}],generation_batches:[branchBatch],active_generation_batch:branchBatch,branch:{source_conversation_id:source.id,source_batch_id:fixture.completedBatch.id,source_title:source.title}};
 vi.mocked(transport.getConversation).mockImplementation(async id=>id===branch.id?branch:source);
 vi.mocked(transport.getConversations).mockResolvedValue([source,branch]);
 vi.mocked(transport.createGenerationBatch).mockResolvedValue(branchBatch);
 vi.mocked(transport.getGenerationBatch).mockResolvedValue(completed);
 const {user}=await openWorkspace();await user.click(await screen.findByRole("button",{name:"Edit and resend"}));
 const text=screen.getByRole("textbox",{name:"Edited prompt"});await user.clear(text);await user.type(text,"Edited private question");
 await user.click(screen.getByRole("button",{name:"Send in new branch"}));
 await waitFor(()=>expect(transport.settleSecureGeneration).toHaveBeenCalled());
 expect(privateInference.generate).toHaveBeenCalledWith(expect.objectContaining({message:"Edited private question"}),expect.any(AbortSignal),expect.any(Object));
 expect(transport.cancelGeneration).not.toHaveBeenCalled();
 expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();
 expect(transport.getGenerationBatchContext).toHaveBeenCalledWith(branchBatch.id);
});

test("a second workspace observes a running private generation without cancelling it", async () => {
  configureNearAITarget(0, "private_tee");
  vi.mocked(transport.getConversation).mockResolvedValue({
    ...fixture.conversation,
    messages: [fixture.completedView.messages[0]!],
    active_generation_batch: fixture.pendingBatch,
  });
  await openWorkspace();
  await waitFor(() => expect(transport.subscribeGenerationBatch).toHaveBeenCalledWith(fixture.pendingBatch.id));
  expect(screen.getByRole("button", { name: "Stop generation" })).toBeTruthy();
  expect(transport.cancelGeneration).not.toHaveBeenCalled();
  expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();
  expect(privateInference.generate).not.toHaveBeenCalled();
});

test("Quick Panel prewarms without catalog reads and keeps a pasted draft and dropped file through first send", async () => {
  const postMessage = vi.fn();
  vi.stubGlobal("webkit", { messageHandlers: { coveQuickPanel: { postMessage } } });
  window.history.replaceState(null, "", "/?surface=quick-panel");
  vi.mocked(transport.createConversation).mockResolvedValue(fixture.conversation);
  vi.mocked(transport.previewAttachment).mockResolvedValue({
    id: "a".repeat(64), name: "draft.txt", media_type: "text/plain", size: 6, characters: 6,
    extraction_version: "cove-text-v1", sections: [{ id: "L1", text: "Source" }],
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
  const panel = screen.getByRole("main", { name: "Cove Quick Panel" });
  const composer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Send message" });
  expect(document.activeElement).toBe(composer);
  expect(screen.queryByRole("button", { name: "Continue in Cove" })).toBeNull();
  expect(postMessage).toHaveBeenCalledWith({ action: "ready" });
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ action: "resize", height: 148 }));
  await waitFor(() => expect(transport.getSettings).toHaveBeenCalled());
  expect(transport.getProviderCatalog).not.toHaveBeenCalled();
  expect(transport.getConversations).not.toHaveBeenCalled();

  act(() => { window.dispatchEvent(new Event("cove-quick-panel-focus")); });
  await user.paste("Explain this source");
  fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files: [new File(["Source"], "draft.txt")] } });
  await screen.findByRole("button", { name: /Preview extracted text/ });
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ action: "resize", height: 224 }));
  await user.keyboard("{Escape}");
  expect(postMessage).toHaveBeenCalledWith({ action: "escape" });
  composer.blur();
  act(() => { window.dispatchEvent(new Event("cove-quick-panel-focus")); });
  expect(document.activeElement).toBe(composer);
  expect(composer.value).toBe("Explain this source");
  expect(transport.createConversation).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Model · model-one" }));
  await screen.findByRole("dialog", { name: "Active Model Set" });
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ action: "resize", height: 544 }));
  postMessage.mockClear();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Active Model Set" })).toBeNull());
  expect(postMessage).not.toHaveBeenCalledWith({ action: "escape" });
  act(() => { window.dispatchEvent(new Event("cove-quick-panel-focus")); });

  await user.keyboard("{Enter}");
  await waitFor(() => expect(transport.createGenerationBatch).toHaveBeenCalledWith(
    fixture.conversation.id,
    expect.objectContaining({ body: "Explain this source", attachments: [expect.objectContaining({ name: "draft.txt" })] }),
  ));
  expect(transport.createConversation).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Continue in Cove" })).toBeNull();
  await waitFor(() => expect(transport.subscribeGenerationBatch).toHaveBeenCalled());
  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  await act(async () => { feed.close(); });
  const continuation = await screen.findByRole("button", { name: "Continue in Cove" });
  await user.type(composer, "Keep my follow-up");
  await user.click(continuation);
  expect(postMessage).toHaveBeenCalledWith({ action: "open-chat", conversationId: fixture.conversation.id });
  expect(composer.value).toBe("Keep my follow-up");

  await user.click(screen.getByRole("button", { name: "New chat" }));
  const confirmation = await screen.findByRole("dialog", { name: "Discard unsent draft?" });
  await user.click(within(confirmation).getByRole("button", { name: "Discard and continue" }));
  expect(composer.value).toBe("");
  expect(transport.createConversation).toHaveBeenCalledTimes(1);
});

test("Quick Panel groups extra tools, restores menu focus, and shows the local-only restriction", async () => {
  const postMessage = vi.fn();
  vi.stubGlobal("webkit", { messageHandlers: { coveQuickPanel: { postMessage } } });
  window.history.replaceState(null, "", "/?surface=quick-panel");
  const user = userEvent.setup();
  render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
  act(() => { window.dispatchEvent(new Event("cove-quick-panel-focus")); });

  const tools = screen.getByRole<HTMLButtonElement>("button", { name: "Tools" });
  await waitFor(() => expect(tools.disabled).toBe(false));
  expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Read webpage" })).toBeNull();
  expect(await screen.findByText("Send to Test Provider")).toBeTruthy();

  tools.focus();
  await user.keyboard("{Enter}");
  const menu = await screen.findByRole("menu");
  const webpage = within(menu).getByRole("menuitem", { name: "Read webpage" });
  expect(within(menu).getByRole("menuitem", { name: "Search local documents" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(webpage));
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", { name: "Read webpage" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(tools));
  expect(postMessage).not.toHaveBeenCalledWith({ action: "escape" });

  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitemcheckbox", { name: "Only on this Mac" }));
  expect(await screen.findByText("Only on this Mac")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/Choose an installed local chat model/);
  await user.click(tools);
  const blockedWebpage = await screen.findByRole("menuitem", { name: "Read webpage" });
  expect(blockedWebpage.getAttribute("aria-disabled")).toBe("true");
  await user.keyboard("{Escape}");
  expect(postMessage).not.toHaveBeenCalledWith({ action: "escape" });
});

test("Quick Panel imports and appends macOS text selections without sending them", async () => {
  const textId = "00000000-0000-0000-0000-000000000001";
  const followUpId = "00000000-0000-0000-0000-000000000002";
  const selection = "\u4e2d\u6587\nSelection";
  const followUp = "More selected text";
  const deliver = (id: string, text: string) =>
    window.dispatchEvent(new CustomEvent(quickPanelImportEvent, { cancelable: true, detail: { id, text } }));
  const postMessage = vi.fn(({ action }) => {
    if (action === "ready") expect(deliver(textId, selection)).toBe(false);
  });
  vi.stubGlobal("webkit", { messageHandlers: { coveQuickPanel: { postMessage } } });
  window.history.replaceState(null, "", "/?surface=quick-panel");
  const user = userEvent.setup();
  render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
  act(() => { window.dispatchEvent(new Event(quickPanelFocusEvent)); });
  const composer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Send message" });
  await waitFor(() => expect(composer.value).toBe(selection));
  expect(postMessage).toHaveBeenCalledWith({ action: "import-received", id: textId });
  act(() => { deliver(textId, selection); });
  expect(screen.queryByRole("region", { name: "Content from macOS" })).toBeNull();

  const oversizedId = "00000000-0000-0000-0000-000000000003";
  act(() => { deliver(oversizedId, "\u4e2d".repeat(20_001)); });
  expect(postMessage).toHaveBeenCalledWith({ action: "import-rejected", id: oversizedId });
  expect(composer.value).toBe(selection);

  act(() => { deliver(followUpId, followUp); });
  const review = screen.getByRole("region", { name: "Content from macOS" });
  expect(within(review).getByText(followUp)).toBeTruthy();
  expect(composer.value).toBe(selection);
  await user.click(within(review).getByRole("button", { name: "Add to Current Draft" }));
  expect(composer.value).toBe(`${selection}\n\n${followUp}`);
  expect(transport.createConversation).not.toHaveBeenCalled();
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});

test("Quick Panel stages macOS selections during generation and can start a separate draft", async () => {
  window.history.replaceState(null, "", "/?surface=quick-panel");
  vi.mocked(transport.createConversation).mockResolvedValue(fixture.conversation);
  const user = userEvent.setup();
  render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
  act(() => { window.dispatchEvent(new Event(quickPanelFocusEvent)); });
  const composer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Send message" });
  await user.type(composer, "Original request");
  const send = screen.getByRole<HTMLButtonElement>("button", { name: "Send message" });
  await waitFor(() => expect(send.disabled).toBe(false));
  await user.click(send);
  await waitFor(() => expect(transport.subscribeGenerationBatch).toHaveBeenCalled());
  fireEvent.change(composer, { target: { value: "Unsent follow-up" } });

  const publish = (suffix: string, text: string) => {
    act(() => {
      window.dispatchEvent(new CustomEvent(quickPanelImportEvent, {
        detail: { id: `00000000-0000-0000-0000-00000000000${suffix}`, text },
      }));
    });
  };
  publish("1", "Dismiss this selection");
  const add = screen.getByRole<HTMLButtonElement>("button", { name: "Add to Current Draft" });
  const startNew = screen.getByRole<HTMLButtonElement>("button", { name: "Start New Draft" });
  expect(add.disabled).toBe(true);
  expect(startNew.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(composer.value).toBe("Unsent follow-up");

  fireEvent.change(composer, { target: { value: "" } });
  publish("2", "Use this separately");
  publish("3", "Keep this import waiting for review");
  vi.mocked(transport.getConversation).mockResolvedValue(fixture.completedView);
  await act(async () => { feed.close(); });
  const newDraft = screen.getByRole<HTMLButtonElement>("button", { name: "Start New Draft" });
  await waitFor(() => expect(newDraft.disabled).toBe(false));
  await user.click(newDraft);
  expect(composer.value).toBe("Use this separately");
  expect(screen.getByText("Keep this import waiting for review")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue in Cove" })).toBeNull();
  expect(transport.cancelGenerationBatch).not.toHaveBeenCalled();
  expect(transport.createConversation).toHaveBeenCalledTimes(1);
  expect(transport.createGenerationBatch).toHaveBeenCalledTimes(1);
});

test("saved model combinations restore the entire model set through the workspace controls",async()=>{
 configureWorkspace(2);
 vi.mocked(transport.updateSettings).mockImplementation(async settings=>settings);
 const {user}=await openWorkspace();
 await user.click(screen.getByRole("button",{name:"Model comparison, 2 / 4"}));
 await user.type(screen.getByRole("textbox",{name:"Combination name"}),"Review pair");
 await user.click(screen.getByRole("button",{name:"Save combination"}));
 await screen.findByRole("button",{name:"Review pair · 2"});
 await user.click(screen.getByRole("button",{name:"Remove model: Test Provider model-two"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Model comparison, 1 / 4"})).toBeTruthy());
 await user.click(screen.getByRole("button",{name:"Review pair · 2"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Model comparison, 2 / 4"})).toBeTruthy());
 expect(vi.mocked(transport.updateSettings).mock.calls.at(-1)![0].active_model_set).toHaveLength(2);
});


function mountWorkspaceController() {
  return renderHook(() => useChatWorkspace(), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

test.each(["stop", "load failure"] as const)("an accepted private branch remains owned through %s during adoption", async action => {
  configureNearAITarget(0, "incognito");
  const source = fixture.completedView;
  const branchBatch = { ...fixture.pendingBatch, id: "adopting-branch-batch", conversation_id: "adopting-branch" };
  const branch = { ...source, id: branchBatch.conversation_id, generation_batches: [branchBatch], active_generation_batch: branchBatch };
  let resolveView!: (value: typeof branch) => void;
  let rejectView!: (reason: Error) => void;
  const loading = new Promise<typeof branch>((resolve, reject) => { resolveView = resolve; rejectView = reject; });
  vi.mocked(transport.getConversation).mockImplementation(id => id === branch.id ? loading : Promise.resolve(source));
  vi.mocked(transport.createGenerationBatch).mockResolvedValue(branchBatch);
  vi.mocked(transport.cancelGenerationBatch).mockResolvedValue({ ...branchBatch, state: "stopped" });
  const { result } = mountWorkspaceController();
  await waitFor(() => expect(result.current.selectionStatus).toBe("ready"));
  let sending!: Promise<void>;
  act(() => { sending = result.current.handleSend({ body: "Edited private question", editOfBatchId: fixture.completedBatch.id }); });
  await waitFor(() => expect(transport.getConversation).toHaveBeenCalledWith(branch.id));
  expect(result.current.generationBatch?.id).toBe(branchBatch.id);
  if (action === "stop") {
    await act(async () => { expect(await result.current.handleCancel()).toBe(true); });
    expect(transport.cancelGenerationBatch).toHaveBeenCalledWith(branchBatch.id);
    await act(async () => { resolveView(branch); await sending; });
  } else {
    await act(async () => { rejectView(new Error("Synthetic branch read failure")); await sending; });
  }
  expect(transport.cancelGenerationBatch).toHaveBeenCalledWith(branchBatch.id);
  expect(privateInference.generate).not.toHaveBeenCalled();
  expect(result.current.isSending).toBe(false);
});

test("partial private usage events retain both token counts, including zero", async () => {
  configureNearAITarget(0, "incognito");
  privateInference.generate.mockImplementation(async function* (): AsyncGenerator<SecureInferenceEvent> {
    yield { type: "streaming" };
    yield { type: "usage", inputTokens: 128 };
    yield { type: "usage", outputTokens: 32 };
    yield { type: "usage", inputTokens: 0 };
    yield { type: "delta", delta: "Usage fixture" };
    yield { type: "completed", verification: { status: "verified_gateway", signingKind: "gateway" } };
  });
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Count usage");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(transport.settleSecureGeneration).toHaveBeenCalledWith(
    fixture.pendingBatch.targets[0]!.generation.id, "Usage fixture", expect.any(Object),
    expect.objectContaining({ input_tokens: 0, output_tokens: 32 }),
  ));
});

test("clearing chat data blocks new answer tools requests while deletion is pending", async () => {
  let finishClear!: () => void;
  vi.mocked(transport.clearChatData).mockImplementation(() => new Promise<void>(resolve => { finishClear = resolve; }));
  const { result } = mountWorkspaceController();
  await waitFor(() => expect(result.current.selectionStatus).toBe("ready"));
  const source = { messageId: "answer", conversationId: fixture.conversation.id, body: "Source answer" };
  act(() => {
    result.current.answerTools.openAsk(source, "Source", "Explain");
    result.current.answerTools.openEditor(source);
  });
  act(() => result.current.answerTools.setRevisionInstruction("Simplify"));
  let clearing!: Promise<unknown>;
  act(() => { clearing = result.current.clearConfirmedChatData(); });
  await waitFor(() => expect(transport.clearChatData).toHaveBeenCalled());
  expect(result.current.answerTools.externalBusy).toBe(true);
  act(() => {
    result.current.answerTools.openAsk({ ...source, messageId: "new-answer" }, "New");
    result.current.answerTools.openEditor({ ...source, messageId: "new-answer" });
  });
  expect(result.current.answerTools.source?.messageId).toBe("answer");
  expect(result.current.answerTools.documentSource?.messageId).toBe("answer");
  await act(async () => {
    await result.current.answerTools.sendQuestion();
    await result.current.answerTools.requestRevision();
  });
  expect(transport.createConversation).not.toHaveBeenCalled();
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
  await act(async () => { finishClear(); await clearing; });
  expect(result.current.answerTools.open).toBe(false);
});


test("a side conversation keeps the quoted answer's project origin after navigating elsewhere", async () => {
  const { result } = renderHook(() => useChatWorkspace(), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.conversationView?.id).toBe(fixture.conversation.id));
  const source = {messageId:"source-answer", conversationId: fixture.conversation.id, body:"Original project excerpt"};
  act(() => result.current.answerTools.openAsk(source,"Original project excerpt","Explain"));
  act(() => result.current.setSelectedId(fixture.secondConversation.id));
  await waitFor(() => expect(result.current.conversationView?.id).toBe(fixture.secondConversation.id));
  feed.close();
  await act(async () => { await result.current.answerTools.sendQuestion(); });
  expect(transport.createConversation).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({source_conversation_id: source.conversationId}));
  expect(transport.createConversation).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({source_conversation_id: fixture.secondConversation.id}));
});

test.each(["private_tee", "incognito"] as const)("%s inference uses the server's frozen project fragments once", async mode => {
  configureNearAITarget(0, mode);
  const project = {project_id:"project-original",project_revision:2,membership_revision:1,project_name:"Saved project",rendering_version:1,instructions:"Saved project rule",background:"Saved project facts",reference_prefix:'Project reference data: {"background":"Saved project facts"}\nCurrent user question:\n',sources:[]};
  fixture.pendingBatch.project_context = {...project, instructions:"Stale local fragment",reference_prefix:"Stale local prefix"};
  fixture.pendingBatch.input_content = "Question with frozen turn attachment";
  const history = [{role:"user" as const,content:"Prior question without project input"},{role:"assistant" as const,content:"Prior selected answer"}];
  const read = vi.mocked(transport.getProjectBatchContext).mockResolvedValue({history,project_context:project});
  const {composer,user} = await openWorkspace();
  await user.type(composer,"Visible question");
  await user.click(screen.getByRole("button",{name:"Send message"}));
  await waitFor(() => expect(privateInference.generate).toHaveBeenCalled());
  const input = privateInference.generate.mock.calls[0]?.[0];
  expect(read).toHaveBeenCalledWith(fixture.pendingBatch.id);
  expect(input.context).toEqual(history);
  const base = fixture.pendingBatch.targets[0]!.generation.configuration_snapshot.system_prompt;
  expect(input.configuration.systemPrompt).toBe(base ? base+"\n\nProject instructions:\n"+project.instructions : project.instructions);
  expect(input.message).toBe(project.reference_prefix + fixture.pendingBatch.input_content);
  expect(input.message).not.toContain("Stale local prefix");
  expect(transport.getGenerationBatchContext).not.toHaveBeenCalled();
});

test("a missing required project snapshot prevents NearAI inference", async () => {
  configureNearAITarget(0,"private_tee");
  fixture.pendingBatch.project_context = {project_id:"project",project_revision:1,membership_revision:0,project_name:"Project",rendering_version:1,instructions:"Saved rule",background:"",reference_prefix:"",sources:[]};
  vi.mocked(transport.getProjectBatchContext).mockResolvedValue({history:[],project_context:null});
  const {composer,user} = await openWorkspace();
  await user.type(composer,"Question");
  await user.click(screen.getByRole("button",{name:"Send message"}));
  await waitFor(() => expect(transport.settleSecureGeneration).toHaveBeenCalled());
  expect(privateInference.generate).not.toHaveBeenCalled();
});

test("a project conflict preserves the draft and files even when refreshing context fails", async () => {
  vi.mocked(transport.previewAttachment).mockResolvedValue({
    id: "f".repeat(64), name: "draft.md", media_type: "text/plain", size: 6, characters: 6,
    extraction_version: "cove-text-v1", sections: [{ id: "L1", text: "Source" }],
  });
  const { composer, user } = await openWorkspace();
  await user.type(composer, "Keep the project draft");
  await user.upload(screen.getByLabelText("Attach files"), new File(["Source"], "draft.md"));
  await screen.findByRole("button", { name: /Preview extracted text/ });
  vi.mocked(transport.createGenerationBatch).mockRejectedValue(new transport.LocalServiceError({error:{code:"project_context_changed",message:"Project context changed. Review before sending again.",details:null,request_id:"local"}}));
  vi.mocked(transport.getConversation).mockRejectedValueOnce(new Error("Context refresh failed"));
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Stop generation" })).toBeNull());
  expect((composer as HTMLTextAreaElement).value).toBe("Keep the project draft");
  expect(screen.getByRole("button", { name: "Remove attachment: draft.md" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(false);
  await screen.findByText("Project context changed, but refreshed context could not be loaded. Your draft and attachments are preserved. Review context before sending again.");
  expect(transport.createGenerationBatch).toHaveBeenCalledTimes(1);
});


function projectNavigationFixture() {
  const p:import("@cove/api-contract").Project={id:"research-project",name:"Research project",description:"Reusable background",instructions:"Project instruction",background:"Project background",revision:1,sources:[],membership_token: "a".repeat(64), conversation_count:1,historical_copies:0,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"};
  Object.assign(fixture.conversation,{project_id:p.id,project_revision:1,membership_revision:1});
  vi.spyOn(projectApi,"getProjects").mockResolvedValue([p]);
  vi.spyOn(projectApi,"getProject").mockResolvedValue(p);
  vi.mocked(transport.getConversations).mockImplementation(async options=>options?.archived?[]:options?.projectId?[fixture.conversation]:[fixture.conversation,fixture.secondConversation]);
  const created={...fixture.secondConversation,id:"created-conversation"};
  vi.mocked(transport.getConversation).mockImplementation(async id=>id===created.id?created:id===fixture.secondConversation.id?fixture.secondConversation:fixture.conversation);
  return {p,created};
}

test("Projects is a separate page, preserves a draft, and global New chat stays ungrouped", async()=>{
  const {p}=projectNavigationFixture();
  const {composer,user}=await openWorkspace();
  expect(screen.queryByRole("combobox",{name:"History project"})).toBeNull();
  expect(screen.queryByRole("combobox",{name:"Move conversation to project"})).toBeNull();
  expect(projectApi.getProjects).not.toHaveBeenCalled();
  await user.type(composer,"Keep the ordinary draft");
  await user.click(screen.getByRole("button",{name:"Projects"}));
  expect(await screen.findByRole("heading",{name:"Projects"})).toBeTruthy();
  expect(await screen.findByRole("button",{name:`Open project ${p.name}`})).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"Back to chat"}));
  expect((screen.getByRole("textbox",{name:"Send message"}) as HTMLTextAreaElement).value).toBe("Keep the ordinary draft");
  await user.clear(screen.getByRole("textbox",{name:"Send message"}));
  await user.click(screen.getByRole("button",{name:"Projects"}));
  await user.click(screen.getByRole("button",{name:"New conversation"}));
  await waitFor(()=>expect(transport.createConversation).toHaveBeenCalledWith(undefined));
  await waitFor(()=>expect(screen.queryByRole("heading",{name:"Projects"})).toBeNull());
});

test("project-page New chat opts into its project and retains that choice through draft confirmation",async()=>{
  const {p,created}=projectNavigationFixture();
  Object.assign(created,{project_id:p.id,project_revision:1,membership_revision:0});
  vi.mocked(transport.createConversation).mockResolvedValue(created);
  const {composer,user}=await openWorkspace();
  await user.type(composer,"Keep until confirmed");
  await user.click(screen.getByRole("button",{name:"Projects"}));
  await user.click(await screen.findByRole("button",{name:`Open project ${p.name}`}));
  expect(await screen.findByRole("complementary",{name:"Project background and materials"})).toBeTruthy();
  await user.type(screen.getByRole("textbox", {name:"New project chat draft"}), "A new project question");
  await user.click(screen.getByRole("button",{name:"New chat in project"}));
  const first=await screen.findByRole("dialog");
  await user.click(within(first).getByRole("button",{name:"Stay"}));
  expect(transport.createConversation).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox", {name:"New project chat draft"}) as HTMLTextAreaElement).value).toBe("A new project question");
  await user.click(screen.getByRole("button",{name:"New chat in project"}));
  const second=await screen.findByRole("dialog");
  await user.click(within(second).getByRole("button",{name:"Discard and continue"}));
  await waitFor(()=>expect(transport.createConversation).toHaveBeenCalledWith(undefined,{project_id:p.id}));
  await waitFor(()=>expect(screen.queryByRole("complementary",{name:"Project background and materials"})).toBeNull());
  await waitFor(()=>expect((screen.getByRole("textbox",{name:"Send message"}) as HTMLTextAreaElement).value).toBe("A new project question"));
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});


test("project cards expose deletion directly and cancel keeps the project", async () => {
  const {p} = projectNavigationFixture();
  const remove = vi.spyOn(projectApi, "deleteProject").mockResolvedValue(undefined);
  const {user} = await openWorkspace();
  await user.click(screen.getByRole("button", {name: "Projects"}));
  await user.click(await screen.findByRole("button", {name: `Project actions: ${p.name}`}));
  await user.click(screen.getByRole("menuitem", {name: "Delete project"}));
  expect(await screen.findByRole("dialog", {name: "Delete project"})).toBeTruthy();
  expect(screen.queryByRole("textbox", {name: "Project name"})).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", {name: "Cancel removal"}));
  expect(screen.getByRole("button", {name: `Open project ${p.name}`})).toBeTruthy();
  expect(remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", {name: `Project actions: ${p.name}`}));
  await user.click(screen.getByRole("menuitem", {name: "Delete project"}));
  vi.mocked(projectApi.getProjects).mockResolvedValue([]);
  await user.click(screen.getByRole("button", {name: "Confirm deletion"}));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(p.id, p.revision, true, p.membership_token));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(screen.queryByRole("button", {name: `Open project ${p.name}`})).toBeNull());
});

test("ordinary history and search exclude project chats while project home retains them", async () => {
  const {p} = projectNavigationFixture();
  const {user} = await openWorkspace();
  const sidebar = document.querySelector("#conversation-sidebar")! as HTMLElement;
  expect(within(sidebar).queryByRole("button", {name: fixture.conversation.title})).toBeNull();
  expect(within(sidebar).getByRole("button", {name: fixture.secondConversation.title})).toBeTruthy();
  vi.mocked(transport.searchConversations).mockResolvedValue([
    {...fixture.conversation, message_id:"match-project",role:"user",excerpt:"Matching project text"},
    {...fixture.secondConversation, message_id:"match-ordinary",role:"user",excerpt:"Matching ordinary text"},
  ]);
  await user.type(within(sidebar).getByRole("textbox", {name:"Search conversations"}), "Matching");
  await waitFor(() => expect(transport.searchConversations).toHaveBeenLastCalledWith("Matching", false, expect.any(AbortSignal), expect.objectContaining({projectId:""})));
  await waitFor(() => expect(within(sidebar).queryByText("Matching project text", {exact:false})).toBeNull());
  expect(await within(sidebar).findByText(/Matching ordinary text/)).toBeTruthy();
  await user.click(screen.getByRole("button", {name: "Projects"}));
  await user.click(await screen.findByRole("button", {name: `Open project ${p.name}`}));
  const chats = await screen.findByRole("region", {name:"Project chats"});
  expect(await within(chats).findByTitle(fixture.conversation.title)).toBeTruthy();
});


test.each(["delete", "archive"] as const)("%s of the selected project chat keeps its project home open", async action => {
  const {p} = projectNavigationFixture();
  const {result} = mountWorkspaceController();
  await waitFor(() => expect(result.current.selectedId).toBe(fixture.secondConversation.id));
  expect(transport.getConversation).not.toHaveBeenCalledWith(fixture.conversation.id);
  await act(async () => { await result.current.handleSelectConversation(fixture.conversation.id); });
  await waitFor(() => expect(result.current.conversationView?.id).toBe(fixture.conversation.id));
  act(() => result.current.setProjectPage({projectId:p.id}));
  const hidden = {...fixture.conversation,id:"other-project-chat",project_id:"other-project"};
  vi.mocked(transport.getConversations).mockResolvedValue([hidden,fixture.secondConversation]);
  vi.spyOn(transport, "deleteConversation").mockResolvedValue(undefined);
  vi.mocked(transport.updateConversation).mockResolvedValue(undefined);
  if (action === "archive") {
    await act(async () => { await result.current.handleUpdateConversation(fixture.conversation.id,{archived:true}); });
  } else {
    act(() => result.current.handleDeleteConversation(fixture.conversation.id));
    await act(async () => { await result.current.confirmRequestedAction(); });
  }
  await waitFor(() => expect(result.current.selectedId).toBe(fixture.secondConversation.id));
  expect(result.current.projectPage).toEqual({projectId:p.id});
  expect(transport.getConversation).not.toHaveBeenCalledWith(hidden.id);
  await act(async () => { await result.current.handleSelectConversation(fixture.secondConversation.id); });
  expect(result.current.projectPage).toBeUndefined();
});

test.each(["startup", "delete", "archive", "archived view"] as const)("%s selects no chat when only project chats are available", async action => {
  projectNavigationFixture();
  if (action === "startup") vi.mocked(transport.getConversations).mockResolvedValue([fixture.conversation]);
  const {result} = mountWorkspaceController();
  await waitFor(() => expect(result.current.connection).toBe("ready"));
  if (action !== "startup") {
    await waitFor(() => expect(result.current.selectedId).toBe(fixture.secondConversation.id));
    vi.mocked(transport.getConversations).mockResolvedValue([fixture.conversation]);
    if (action === "archived view") await act(async () => { await result.current.handleConversationListMode(true); });
    if (action === "archive") {
      vi.mocked(transport.updateConversation).mockResolvedValue(undefined);
      await act(async () => { await result.current.handleUpdateConversation(fixture.secondConversation.id,{archived:true}); });
    }
    if (action === "delete") {
      vi.spyOn(transport,"deleteConversation").mockResolvedValue(undefined);
      act(() => result.current.handleDeleteConversation(fixture.secondConversation.id));
      await act(async () => { await result.current.confirmRequestedAction(); });
    }
  }
  await waitFor(() => expect(result.current.selectedId).toBeUndefined());
  expect(transport.getConversation).not.toHaveBeenCalledWith(fixture.conversation.id);
});


test("project chat pinning moves an older chat first and unpinning restores recency order", async () => {
  const {p} = projectNavigationFixture();
  let pinned = false;
  const older = {...fixture.secondConversation,id:"older-project-chat",project_id:p.id,updated_at:"2020-01-01T00:00:00Z"};
  vi.mocked(transport.getConversations).mockImplementation(async options => options?.archived ? [] : options?.projectId ? [fixture.conversation,{...older,pinned}] : [fixture.conversation,fixture.secondConversation]);
  vi.mocked(transport.updateConversation).mockImplementation(async (_id,input) => { pinned = !!input.pinned; });
  const {user} = await openWorkspace();
  await user.click(screen.getByRole("button",{name:"Projects"}));
  await user.click(await screen.findByRole("button",{name:`Open project ${p.name}`}));
  const chats = await screen.findByRole("region",{name:"Project chats"});
  await within(chats).findByTitle(older.title);
  const titles = () => [...chats.querySelectorAll("button[title]")].map(row => row.getAttribute("title"));
  expect(titles()).toEqual([fixture.conversation.title,older.title]);
  await user.click(within(chats).getByRole("button",{name:`Conversation actions: ${older.title}`}));
  await user.click(screen.getByRole("menuitem",{name:"Pin"}));
  await waitFor(() => expect(titles()[0]).toBe(older.title));
  expect(within(chats).getByLabelText("Pinned conversation")).toBeTruthy();
  await user.click(within(chats).getByRole("button",{name:`Conversation actions: ${older.title}`}));
  await user.click(screen.getByRole("menuitem",{name:"Unpin"}));
  await waitFor(() => expect(titles()).toEqual([fixture.conversation.title,older.title]));
});

test.each(["success", "failure"])("project draft continuation locks edits and preserves attachments on %s", async outcome => {
 const {created} = projectNavigationFixture();
 let settle!: (value: typeof created) => void;
 let reject!: (error: Error) => void;
 vi.mocked(transport.createConversation).mockReturnValue(new Promise((resolve, r)=>{settle=resolve;reject=r;}));
 const {result}=mountWorkspaceController();
 await waitFor(()=>expect(result.current.conversationView).toBeTruthy());
 act(()=>result.current.setDraft("Preserved continuation draft"));
 const attachment: import("@/hooks/chat/use-attachment-draft").DraftAttachment={key:"local-file",name:"draft.md",input:{name:"draft.md",data:"Zml4dHVyZQ=="},snapshot:{id:"source",name:"draft.md",media_type:"text/plain",size:7,characters:7,extraction_version:"fixture-v1",sections:[{id:"L1",text:"fixture"}]}};
 act(()=>result.current.attachmentDraft.restoreAttachments([attachment]));
 let continuing!: Promise<string | undefined>;
 act(()=>{continuing=result.current.continueProjectDraft();});
 await waitFor(()=>expect(result.current.isNavigating).toBe(true));
 await act(async()=>{await result.current.continueProjectDraft();});
 expect(transport.createConversation).toHaveBeenCalledOnce();
 expect(result.current.draft).toBe("Preserved continuation draft");
 expect(result.current.attachmentDraft.attachments).toHaveLength(1);
 await act(async()=>{if(outcome==="success")settle(created);else reject(new Error("Creation failed"));await continuing;});
 await waitFor(()=>expect(result.current.isNavigating).toBe(false));
 expect(result.current.draft).toBe("Preserved continuation draft");
 expect(result.current.attachmentDraft.attachments).toEqual([attachment]);
 if(outcome==="success")expect(result.current.selectedId).toBe(created.id);
 expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});

test("project search opens the matching historical turn", async()=>{
 const {p}=projectNavigationFixture();
 vi.spyOn(conversationApi,"searchConversations").mockImplementation(async(_query,archived)=>archived?[]:[{...fixture.conversation,message_id:"older-answer",turn_message_id:"older-user",excerpt:"Matching historical answer",role:"assistant" as const}]);
 const {result}=mountWorkspaceController();
 await waitFor(()=>expect(result.current.conversationView).toBeTruthy());
 act(()=>result.current.setProjectPage({projectId:p.id}));
 render(<QueryClientProvider client={queryClient}><ProjectsPage workspace={result.current}/></QueryClientProvider>);
 const user=userEvent.setup();
 await screen.findByRole("complementary",{name:"Project background and materials"});
 await user.type(screen.getByRole("textbox",{name:"Search project chats"}),"historical");
 await user.click(await screen.findByText("Matching historical answer"));
 await waitFor(()=>expect(result.current.conversationNavigation).toMatchObject({conversationId:fixture.conversation.id,messageId:"older-user"}));
});


test("only-on-this-Mac mode blocks remote sending without losing the draft",async()=>{
 const {user,composer}=await openWorkspace();
 await user.type(composer,"Keep this question local");
 await user.click(screen.getByRole("checkbox",{name:"Only on this Mac"}));
 expect(screen.getByRole<HTMLButtonElement>("button",{name:"Send message"}).disabled).toBe(true);
 expect(screen.getByRole<HTMLButtonElement>("button",{name:"Read webpage"}).disabled).toBe(true);
 expect(screen.getByRole<HTMLButtonElement>("button",{name:"Web search"}).disabled).toBe(true);
 expect((composer as HTMLTextAreaElement).value).toBe("Keep this question local");
 expect(transport.createGenerationBatch).not.toHaveBeenCalled();
 await user.click(screen.getByRole("checkbox",{name:"Only on this Mac"}));
 expect(screen.getByRole<HTMLButtonElement>("button",{name:"Send message"}).disabled).toBe(false);
});

test("document search installs in place while preserving the chat draft",async()=>{
 let installed=false;
 vi.spyOn(localApi,"getLocalModels").mockImplementation(async()=>[{id:"bge-small-zh",name:"BGE",role:"embedding",state:installed?"installed":"not_installed",runtime_ready:true,bytes:26472640,downloaded_bytes:installed?26472640:0,revision:"fixture",sha256:"a".repeat(64),runtime_version:"fixture",filename:"fixture.gguf",source_url:"https://example.test/model"}]);
 vi.spyOn(localApi,"getLocalDocuments").mockResolvedValue([]);
 vi.spyOn(localApi,"installLocalModel").mockImplementation(async()=>{installed=true;});
 const {user,composer}=await openWorkspace();
 await user.type(composer,"Retain this draft during installation");
 await user.click(screen.getByRole("button",{name:"Tools"}));
 await user.click(screen.getByRole("button",{name:"Search local documents"}));
 await user.click(await screen.findByRole("button",{name:/Download and install/}));
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>("button",{name:"Add documents"}).disabled).toBe(false));
 expect(localApi.installLocalModel).toHaveBeenCalledWith("bge-small-zh");
 await user.click(screen.getByRole("button",{name:"Close"}));
 expect((composer as HTMLTextAreaElement).value).toBe("Retain this draft during installation");
 expect(transport.createGenerationBatch).not.toHaveBeenCalled();
});

 test("document search cannot send the composer's draft through portal submit bubbling",async()=>{
  vi.spyOn(localApi,"getLocalModels").mockResolvedValue([{id:"bge-small-zh",state:"installed",runtime_ready:true}] as never);
  vi.spyOn(localApi,"getLocalDocuments").mockResolvedValue([{id:"doc",name:"guide.txt",characters:30,chunks:1}] as never);
  vi.spyOn(localApi,"searchLocalDocuments").mockResolvedValue({hits:[],elapsed_ms:1,model_sha256:"a".repeat(64),index_version:"fixture"});
  const {user,composer}=await openWorkspace();await user.type(composer,"Only send when I explicitly choose Send");
  await user.click(screen.getByRole("button",{name:"Tools"}));await user.click(screen.getByRole("button",{name:"Search local documents"}));
  await user.click(await screen.findByRole("checkbox",{name:/guide.txt/}));await user.type(screen.getByRole("textbox",{name:"What are you looking for?"}),"backup");
  await user.click(screen.getByRole("button",{name:"Search selected documents"}));await waitFor(()=>expect(localApi.searchLocalDocuments).toHaveBeenCalled());
  expect(transport.createGenerationBatch).not.toHaveBeenCalled();await user.click(screen.getByRole("button",{name:"Close"}));expect((composer as HTMLTextAreaElement).value).toBe("Only send when I explicitly choose Send");
  await user.click(screen.getByRole("button",{name:"Send message"}));await waitFor(()=>expect(transport.createGenerationBatch).toHaveBeenCalledOnce());
 });

 test("local-only suppresses each conversation's Web search preference without erasing it",async()=>{
  localStorage.setItem("cove.web-search-conversations.v1",JSON.stringify({[fixture.conversation.id]:true,[fixture.secondConversation.id]:true}));
  const {result}=mountWorkspaceController();await waitFor(()=>expect(result.current.conversationView?.id).toBe(fixture.conversation.id));
  expect(result.current.webSearch.enabled).toBe(true);act(()=>result.current.setLocalOnly(true));expect(result.current.webSearch.enabled).toBe(false);
  await act(async()=>{await result.current.handleSelectConversation(fixture.secondConversation.id);});await waitFor(()=>expect(result.current.conversationView?.id).toBe(fixture.secondConversation.id));
  expect(result.current.webSearch.enabled).toBe(false);expect(JSON.parse(localStorage.getItem("cove.web-search-conversations.v1")!)[fixture.secondConversation.id]).toBe(true);
  act(()=>result.current.setLocalOnly(false));expect(result.current.webSearch.enabled).toBe(true);
 });
 test("current local-only mode disables retrying a historical remote target",async()=>{
  const batch=structuredClone(fixture.completedBatch);batch.state="failed";batch.targets[0].generation.state="failed";delete batch.targets[0].generation.assistant_message_id;fixture.conversation.generation_batches=[batch];fixture.conversation.messages=fixture.completedView.messages.slice(0,1);
  const {user}=await openWorkspace();await user.click(screen.getByRole("checkbox",{name:"Only on this Mac"}));expect(screen.getByRole<HTMLButtonElement>("button",{name:"Retry generation"}).disabled).toBe(true);expect(transport.retryGenerationTarget).not.toHaveBeenCalled();
 });
