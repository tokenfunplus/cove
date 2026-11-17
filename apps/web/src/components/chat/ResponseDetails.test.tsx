// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { ResponseDetails, VerificationStatus } from "./ResponseDetails";
import { englishConversationCopy as copy } from "@/messages";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
afterEach(cleanup);

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
