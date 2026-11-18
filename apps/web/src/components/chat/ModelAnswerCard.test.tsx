// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ModelAnswerCard } from "./ModelAnswerCard";
import { englishConversationCopy as copy } from "@/messages";
afterEach(cleanup);

test.each(["unknown", "stopped"] as const)("a reasoning-only %s response retains its terminal notice", phase => {
  render(<ModelAnswerCard targetId="target" modelId="fixture-model" phase={phase} body="" reasoning="Partial reasoning" copy={copy} />);
  expect(screen.getByText(phase === "unknown" ? copy.generationDeliveryUnknown : copy.generationStopped)).toBeTruthy();
  expect(screen.getByText("Partial reasoning")).toBeTruthy();
  expect(screen.getByText("Reasoning", { exact: true }).closest("details")?.open).toBe(false);
});
