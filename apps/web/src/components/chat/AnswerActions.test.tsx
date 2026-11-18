// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AnswerActions, AnswerToolsContext } from "@/components/chat/AnswerActions";

afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); });

test("selecting rendered answer text opens a follow-up anchored to that answer", () => {
  const ask = vi.fn();
  const source = { messageId: "answer", conversationId: "main", body: "A detailed answer." };
  render(<AnswerToolsContext.Provider value={{ ask, edit: vi.fn(), busy: false }}><AnswerActions source={source}><p>A detailed answer.</p></AnswerActions></AnswerToolsContext.Provider>);
  const paragraph = screen.getByText("A detailed answer.");
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  Object.defineProperty(range, "getBoundingClientRect", { value: () => ({ left: 20, bottom: 30 }) });
  window.getSelection()?.addRange(range);
  fireEvent.pointerUp(paragraph);
  expect(screen.getByRole("toolbar", { name: "Selected text actions" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  expect(ask).toHaveBeenCalledWith(source, "A detailed answer.", "Explain this passage.");
});
