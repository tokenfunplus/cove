import type {
  GenerationVerification,
  VerificationEvidence,
} from "@cove/api-contract";

// The fixed viewer matches Cove's NearAI staging preset. Never derive it from evidence.
export const VERIFICATION_VIEWER_URL = "https://cloud-stg.near.ai/verify";
const tcbStatuses = new Set([
  "UpToDate",
  "SWHardeningNeeded",
  "ConfigurationNeeded",
  "ConfigurationAndSWHardeningNeeded",
  "OutOfDate",
  "OutOfDateConfigurationNeeded",
  "Revoked",
  "Unknown",
]);

type Signer = { signingAlgo: "ed25519" | "ecdsa"; signingAddress: string };
export type VerificationReport = {
  schemaVersion: 1;
  kind: "model" | "response";
  model?: string;
  completionId?: string;
  scope: "model" | "gateway" | "unknown";
  status: "verified" | "partial" | "unverifiable";
  verifiedAt?: string;
  attestation?: {
    signer: Signer;
    tcbStatus: string;
    advisoryIds: string[];
    deploymentProvenance: "not_checked";
    deployment: {
      runtimeMeasurements: { osImageHash?: string; composeHash?: string };
    };
    gpuEvidence?: "not_provided" | "verified";
    tlsBinding?:
      | { kind: "none" }
      | { kind: "attested"; spkiFingerprint: string };
  };
  signature?: {
    kind: "provider_tee" | "gateway";
    signer: Signer;
    signedText: string;
    signature: string;
  };
  error?: { code: string; message: string };
};

/** Project display metadata only. Raw evidence, deployment config and arbitrary signed text stay local. */
export function verificationReports(
  evidence: VerificationEvidence | undefined,
  modelId?: string,
  verification?: GenerationVerification,
): VerificationReport[] {
  if (!evidence) return [];
  const receiptModel =
    verification?.signature_kind === "provider_tee"
      ? /^([^\s]+):[a-f0-9]{64}:[a-f0-9]{64}$/i.exec(
          verification.signed_message ?? "",
        )?.[1]
      : undefined;
  const displayModel = modelId || receiptModel;
  const entries = [
    evidence,
    evidence.kind === "model" ? evidence.gateway : evidence.model,
  ].filter((item): item is VerificationEvidence => Boolean(item));
  const reports = entries.map((item): VerificationReport => {
    const algorithm = item.signing_algorithm?.toLowerCase();
    const fingerprint = item.raw?.spki_fingerprint;
    const hasBinding =
      item.tls_binding === "none" ||
      (item.tls_binding === "attested" &&
        typeof fingerprint === "string" &&
        fingerprint.length > 0);
    const hasScopeEvidence =
      item.kind === "model" ? Boolean(item.gpu_evidence) : hasBinding;
    const complete =
      (item.kind === "gateway" || Boolean(displayModel)) &&
      hasScopeEvidence &&
      (algorithm === "ecdsa" || algorithm === "ed25519") &&
      Boolean(item.signer_address) &&
      tcbStatuses.has(item.tcb_status ?? "");
    const report: VerificationReport = {
      schemaVersion: 1,
      kind: "model",
      model:
        displayModel ||
        (entries.some((entry) => entry.kind === "model")
          ? "Unknown model"
          : "NearAI Gateway"),
      scope: item.kind,
      status: complete
        ? item.kind === "gateway"
          ? "partial"
          : "verified"
        : "unverifiable",
    };
    if (complete) {
      report.attestation = {
        signer: {
          signingAlgo: algorithm as Signer["signingAlgo"],
          signingAddress: item.signer_address!,
        },
        tcbStatus: item.tcb_status!,
        advisoryIds: [...(item.advisory_ids ?? [])],
        // Cove's historical evidence does not retain a provenance verdict.
        deploymentProvenance: "not_checked",
        deployment: {
          runtimeMeasurements: {
            ...(item.deployment?.os_image_hash
              ? { osImageHash: item.deployment.os_image_hash }
              : {}),
            ...(item.deployment?.compose_hash
              ? { composeHash: item.deployment.compose_hash }
              : {}),
          },
        },
        ...(item.kind === "model" && item.gpu_evidence
          ? { gpuEvidence: item.gpu_evidence }
          : {}),
        ...(item.kind === "gateway"
          ? {
              tlsBinding:
                item.tls_binding === "attested"
                  ? {
                      kind: "attested" as const,
                      spkiFingerprint: fingerprint as string,
                    }
                  : { kind: "none" as const },
            }
          : {}),
      };
    } else {
      report.error = {
        code: "saved_evidence_incomplete",
        message:
          "This saved record does not contain complete verification metadata.",
      };
    }
    return report;
  });
  if (!verification) return reports;
  const modelSignature =
    verification.signature_kind === "provider_tee" &&
    verification.status === "verified_model";
  const gatewaySignature =
    verification.signature_kind === "gateway" &&
    verification.status === "verified_gateway";
  const signed = verification.signed_message ?? "";
  const modelMatch = /^([^\s]+):[a-f0-9]{64}:[a-f0-9]{64}$/i.exec(signed);
  const safeSigned = modelSignature
    ? Boolean(modelMatch && (!modelId || modelMatch[1] === modelId))
    : gatewaySignature && /^[a-f0-9]{64}:[a-f0-9]{64}$/i.test(signed);
  const hardware = reports.find(
    (report) => report.scope === (modelSignature ? "model" : "gateway"),
  );
  const signer = hardware?.attestation?.signer;
  if (
    !safeSigned ||
    !signer ||
    !verification.completion_id ||
    !verification.signature ||
    signer.signingAddress !== verification.signing_address ||
    signer.signingAlgo !== verification.signing_algorithm?.toLowerCase()
  )
    return [];
  return [
    {
      ...hardware!,
      kind: "response",
      model: modelSignature ? modelMatch![1] : undefined,
      completionId: verification.completion_id,
      signature: {
        kind: modelSignature ? "provider_tee" : "gateway",
        signer,
        signedText: signed,
        signature: verification.signature,
      },
      ...(verification.verified_at &&
      Number.isFinite(Date.parse(verification.verified_at))
        ? { verifiedAt: verification.verified_at }
        : {}),
    },
    ...reports.filter((report) => report !== hardware),
  ];
}

export function connectVerificationViewer(
  frame: HTMLIFrameElement,
  reports: VerificationReport[],
  dark: boolean,
  callbacks: { ready: () => void; error: () => void; close: () => void },
): () => void {
  if (
    !reports.length ||
    reports.length > 1000 ||
    new TextEncoder().encode(JSON.stringify(reports)).length > 1024 * 1024
  )
    throw new Error("Verification report exceeds the viewer limit");
  const url = new URL(VERIFICATION_VIEWER_URL);
  url.search = new URLSearchParams({
    darkMode: String(dark),
    showHeader: "false",
    canClose: "true",
    canRequestReports: "false",
  }).toString();
  let requestId = "";
  let disconnected = false;
  const disconnect = () => {
    disconnected = true;
    requestId = "";
    clearTimeout(timer);
    window.removeEventListener("message", receive);
    frame.removeAttribute("src");
  };
  const fail = () => {
    disconnect();
    callbacks.error();
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (
      disconnected ||
      event.origin !== url.origin ||
      event.source !== frame.contentWindow ||
      !event.data ||
      typeof event.data !== "object"
    )
      return;
    const message = event.data as Record<string, unknown>;
    if (
      message.version !== 1 ||
      typeof message.requestId !== "string" ||
      !message.requestId ||
      message.requestId.length > 128
    )
      return;
    if (message.type === "NEAR_AI_VERIFICATION_CENTER_READY") {
      requestId = message.requestId;
      clearTimeout(timer);
      frame.contentWindow?.postMessage(
        { type: "NEAR_AI_VERIFICATION_REPORT", version: 1, requestId, reports },
        url.origin,
      );
      callbacks.ready();
    } else if (requestId && message.requestId === requestId) {
      if (message.type === "NEAR_AI_VERIFICATION_ERROR") fail();
      if (message.type === "NEAR_AI_VERIFICATION_CLOSE") {
        disconnect();
        callbacks.close();
      }
    }
  };
  const timer = window.setTimeout(fail, 60_000);
  window.addEventListener("message", receive);
  frame.src = url.href;
  return disconnect;
}
