// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import {
  estimateGenerationCost,
  GenerationMetrics,
} from "@/components/chat/GenerationMetrics";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("unknown token counts and history without metrics stay explicitly unavailable", async () => {
  render(
    <GenerationMetrics
      metrics={{
        source: "browser",
        duration_ms: 1500,
        time_to_first_token_ms: 0,
      }}
    />,
  );
  await userEvent.click(screen.getByText(/Response performance/));
  expect(screen.getByText("0.00 s")).toBeTruthy();
  expect(screen.getAllByText("Not reported")).toHaveLength(2);
  expect(screen.getAllByText("Not available")).toHaveLength(2);
});

test("cost requires both supplied rates and reported counts, preserving legitimate zeroes", () => {
  const metrics = {
    source: "service" as const,
    duration_ms: 1000,
    input_tokens: 1000,
    output_tokens: 500,
  };
  expect(estimateGenerationCost(metrics, "2", "4")).toBe(0.004);
  expect(estimateGenerationCost(metrics, "", "4")).toBeUndefined();
  expect(
    estimateGenerationCost({ ...metrics, input_tokens: undefined }, "2", "4"),
  ).toBeUndefined();
  expect(estimateGenerationCost(metrics, "-1", "4")).toBeUndefined();
  expect(estimateGenerationCost(metrics, "0", "0")).toBe(0);
});
