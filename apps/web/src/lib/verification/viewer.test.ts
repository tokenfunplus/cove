// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  connectVerificationViewer,
  verificationReports,
  VERIFICATION_VIEWER_URL,
} from "./viewer";
import type { VerificationEvidence } from "@cove/api-contract";

const evidence: VerificationEvidence = {
  kind: "model",
  signer_address: "0xfixture",
  signing_algorithm: "ecdsa",
  tcb_status: "UpToDate",
  advisory_ids: [],
  gpu_evidence: "verified",
  deployment: {
    os_image_hash: "os-hash",
    compose_hash: "compose-hash",
    app_compose: "private-deployment",
  },
  raw: {
    secret: "never-share",
    intel_quote: "raw-quote",
    prompt: "private-prompt",
  },
  gateway: {
    kind: "gateway",
    signer_address: "gateway",
    signing_algorithm: "ed25519",
    tcb_status: "UpToDate",
    tls_binding: "attested",
    raw: { spki_fingerprint: "fingerprint", token: "never-share" },
  },
};
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

test("projects compatible model and gateway reports without raw or private data", () => {
  const reports = verificationReports(evidence, "model-a");
  expect(reports.map((r) => [r.kind, r.scope, r.status])).toEqual([
    ["model", "model", "verified"],
    ["model", "gateway", "partial"],
  ]);
  expect(reports[1].attestation?.tlsBinding).toEqual({
    kind: "attested",
    spkiFingerprint: "fingerprint",
  });
  const json = JSON.stringify(reports);
  for (const value of [
    "private-deployment",
    "never-share",
    "raw-quote",
    "private-prompt",
  ])
    expect(json).not.toContain(value);
  expect(reports[0].verifiedAt).toBeUndefined();
  expect(reports[0].attestation?.deploymentProvenance).toBe("not_checked");
});
test("incomplete historical evidence never becomes a positive report", () => {
  expect(verificationReports({ kind: "model" }, "model-a")[0]).toMatchObject({
    status: "unverifiable",
  });
  expect(
    verificationReports({ ...evidence.gateway!, raw: {} }, "model-a")[0].status,
  ).toBe("unverifiable");
});
test("response reports require matching identities and hash-only signed content", () => {
  const verification = {
    status: "verified_model",
    signature_kind: "provider_tee",
    signing_address: "0xfixture",
    signing_algorithm: "ecdsa",
    completion_id: "fixture",
    signature: "signature",
    signed_message: `model-a:${"a".repeat(64)}:${"b".repeat(64)}`,
  };
  expect(
    verificationReports(evidence, "model-a", verification)[0],
  ).toMatchObject({
    kind: "response",
    model: "model-a",
    completionId: "fixture",
    status: "verified",
  });
  expect(verificationReports(evidence, "model-b", verification)).toEqual([]);
  expect(
    verificationReports(evidence, "model-a", {
      ...verification,
      signed_message: "private chat content",
    }),
  ).toEqual([]);
  expect(
    verificationReports(evidence, "model-a", {
      ...verification,
      signing_address: "different",
    }),
  ).toEqual([]);
});

test("handshake validates source, origin, version and request identity; cleanup stops delivery", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const ready = vi.fn(),
    error = vi.fn(),
    close = vi.fn();
  const disconnect = connectVerificationViewer(
    frame,
    verificationReports(evidence, "model-a"),
    true,
    { ready, error, close },
  );
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const receive = (
    data: object,
    origin = new URL(VERIFICATION_VIEWER_URL).origin,
    source: Window | null = frame.contentWindow,
  ) =>
    window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
  const message = {
    type: "NEAR_AI_VERIFICATION_CENTER_READY",
    version: 1,
    requestId: "fixture-request",
  };
  receive(message, "https://untrusted.example");
  receive(message, undefined, window);
  receive({ ...message, version: 2 });
  expect(post).not.toHaveBeenCalled();
  receive(message);
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "NEAR_AI_VERIFICATION_REPORT",
      requestId: "fixture-request",
    }),
    "https://cloud-stg.near.ai",
  );
  expect(ready).toHaveBeenCalledOnce();
  expect(new URL(frame.src).searchParams.get("darkMode")).toBe("true");
  receive({
    ...message,
    type: "NEAR_AI_VERIFICATION_CLOSE",
    requestId: "stale",
  });
  expect(close).not.toHaveBeenCalled();
  receive({ ...message, type: "NEAR_AI_VERIFICATION_CLOSE" });
  expect(close).toHaveBeenCalledOnce();
  receive(message);
  expect(post).toHaveBeenCalledTimes(1);
  disconnect();
  expect(frame.hasAttribute("src")).toBe(false);
});
test("timeout disconnects the frame and rejects late ready messages", () => {
  vi.useFakeTimers();
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const ready = vi.fn(),
    error = vi.fn();
  const stop = connectVerificationViewer(
    frame,
    verificationReports(evidence, "model-a"),
    false,
    { ready, error, close: vi.fn() },
  );
  vi.advanceTimersByTime(60_000);
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://cloud-stg.near.ai",
      source: frame.contentWindow,
      data: {
        type: "NEAR_AI_VERIFICATION_CENTER_READY",
        version: 1,
        requestId: "late",
      },
    }),
  );
  expect(error).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  expect(frame.hasAttribute("src")).toBe(false);
  stop();
});

test("protocol errors must match the current handshake and disconnect the frame", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const error = vi.fn();
  const stop = connectVerificationViewer(
    frame,
    verificationReports(evidence, "model-a"),
    false,
    { ready: vi.fn(), error, close: vi.fn() },
  );
  const receive = (type: string, requestId: string) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://cloud-stg.near.ai",
        source: frame.contentWindow,
        data: { type, version: 1, requestId },
      }),
    );
  receive("NEAR_AI_VERIFICATION_CENTER_READY", "current");
  receive("NEAR_AI_VERIFICATION_ERROR", "stale");
  expect(error).not.toHaveBeenCalled();
  receive("NEAR_AI_VERIFICATION_ERROR", "current");
  expect(error).toHaveBeenCalledOnce();
  expect(frame.hasAttribute("src")).toBe(false);
  stop();
});

test("oversized reports fail before navigating or installing a connection", () => {
  const frame = document.createElement("iframe");
  const callbacks = { ready: vi.fn(), error: vi.fn(), close: vi.fn() };
  const report = verificationReports(evidence, "model-a")[0];
  expect(() =>
    connectVerificationViewer(
      frame,
      Array(1001).fill(report),
      false,
      callbacks,
    ),
  ).toThrow();
  expect(() =>
    connectVerificationViewer(
      frame,
      [{ ...report, model: "x".repeat(1024 * 1024) }],
      false,
      callbacks,
    ),
  ).toThrow();
  expect(frame.hasAttribute("src")).toBe(false);
});

test("gateway receipts stay partial and missing model identities remain consistent", () => {
  const reports = verificationReports(evidence, undefined, {
    status: "verified_gateway",
    signature_kind: "gateway",
    signing_address: "gateway",
    signing_algorithm: "ed25519",
    completion_id: "gateway-fixture",
    signature: "signature",
    signed_message: `${"a".repeat(64)}:${"b".repeat(64)}`,
  });
  expect(reports[0]).toMatchObject({
    kind: "response",
    scope: "gateway",
    status: "partial",
  });
  expect(reports[1]).toMatchObject({ scope: "model", status: "unverifiable" });
  expect(
    new Set(verificationReports(evidence).map((report) => report.model)).size,
  ).toBe(1);
});
