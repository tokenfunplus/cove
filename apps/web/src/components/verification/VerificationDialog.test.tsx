import { SignatureVerificationContent } from "@/components/verification/SignatureVerificationDialog";
import { VerificationDialogContent } from "@/components/verification/VerificationDialog";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("verification dialog follows the unified model and gateway verification design", () => {
  const markup = renderToStaticMarkup(
    <VerificationDialogContent
      kind="model"
      providerName="NearAI"
      modelId="deepseek-ai/DeepSeek-V4-Flash"
      evidence={{
        kind: "model",
        gpu_evidence: "verified",
        tcb_status: "UpToDate",
        raw: { intel_quote: "model-quote" },
        gateway: {
          kind: "gateway",
          tls_binding: "attested",
          raw: { intel_quote: "gateway-quote" },
        },
      }}
    />,
  );

  expect(markup).toContain('data-verification-dialog="model"');
  expect(markup).toContain('role="tablist"');
  expect(markup).toContain('aria-selected="true"');
  expect(markup).toContain("Private Model");
  expect(markup).toContain("deepseek-ai/DeepSeek-V4-Flash");
  expect(markup).toContain("GPU Attestation");
  expect(markup).toContain("TDX Attestation");
  expect(markup).toContain('data-verification-card="gpu"');
  expect(markup).toContain('data-verification-card="tdx"');
  expect(markup).not.toContain('data-verification-card="tdx" open');
  expect(markup).toContain("NVIDIA");
  expect(markup).toContain("intel.");
  expect(markup).toContain("Copy");
  expect(markup).not.toContain("Documentation");
  expect(markup).not.toContain("Intel TDX Explorer");
});

test("verification dialog keeps the Gateway tab available when history only has model evidence", () => {
  const markup = renderToStaticMarkup(
    <VerificationDialogContent
      kind="model"
      providerName="NearAI"
      modelId="private-model"
      evidence={{
        kind: "model",
        gpu_evidence: "verified",
        raw: { intel_quote: "model-quote" },
      }}
      hasGatewayEvidence
    />,
  );

  const gatewayTab = markup.match(
    /<button[^>]*role="tab"[^>]*>Gateway Verification<\/button>/,
  )?.[0];
  expect(gatewayTab).toBeDefined();
  expect(gatewayTab).not.toMatch(/\sdisabled(?:=|\s|>)/);
});

test("verification dialog switches to a saved-evidence empty state without presenting model evidence as Gateway evidence", () => {
  const markup = renderToStaticMarkup(
    <VerificationDialogContent
      kind="gateway"
      providerName="NearAI"
      evidence={undefined}
    />,
  );

  expect(markup).toContain('data-verification-dialog="gateway"');
  expect(markup).toContain(
    "No saved verification evidence is available for this tab.",
  );
  expect(markup).not.toContain('data-verification-card="gpu"');
});

test("signature verification dialog follows the verified receipt design", () => {
  const markup = renderToStaticMarkup(
    <SignatureVerificationContent
      verification={{
        status: "verified_model",
        signature_kind: "provider_tee",
        signing_address: "0xsigner",
        signing_algorithm: "ECDSA",
        signed_message: "signed message",
        signature: "full signature",
      }}
    />,
  );

  expect(markup).toContain('data-signature-verification="saved"');
  expect(markup).toContain('data-signature-status="verified"');
  expect(markup).toContain("Message Signature Verified");
  expect(markup).toMatch(/class="[^"\n]*\bsignature\-dialog__fact\b[^"\n]*"/);
  expect(markup).toMatch(/class="[^"\n]*\bsignature\-dialog__field\b[^"\n]*"/);
  expect(markup).toMatch(/class="[^"\n]*\bsignature\-dialog__notes\b[^"\n]*"/);
  expect(markup).toContain('aria-label="Copy: Address"');
  expect(markup).toContain('data-signature-field="signer"');
  expect(markup).toContain('data-signature-field="signed-message"');
  expect(markup).toContain('data-signature-field="signature"');
});
