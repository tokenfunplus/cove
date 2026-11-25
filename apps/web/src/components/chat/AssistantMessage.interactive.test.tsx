// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { AssistantMessage } from "./AssistantMessage";
afterEach(cleanup);
test("live marked UI hides its payload and keeps surrounding prose", () => {
  const { container } = render(
    <AssistantMessage
      interactive
      streaming
      content={'Let us try this.\n``` COVE-UI\n{"cove_ui":1,"children":['}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Preparing an interactive reply",
  );
  expect(container.textContent).toContain("Let us try this.");
  expect(container.textContent).not.toContain('"cove_ui"');
});
test("interrupted UI leaves a usable fallback without raw JSON", () => {
  const { container } = render(
    <AssistantMessage interactive content={'```cove-card-v2\n{"version":'} />,
  );
  expect(screen.getByRole("status").textContent).toContain("did not finish");
  expect(container.textContent).not.toContain('"version"');
});
test("ordinary and nested JSON examples are not hidden", () => {
  const { container } = render(
    <AssistantMessage
      interactive
      streaming
      content={'````markdown\n```cove-ui\n{"cove_ui":1}\n```\n````'}
    />,
  );
  expect(screen.queryByText("Preparing an interactive reply…")).toBeNull();
  expect(container.textContent).toContain('"cove_ui"');
});

test("unfenced malformed model UI degrades without exposing the JSON stream",()=>{
 const {container}=render(<AssistantMessage interactive streaming content={'{"cove_ui":1,"title":"Pick","children":['}/>);
 expect(screen.getByText("Preparing an interactive reply…")).toBeTruthy();expect(container.textContent).not.toContain('"cove_ui"');
});
