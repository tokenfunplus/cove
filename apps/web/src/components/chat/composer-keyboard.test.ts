import { shouldSubmitComposerKey } from "@/components/chat/composer-keyboard";
import { expect, test } from "vitest";

test("composer submits on Enter but preserves newlines and IME composition", () => {
  expect(
    shouldSubmitComposerKey({
      key: "Enter",
      shiftKey: false,
      isComposing: false,
    }),
  ).toBe(true);
  expect(
    shouldSubmitComposerKey({
      key: "Enter",
      shiftKey: true,
      isComposing: false,
    }),
  ).toBe(false);
  expect(
    shouldSubmitComposerKey({
      key: "Enter",
      shiftKey: false,
      isComposing: true,
    }),
  ).toBe(false);
});
