// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("code copy preserves literal content, reports success and handles clipboard denial", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const content = "<script>neverExecute()</script>\n  spaced";
  const { container, rerender } = render(
    <CodeBlock content={content} language="html" />,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("code")?.textContent).toBe(content);
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Copied"),
  );
  expect(writeText).toHaveBeenCalledWith(content);
  rerender(<CodeBlock content="changed" language="" />);
  expect(screen.getByRole("status").textContent).toBe("");
  writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not copy");
  expect(container.querySelector("code")?.textContent).toBe("changed");
});
