import {
  type SecureInferenceEvidence,
  type SecureInferenceMode,
  type SecureInferenceVerification,
} from "@/lib/inference/secure-inference";
import {
  type GenerationVerification,
  type VerificationEvidence,
  type VerificationLaneKind,
} from "@cove/api-contract";

function lanesForSuccessfulVerification(
  verification: SecureInferenceVerification,
  mode?: SecureInferenceMode,
): GenerationVerification["lanes"] {
  if (
    verification.status === "verified_model" &&
    verification.signingKind === "provider_tee"
  ) {
    return { gateway: "verified", model: "verified", response: "verified" };
  }
  if (
    verification.status === "verified_gateway" &&
    verification.signingKind === "gateway"
  ) {
    return mode === "private_tee"
      ? { gateway: "verified", model: "failed", response: "verified" }
      : { gateway: "verified", response: "verified" };
  }
  return {
    gateway: "failed",
    ...(mode === "private_tee" ? { model: "failed" as const } : {}),
    response: "failed",
  };
}

function lanesForFailedVerification(
  mode: SecureInferenceMode | undefined,
  failureCode?: string,
  streamed = false,
): GenerationVerification["lanes"] {
  const includeModel = mode === "private_tee";
  const environmentFailed =
    failureCode === "environment_verification_failed" ||
    failureCode === "gateway_verification_failed" ||
    failureCode === "secure_transport_error";
  if (environmentFailed && !streamed) {
    return {
      gateway: "failed",
      ...(includeModel ? { model: "failed" as const } : {}),
      response: "failed",
    };
  }
  if (
    failureCode === "response_verification_failed" ||
    failureCode === "timeout" ||
    failureCode === "verification_stopped" ||
    failureCode === "stream_failed" ||
    streamed
  ) {
    return {
      gateway: "verified",
      ...(includeModel ? { model: "failed" as const } : {}),
      response: "failed",
    };
  }
  return {
    gateway: "failed",
    ...(includeModel ? { model: "failed" as const } : {}),
    response: "failed",
  };
}

export async function secureVerificationForContract(
  verification: SecureInferenceVerification,
  mode?: SecureInferenceMode,
): Promise<GenerationVerification> {
  let signatureDigest: string | undefined;
  if (verification.signature) {
    try {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verification.signature),
      );
      signatureDigest = `sha256:${Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("")}`;
    } catch {
      signatureDigest = "sha256:unavailable";
    }
  }
  const status =
    verification.status === "verified_model"
      ? "verified_model"
      : verification.status === "verified_gateway"
        ? "verified_gateway"
        : "unsupported";
  return {
    status,
    completion_id: verification.completionId,
    signature_kind: verification.signingKind,
    signing_address: verification.signingAddress,
    signing_algorithm: verification.signingAlgorithm,
    signed_message: verification.signedMessage,
    signature: verification.signature,
    signature_digest: signatureDigest,
    evidence_summary: verification.reason,
    evidence: verification.evidence
      ? contractEvidenceFor(verification.evidence, verification.environment)
      : undefined,
    lanes: lanesForSuccessfulVerification(verification, mode),
  };
}

export function failedVerificationForContract(
  mode: SecureInferenceMode | undefined,
  failureCode: string,
  evidenceSummary: string,
  streamed = false,
): GenerationVerification {
  return {
    status: "failed",
    failure_code: failureCode,
    evidence_summary: evidenceSummary,
    lanes: lanesForFailedVerification(mode, failureCode, streamed),
  };
}

export function contractEvidenceFor(
  evidence: SecureInferenceEvidence,
  environment?: SecureInferenceVerification["environment"],
): VerificationEvidence {
  const related =
    evidence.kind === "model" ? environment?.gateway : environment?.model;
  return {
    kind: evidence.kind,
    signer_address: evidence.signerAddress,
    signing_algorithm: evidence.signingAlgorithm,
    tcb_status: evidence.tcbStatus,
    advisory_ids: evidence.advisoryIds,
    gpu_evidence: evidence.gpuEvidence,
    tls_binding: evidence.tlsBinding,
    deployment: {
      app_compose: evidence.deployment.appCompose,
      os_image_hash: evidence.deployment.osImageHash,
      compose_hash: evidence.deployment.composeHash,
    },
    raw: evidence.raw,
    ...(related ? { [related.kind]: contractEvidenceFor(related) } : {}),
  };
}

export function verificationEvidenceForDialog(
  verification: SecureInferenceVerification,
): { kind: "model" | "gateway"; evidence: VerificationEvidence } | undefined {
  if (
    verification.status !== "verified_model" &&
    verification.status !== "verified_gateway"
  )
    return undefined;
  if (!verification.evidence) return undefined;
  return {
    kind: verification.evidence.kind,
    evidence: contractEvidenceFor(
      verification.evidence,
      verification.environment,
    ),
  };
}

export function keepUnverifiedGatewayAnswer(
  mode: SecureInferenceMode | undefined,
  body: string,
): boolean {
  return (mode === "incognito" || mode === "chutes") && body.trim() !== "";
}

export function verificationLaneStatus(
  kind: VerificationLaneKind,
  verification?: GenerationVerification,
  mode?: SecureInferenceMode,
): "pending" | "verified" | "failed" {
  const stored = verification?.lanes?.[kind];
  if (stored === "pending" || stored === "verified" || stored === "failed")
    return stored;
  if (
    kind === "model" &&
    mode !== "private_tee" &&
    verification?.signature_kind !== "provider_tee"
  ) {
    return "failed";
  }
  if (!verification || verification.status === "pending") return "pending";
  const providerTee =
    verification.status === "verified_model" &&
    verification.signature_kind === "provider_tee";
  const gatewaySigned =
    verification.status === "verified_gateway" &&
    verification.signature_kind === "gateway";
  const failureCode = verification.failure_code ?? "";
  if (kind === "gateway") {
    if (providerTee || gatewaySigned) return "verified";
    if (
      verification.status === "failed" ||
      verification.status === "unsupported"
    ) {
      if (
        failureCode === "response_verification_failed" ||
        failureCode === "timeout" ||
        failureCode === "verification_stopped" ||
        failureCode === "stream_failed"
      ) {
        return "verified";
      }
      return "failed";
    }
    return "pending";
  }
  if (kind === "model") {
    if (providerTee) return "verified";
    if (
      verification.status === "failed" ||
      verification.status === "unsupported" ||
      gatewaySigned
    )
      return "failed";
    return "pending";
  }
  if (providerTee || gatewaySigned) return "verified";
  if (verification.status === "failed" || verification.status === "unsupported")
    return "failed";
  return "pending";
}

export function signatureVerificationAvailable(
  verification: GenerationVerification | undefined,
): boolean {
  return Boolean(
    verification &&
    (verification.status === "verified_model" ||
      verification.status === "verified_gateway") &&
    verification.signature_kind &&
    verification.signing_address &&
    verification.signing_algorithm &&
    verification.signed_message &&
    verification.signature,
  );
}

export async function copyVerificationValue(
  value: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = typeof navigator ===
  "undefined"
    ? undefined
    : navigator.clipboard,
): Promise<boolean> {
  if (!value || !clipboard?.writeText) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
