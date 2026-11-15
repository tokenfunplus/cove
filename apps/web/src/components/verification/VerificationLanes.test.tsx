import { applicationMessages } from "@/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("ordinary providers without verification support do not show failed verification lanes", async () => {
  const { VerificationLanes } = await import(
    "@/components/verification/VerificationLanes"
  );
  expect(
    renderToStaticMarkup(
      <VerificationLanes
        verification={{
          status: "unsupported",
          lanes: { gateway: "failed", response: "failed" },
        }}
        copy={applicationMessages("en")}
      />,
    ),
  ).toBe("");
});

test("an upstream generation failure reports an unavailable response instead of a failed cryptographic check", async () => {
  const { VerificationLanes } = await import(
    "@/components/verification/VerificationLanes"
  );
  const markup = renderToStaticMarkup(
    <VerificationLanes
      mode="incognito"
      verification={{
        status: "failed",
        failure_code: "stream_failed",
        lanes: { gateway: "verified", response: "failed" },
      }}
      copy={applicationMessages("en")}
    />,
  );
  expect(markup).toContain("Unavailable");
  expect(markup).not.toContain("Response verification: Verification failed");
});
