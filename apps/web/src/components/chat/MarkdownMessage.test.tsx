import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("assistant messages render basic Markdown without raw HTML or remote images", () => {
  const markup = renderToStaticMarkup(
    <MarkdownMessage
      content={
        '## Heading\n\n**bold** and `code`\n\n<script>alert("x")</script>\n\n![remote image](https://example.com/image.png)'
      }
    />,
  );

  expect(markup).toContain("<h2>Heading</h2>");
  expect(markup).toContain("<strong>bold</strong>");
  expect(markup).toContain("<code>code</code>");
  expect(markup).not.toContain("<script>");
  expect(markup).not.toContain("<img");
  expect(markup).toContain("remote image");
});
