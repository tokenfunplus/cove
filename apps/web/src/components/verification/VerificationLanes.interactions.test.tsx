// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type {
  GenerationVerification,
  VerificationEvidence,
} from "@cove/api-contract";
import { englishConversationCopy as copy } from "@/messages";
import { VerificationLanes } from "./VerificationLanes";

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
const verification: GenerationVerification = {
  status: "verified_model",
  signature_kind: "provider_tee",
  signing_address: "model-signer",
  signing_algorithm: "ecdsa",
  signed_message: "fixture-receipt",
  signature: "fixture-signature",
  lanes: { model: "verified", gateway: "verified", response: "verified" },
  evidence: {
    kind: "model",
    signer_address: "model-signer",
    gateway: { kind: "gateway", signer_address: "gateway-signer" },
  },
};

test("status shortcuts open matching details and restore keyboard focus on close", async () => {
  const user = userEvent.setup();
  const refresh = vi.fn().mockResolvedValue(verification.evidence?.gateway);
  render(
    <VerificationLanes
      verification={verification}
      copy={copy}
      modelId="fixture-model"
      onVerifyAgain={refresh}
    />,
  );
  const gateway = screen.getByRole("button", {
    name: "Gateway Verification: Verified",
  });
  gateway.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByTestId("viewer-evidence").textContent).toContain(
    "gateway-signer",
  );
  expect(screen.getByTestId("viewer-evidence").textContent).not.toContain(
    "model-signer",
  );
  await user.click(screen.getByRole("button", { name: "Verify Again" }));
  expect(refresh).toHaveBeenCalledWith("gateway");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(gateway));
  await user.click(
    screen.getByRole("button", { name: "Model Verification: Verified" }),
  );
  expect(screen.getByTestId("viewer-evidence").textContent).toContain(
    "model-signer",
  );
  await user.keyboard("{Escape}");
  await user.click(
    screen.getByRole("button", { name: "Response Verification: Verified" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Signature Verification" }),
  ).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(
    screen.getByRole("button", { name: "Message evidence: Verified" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Attestation evidence" }),
  ).toBeTruthy();
});

test("pending lanes without saved evidence do not expose empty actions", () => {
  render(
    <VerificationLanes
      verification={{ status: "pending" }}
      mode="private_tee"
      copy={copy}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(copy.verificationPending);
});
