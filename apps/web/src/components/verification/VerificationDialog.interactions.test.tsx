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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    "old-gateway",
  );
  fireEvent.click(screen.getByRole("button", { name: "Verify Again" }));
  await waitFor(() =>
    expect(screen.getByTestId("viewer-evidence").textContent).toContain(
      "new-gateway",
    ),
  );
  expect(refresh).toHaveBeenLastCalledWith("gateway");
  fireEvent.click(screen.getByRole("tab", { name: "Model Verification" }));
  expect(screen.getByTestId("viewer-evidence").textContent).toContain(
    "old-model",
  );
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
  expect(screen.getByTestId("viewer-evidence").textContent).not.toContain(
    "new-model",
  );
  expect(screen.getByText("new-gateway")).toBeTruthy();
});

test("local evidence tabs support arrow navigation and omit unavailable re-verification", () => {
  render(
    <VerificationDialog
      kind="model"
      evidence={{ kind: "model", gateway: { kind: "gateway" } }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Verify Again" })).toBeNull();
  fireEvent.click(screen.getByText("Saved details on this Mac"));
  const model = screen.getByRole("tab", { name: "Model Verification" });
  const gateway = screen.getByRole("tab", { name: "Gateway Verification" });
  model.focus();
  fireEvent.keyDown(model, { key: "ArrowRight" });
  expect(document.activeElement).toBe(gateway);
  expect(gateway.getAttribute("aria-selected")).toBe("true");
  expect(model.tabIndex).toBe(-1);
  fireEvent.keyDown(gateway, { key: "Home" });
  expect(document.activeElement).toBe(model);
  expect(model.getAttribute("aria-selected")).toBe("true");
});

test("copying a saved quote reports clipboard denial", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(
    <VerificationDialog
      kind="model"
      evidence={{ kind: "model", raw: { intel_quote: "fixture" } }}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Saved details on this Mac"));
  fireEvent.click(screen.getByText("Intel TDX Attestation"));
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not copy");
});
