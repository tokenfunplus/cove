import {
  contractEvidenceFor,
  copyVerificationValue,
  signatureVerificationAvailable,
  verificationEvidenceForDialog,
  verificationLaneStatus,
} from "@/lib/inference/verification-record";
import { expect, test, vi } from "vitest";

test("verification lanes keep Gateway signatures distinct from model TEE proof", () => {
  const privateTee = {
    status: "verified_model" as const,
    signature_kind: "provider_tee" as const,
    lanes: {
      gateway: "verified" as const,
      model: "verified" as const,
      response: "verified" as const,
    },
  };
  const incognito = {
    status: "verified_gateway" as const,
    signature_kind: "gateway" as const,
    lanes: { gateway: "verified" as const, response: "verified" as const },
  };
  const mixed = {
    status: "verified_gateway" as const,
    signature_kind: "gateway" as const,
    lanes: {
      gateway: "verified" as const,
      model: "failed" as const,
      response: "verified" as const,
    },
  };
  const environmentFailed = {
    status: "failed" as const,
    failure_code: "environment_verification_failed",
    lanes: { gateway: "failed" as const, response: "failed" as const },
  };
  const responseFailed = {
    status: "failed" as const,
    failure_code: "response_verification_failed",
    lanes: { gateway: "verified" as const, response: "failed" as const },
  };
  const pendingModel = {
    status: "verified_model" as const,
    lanes: {
      gateway: "verified" as const,
      model: "pending" as const,
      response: "pending" as const,
    },
  };
  expect(verificationLaneStatus("gateway", privateTee, "private_tee")).toBe(
    "verified",
  );
  expect(verificationLaneStatus("model", privateTee, "private_tee")).toBe(
    "verified",
  );
  expect(verificationLaneStatus("response", privateTee, "private_tee")).toBe(
    "verified",
  );
  expect(verificationLaneStatus("gateway", incognito, "incognito")).toBe(
    "verified",
  );
  expect(verificationLaneStatus("model", incognito, "incognito")).toBe(
    "failed",
  );
  expect(verificationLaneStatus("response", incognito, "incognito")).toBe(
    "verified",
  );
  expect(verificationLaneStatus("model", incognito, "chutes")).toBe("failed");
  expect(verificationLaneStatus("model", mixed, "private_tee")).toBe("failed");
  expect(verificationLaneStatus("gateway", environmentFailed, "chutes")).toBe(
    "failed",
  );
  expect(verificationLaneStatus("gateway", responseFailed, "incognito")).toBe(
    "verified",
  );
  expect(verificationLaneStatus("response", responseFailed, "incognito")).toBe(
    "failed",
  );
  expect(verificationLaneStatus("model", pendingModel, "private_tee")).toBe(
    "pending",
  );
  expect(verificationLaneStatus("model", responseFailed, "chutes")).toBe(
    "failed",
  );
  expect(
    verificationLaneStatus(
      "response",
      {
        status: "failed",
        failure_code: "response_verification_failed",
        lanes: { gateway: "failed", response: "verified" },
      },
      "incognito",
    ),
  ).toBe("verified");
});

test("contract evidence keeps the independently verified gateway alongside model evidence", () => {
  const evidence = contractEvidenceFor(
    {
      kind: "model",
      signerAddress: "model-signer",
      signingAlgorithm: "ed25519",
      tcbStatus: "UpToDate",
      advisoryIds: [],
      gpuEvidence: "not_provided",
      deployment: { appCompose: "fixture-compose" },
      raw: { intel_quote: "model-quote" },
    },
    {
      model: {
        kind: "model",
        signerAddress: "model-signer",
        signingAlgorithm: "ed25519",
        tcbStatus: "UpToDate",
        advisoryIds: [],
        gpuEvidence: "not_provided",
        deployment: { appCompose: "fixture-compose" },
        raw: { intel_quote: "model-quote" },
      },
      gateway: {
        kind: "gateway",
        signerAddress: "gateway-signer",
        signingAlgorithm: "ed25519",
        tcbStatus: "UpToDate",
        advisoryIds: [],
        tlsBinding: "none",
        deployment: { appCompose: "fixture-compose" },
        raw: { intel_quote: "gateway-quote", nonce: "gateway-nonce" },
      },
    },
  );

  expect(evidence.gateway?.kind).toBe("gateway");
  expect(evidence.gateway?.raw).toMatchObject({
    intel_quote: "gateway-quote",
    nonce: "gateway-nonce",
  });
});

test("a successful private connection probe produces dialog evidence without a chat message", () => {
  const result = verificationEvidenceForDialog({
    status: "verified_model",
    signingKind: "provider_tee",
    evidence: {
      kind: "model",
      signerAddress: "model-signer",
      signingAlgorithm: "ed25519",
      tcbStatus: "UpToDate",
      gpuEvidence: "verified",
      advisoryIds: [],
      deployment: { appCompose: "fixture-compose" },
      raw: { intel_quote: "model-quote" },
    },
    environment: {
      model: {
        kind: "model",
        signerAddress: "model-signer",
        signingAlgorithm: "ed25519",
        tcbStatus: "UpToDate",
        gpuEvidence: "verified",
        advisoryIds: [],
        deployment: { appCompose: "fixture-compose" },
        raw: { intel_quote: "model-quote" },
      },
      gateway: {
        kind: "gateway",
        signerAddress: "gateway-signer",
        signingAlgorithm: "ed25519",
        tlsBinding: "none",
        tcbStatus: "UpToDate",
        advisoryIds: [],
        deployment: { appCompose: "fixture-compose" },
        raw: { intel_quote: "gateway-quote" },
      },
    },
  });

  expect(result?.kind).toBe("model");
  expect(result?.evidence.gateway?.signer_address).toBe("gateway-signer");
});

test("signature verification only appears for complete verified receipts and copies exact values", async () => {
  const writeText = vi.fn(async () => {});
  const verified = {
    status: "verified_model" as const,
    signature_kind: "provider_tee" as const,
    signing_address: "signer",
    signing_algorithm: "ed25519",
    signed_message: "signed message bytes",
    signature: "full signature",
  };
  expect(signatureVerificationAvailable(verified)).toBe(true);
  expect(
    signatureVerificationAvailable({
      ...verified,
      status: "verified_gateway",
      signature_kind: "gateway",
      signing_algorithm: "ecdsa",
    }),
  ).toBe(true);
  expect(
    signatureVerificationAvailable({ ...verified, status: "failed" }),
  ).toBe(false);
  expect(
    signatureVerificationAvailable({ ...verified, signature: undefined }),
  ).toBe(false);
  await expect(
    copyVerificationValue(verified.signature, { writeText }),
  ).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith("full signature");
});
