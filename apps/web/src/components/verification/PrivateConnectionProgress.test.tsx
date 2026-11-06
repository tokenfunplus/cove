import { PrivateConnectionProgress } from "@/components/verification/PrivateConnectionProgress";
import { applicationMessages } from "@/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("private connection progress keeps completed checks visible while highlighting the live phase", () => {
  const markup = renderToStaticMarkup(
    <PrivateConnectionProgress
      providerName="NearAI"
      modelIds={["Qwen/Qwen3.8-27B"]}
      phase="encrypted_path"
      copy={applicationMessages("en")}
      onClose={() => {}}
    />,
  );

  expect(markup).toContain("NearAI · Qwen/Qwen3.8-27B");
  expect(markup).toContain("Testing the end-to-end encrypted path...");
  expect(markup).toContain(
    'data-progress-step="environment" data-state="complete"',
  );
  expect(markup).toContain(
    'data-progress-step="encrypted_path" data-state="active"',
  );
  expect(markup).toContain(
    'data-progress-step="response" data-state="pending"',
  );
});
