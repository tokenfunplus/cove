// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { ModelAnswerCard } from "@/components/chat/ModelAnswerCard";
import { englishConversationCopy } from "@/messages";

afterEach(cleanup);
const content = "<think>Consider both options.</think>\n\nThe final answer.";

test("streaming reasoning expands, then collapses as soon as text streaming finishes", async () => {
  const { container, rerender } = render(
    <AssistantMessage content="<think>Consider" streaming />,
  );
  expect(container.querySelector("details")?.open).toBe(true);
  rerender(<AssistantMessage content={content} streaming />);
  expect(container.querySelector("details")?.open).toBe(true);
  expect(screen.getByText("The final answer.")).toBeTruthy();
  rerender(<AssistantMessage content={content} />);
  expect(container.querySelector("details")?.open).toBe(false);
  await userEvent.click(screen.getByText("Reasoning"));
  await waitFor(() =>
    expect(container.querySelector("details")?.open).toBe(true),
  );
  rerender(<AssistantMessage content={content} />);
  expect(container.querySelector("details")?.open).toBe(true);
});

test("a manual fold stays closed during further deltas, and completion resets a manual expansion", async () => {
  const { container, rerender } = render(
    <AssistantMessage content="<think>First part." streaming />,
  );
  await userEvent.click(screen.getByText("Reasoning"));
  await waitFor(() =>
    expect(container.querySelector("details")?.open).toBe(false),
  );
  rerender(
    <AssistantMessage content="<think>First part. More text." streaming />,
  );
  expect(container.querySelector("details")?.open).toBe(false);
  await userEvent.click(screen.getByText("Reasoning"));
  await waitFor(() =>
    expect(container.querySelector("details")?.open).toBe(true),
  );
  rerender(<AssistantMessage content={content} />);
  expect(container.querySelector("details")?.open).toBe(false);
});

test("saved reasoning is collapsed, empty reasoning is omitted, and ordinary Markdown remains readable", () => {
  const { container, rerender } = render(
    <AssistantMessage content={content} />,
  );
  expect(container.querySelector("details")?.open).toBe(false);
  expect(screen.getByText("The final answer.")).toBeTruthy();
  rerender(<AssistantMessage content={"<think>\n</think>## Answer"} />);
  expect(container.querySelector("details")).toBeNull();
  expect(screen.getByRole("heading", { name: "Answer" })).toBeTruthy();
  rerender(<AssistantMessage content="**Plain answer**" />);
  expect(screen.getByText("Plain answer").tagName).toBe("STRONG");
});

test.each([
  "verifying_response",
  "completed",
  "stopped",
  "failed",
  "unknown",
] as const)("model cards fold reasoning in the %s phase", (phase) => {
  const props = {
    targetId: "target",
    modelId: "model",
    body: content,
    copy: englishConversationCopy,
  };
  const { container, rerender } = render(
    <ModelAnswerCard {...props} phase="streaming" />,
  );
  expect(screen.getByText("Reasoning").closest("details")?.open).toBe(true);
  rerender(<ModelAnswerCard {...props} phase={phase} />);
  expect(screen.getByText("Reasoning").closest("details")?.open).toBe(false);
  expect(container.querySelector("script")).toBeNull();
});

test("Provider reasoning without tags collapses separately from the final answer", () => {
  const { rerender } = render(
    <AssistantMessage content="" reasoning="Plan a useful answer." streaming />,
  );
  expect(screen.getByText("Reasoning").closest("details")?.open).toBe(true);
  rerender(
    <AssistantMessage
      content="A useful answer."
      reasoning="Plan a useful answer."
    />,
  );
  const reasoning = screen.getByText("Reasoning").closest("details");
  expect(reasoning?.open).toBe(false);
  expect(reasoning?.textContent).not.toContain("A useful answer.");
  expect(screen.getByText("A useful answer.")).toBeTruthy();
});
