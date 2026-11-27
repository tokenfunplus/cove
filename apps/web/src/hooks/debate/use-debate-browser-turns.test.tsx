// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useDebateBrowserTurns } from "./use-debate-browser-turns";
import { runDebateBrowserTurn } from "@/lib/inference/debate-browser-turn";
import * as api from "@/api/debates";
import type { DebateView } from "@cove/api-contract";
import { defaultDebateRules } from "@/components/debate/DebateSetupDialog";
import { createWorkspaceFixture } from "@/test/workspace-fixture";

vi.mock("@/lib/inference/debate-browser-turn", () => ({
  runDebateBrowserTurn: vi.fn(),
}));
vi.mock("@/api/debates", () => ({
  claimDebateBrowserTurn: vi.fn(),
  progressDebateBrowserTurn: vi.fn(),
  settleDebateBrowserTurn: vi.fn(),
  pauseDebateOnPageExit: vi.fn(async () => new Response()),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runDebateBrowserTurn).mockImplementation(
    async (_commands, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  );
});
afterEach(cleanup);

test("Stop invalidates a deferred browser start before a controller exists", async () => {
  vi.useFakeTimers();
  try {
    const hook = renderHook(() =>
      useDebateBrowserTurns("debate-one", fixture(), () => {}),
    );
    act(() => hook.result.current());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(runDebateBrowserTurn).not.toHaveBeenCalled();
    hook.unmount();
  } finally {
    vi.useRealTimers();
  }
});

function fixture(): DebateView {
  const chat = createWorkspaceFixture();
  return {
    session: {
      id: "debate-one",
      client_request_id: "request-one",
      topic: "Synthetic question",
      rules: defaultDebateRules,
      seats: [],
      status: "running",
      round: 1,
      position: 0,
      opening_done: [],
      total_turns: 0,
      browser_required: true,
      created_at: chat.conversation.created_at,
      updated_at: chat.conversation.updated_at,
    },
    turns: [
      {
        id: "turn-one",
        debate_id: "debate-one",
        execution: "browser",
        sequence: 1,
        round: 1,
        seat: 0,
        role: "Advocate",
        rule_version: 1,
        state: "streaming",
        body: "",
        context_ids: [],
        snapshot: chat.pendingBatch.targets[0]!.generation.snapshot,
        configuration:
          chat.pendingBatch.targets[0]!.generation.configuration_snapshot,
        created_at: chat.conversation.created_at,
        updated_at: chat.conversation.updated_at,
      },
    ],
    interventions: [],
    has_more: false,
  };
}

test("refreshes and pause-in-progress do not repeat or cancel an active request; Stop aborts it", async () => {
  const view = fixture();
  const refresh = vi.fn();
  const hook = renderHook(
    ({ view }) => useDebateBrowserTurns("debate-one", view, refresh),
    { initialProps: { view } },
  );
  await waitFor(() => expect(runDebateBrowserTurn).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(runDebateBrowserTurn).mock.calls[0]![1];
  hook.rerender({ view: structuredClone(view) });
  hook.rerender({
    view: { ...view, session: { ...view.session, status: "pausing" } },
  });
  expect(signal.aborted).toBe(false);
  expect(runDebateBrowserTurn).toHaveBeenCalledTimes(1);
  act(() => hook.result.current());
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(signal.aborted).toBe(true);
  hook.rerender({ view: structuredClone(view) });
  expect(runDebateBrowserTurn).toHaveBeenCalledTimes(1);
});

test("closing the page interrupts browser inference and requests pause", async () => {
  const view = fixture();
  renderHook(() => useDebateBrowserTurns("debate-one", view, () => {}));
  await waitFor(() => expect(runDebateBrowserTurn).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(vi.mocked(runDebateBrowserTurn).mock.calls[0]![1].aborted).toBe(true);
  expect(api.pauseDebateOnPageExit).toHaveBeenCalledExactlyOnceWith(
    "debate-one",
  );
});

test("failed verified delivery has a bounded cleanup signal independent of stopped inference", async () => {
  const hook = renderHook(() =>
    useDebateBrowserTurns("debate-one", fixture(), () => {}),
  );
  await waitFor(() => expect(runDebateBrowserTurn).toHaveBeenCalledOnce());
  const [commands, inferenceSignal] =
    vi.mocked(runDebateBrowserTurn).mock.calls[0]!;
  act(() => hook.result.current());
  expect(inferenceSignal.aborted).toBe(true);
  const input = {
    body: "",
    verification: {
      status: "failed" as const,
      failure_code: "browser_delivery_failed",
    },
  };
  await commands.failDelivery!(input);
  expect(api.settleDebateBrowserTurn).toHaveBeenCalledOnce();
  const [debate, turn, payload, cleanup] = vi.mocked(
    api.settleDebateBrowserTurn,
  ).mock.calls[0]!;
  expect([debate, turn]).toEqual(["debate-one", "turn-one"]);
  expect(payload).toMatchObject(input);
  expect(payload.claim_id).toBeTypeOf("string");
  expect(cleanup).not.toBe(inferenceSignal);
  expect(cleanup?.aborted).toBe(false);
});
