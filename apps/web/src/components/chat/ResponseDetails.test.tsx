// @vitest-environment jsdom
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ConversationPanel } from "./ConversationPanel";
import { liveTurnFromBatch } from "@/lib/chat/live-turn";
import { ResponseDetails, VerificationStatus } from "./ResponseDetails";
import { englishConversationCopy as copy } from "@/messages";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
afterEach(async () => {
  cleanup();
  // Radix returns focus in a queued task after a dialog unmounts. Finish that
  // task while this test's DOM realm and globals still exist.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  vi.unstubAllGlobals();
});

test("one details entry opens performance, Provider metadata, and verification together", async () => {
  const fixture = createWorkspaceFixture();
  const snapshot = fixture.completedBatch.targets[0]!.generation.snapshot;
  render(
    <ResponseDetails
      snapshot={snapshot}
      copy={copy}
      metrics={{
        source: "service",
        duration_ms: 1200,
        input_tokens: 10,
        output_tokens: 20,
      }}
      mode="incognito"
      verification={{
        status: "verified_gateway",
        lanes: { gateway: "verified", response: "verified" },
      }}
    />,
  );
  expect(screen.queryByText("Provider Snapshot")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: /Response details/ }),
  );
  expect(screen.getByRole("dialog", { name: "Response details" })).toBeTruthy();
  expect(screen.getByText("Provider Snapshot")).toBeTruthy();
  expect(screen.getByText("Input tokens")).toBeTruthy();
  expect(
    document.querySelector(
      '[data-verification-lane="gateway"][data-status="verified"]',
    ),
  ).toBeTruthy();
  expect(document.querySelector('[data-verification-lane="model"]')).toBeNull();
  expect(screen.getByText(snapshot.destination)).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Close response details" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a failed verification stays visible outside the details dialog", () => {
  render(
    <VerificationStatus
      mode="incognito"
      verification={{
        status: "failed",
        lanes: { gateway: "verified", response: "failed" },
      }}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Verification needs attention",
  );
});

test.each(["failed", "stopped"] as const)(
  "live %s response details use the matching attempt's recorded metrics",
  async (state) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const fixture = createWorkspaceFixture();
    const batch = {
      ...fixture.pendingBatch,
      state,
      targets: fixture.pendingBatch.targets.map((target) => ({
        ...target,
        generation: {
          ...target.generation,
          state,
          metrics: {
            source: "browser" as const,
            duration_ms: 1750,
            input_tokens: 128,
          },
        },
      })),
    };
    render(
      <ConversationPanel
        view={fixture.conversation}
        generationBatch={batch}
        liveTurn={liveTurnFromBatch(fixture.conversation.id, "Prompt", batch)}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Response details · 1.75 s" }),
    );
    expect(screen.getByText("128")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /1\.75 s/ })).toBeTruthy();
  },
);

test.each(["private_tee", "incognito"] as const)(
  "saved %s verification details preserve each expected lane outcome",
  async (mode) => {
    render(
      <ResponseDetails
        copy={copy}
        mode={mode}
        verification={{
          status: mode === "private_tee" ? "verified_model" : "failed",
          lanes: {
            gateway: "verified",
            ...(mode === "private_tee" ? { model: "verified" as const } : {}),
            response: mode === "private_tee" ? "verified" : "failed",
          },
        }}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Response details" }),
    );
    expect(
      document.querySelector(
        '[data-verification-lane="gateway"][data-status="verified"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector(
        `[data-verification-lane="response"][data-status="${mode === "private_tee" ? "verified" : "failed"}"]`,
      ),
    ).toBeTruthy();
    expect(
      Boolean(
        document.querySelector(
          '[data-verification-lane="model"][data-status="verified"]',
        ),
      ),
    ).toBe(mode === "private_tee");
  },
);
