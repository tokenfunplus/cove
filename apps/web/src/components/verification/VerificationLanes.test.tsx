import { applicationMessages } from "@/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("ordinary providers without verification support do not show failed verification lanes", async () => {
  const { VerificationLanes } =
    await import("@/components/verification/VerificationLanes");
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
