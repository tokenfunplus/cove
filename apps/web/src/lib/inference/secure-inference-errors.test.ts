import { secureInferenceFailureReason } from "./secure-inference-errors";
import { expect, test } from "vitest";

test("receipt HTTP failures retain their status without arbitrary SDK details", () => {
  const error = Object.assign(new Error("sensitive fixture content"), {
    failure: {
      code: "api.http_status",
      details: {
        resource: "completion_signature",
        status: 404,
        body: "private fixture text",
      },
    },
  });
  const reason = secureInferenceFailureReason(
    new Error("outer", { cause: error }),
  );
  expect(reason).toBe(
    "Provider error: The response receipt request returned HTTP 404 (api.http_status).",
  );
  expect(reason).not.toContain("fixture");
});

test("signature mismatch diagnostics exclude submitted bytes and signer values", () => {
  const error = Object.assign(new Error("sensitive fixture content"), {
    failure: {
      code: "signature.payload_mismatch",
      details: { actual: "private fixture text", expected: "private request" },
    },
  });
  const reason = secureInferenceFailureReason(error);
  expect(reason).toContain("signature.payload_mismatch");
  expect(reason).not.toContain("private");
  expect(
    secureInferenceFailureReason(new Error("unknown private details")),
  ).toBeUndefined();
});
