// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { VerificationEvidence } from "@cove/api-contract";
import { VerificationDialog } from "./VerificationDialog";

vi.mock("./NearAIVerificationFrame", () => ({
  NearAIVerificationFrame: ({
    evidence,
  }: {
    evidence: VerificationEvidence;
  }) => (
    <output data-testid="viewer-evidence">{JSON.stringify(evidence)}</output>
  ),
}));
afterEach(cleanup);

test("local tabs retain both viewer reports and refreshed evidence", async () => {
  const refresh = vi
    .fn()
    .mockResolvedValueOnce({ kind: "gateway", signer_address: "new-gateway" })
    .mockResolvedValueOnce({ kind: "model", signer_address: "new-model" });
  render(
    <VerificationDialog
      kind="model"
      modelId="fixture"
      evidence={{
        kind: "model",
        signer_address: "old-model",
        gateway: { kind: "gateway", signer_address: "old-gateway" },
      }}
      onVerifyAgain={refresh}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Saved details on this Mac"));
  fireEvent.click(screen.getByRole("tab", { name: "Gateway Verification" }));
  expect(screen.getByTestId("viewer-evidence").textContent).toContain(
    "old-model",
  );
  fireEvent.click(screen.getByRole("button", { name: "Verify Again" }));
  await waitFor(() =>
    expect(screen.getByTestId("viewer-evidence").textContent).toContain(
      "new-gateway",
    ),
  );
  expect(refresh).toHaveBeenLastCalledWith("gateway");
  fireEvent.click(screen.getByRole("tab", { name: "Model Verification" }));
  fireEvent.click(screen.getByRole("button", { name: "Verify Again" }));
  await waitFor(() =>
    expect(screen.getByTestId("viewer-evidence").textContent).toContain(
      "new-model",
    ),
  );
  expect(screen.getByTestId("viewer-evidence").textContent).toContain(
    "new-gateway",
  );
  fireEvent.click(screen.getByRole("tab", { name: "Gateway Verification" }));
  expect(screen.getByTestId("viewer-evidence").textContent).toContain(
    "new-model",
  );
  expect(screen.getByText("new-gateway")).toBeTruthy();
});
