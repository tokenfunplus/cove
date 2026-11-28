import { expect, test } from "vitest";
import { LocalServiceError } from "@/api/client";
import { applicationMessages } from "@/messages";
import { generationErrorMessage } from "./error-messages";

test("a waiting app save directs the user to Activity instead of suggesting another model run", () => {
  const error = new LocalServiceError({
    error: {
      code: "task_save_pending",
      message: "An app save is pending.",
      details: null,
      request_id: "fixture",
    },
  });
  const message = generationErrorMessage(error, applicationMessages("en"));
  expect(message).toContain("Open Activity");
  expect(message).toContain("retry saving");
  expect(message).not.toBe(applicationMessages("en").generationFailed);
});
