// @vitest-environment jsdom

import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { renderToStaticMarkup } from "react-dom/server";
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

afterEach(cleanup);

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

test.each([
  [String.raw`$E = mc^2$`, "inline"],
  [String.raw`\(\rho_i + u_j^2\)`, "inline"],
  [String.raw`$$\frac{\partial \rho}{\partial t} + \nabla \cdot (\rho \mathbf{u}) = 0$$`, "display"],
  [String.raw`\[\boldsymbol{\tau} = \mu\left(\nabla \mathbf{u} + (\nabla \mathbf{u})^T\right)\]`, "display"],
  [String.raw`$$
\begin{aligned}
a_i &= \frac{1}{2} \\
b_j &= \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}
\end{aligned}
$$`, "display"],
])("typesets %s with accessible local math output", (content, kind) => {
  const { container } = render(<MarkdownMessage content={content} />);
  const formula = container.querySelector(`[data-math="${kind}"]`)!;
  expect(formula.querySelector(".katex")).toBeTruthy();
  expect(formula.querySelector("math annotation")?.textContent).toBe(content.replace(/^(?:\$\$?|\\[([])|(?:\$\$?|\\[)\]])$/g, ""));
  expect(formula.querySelector(".katex-html")?.getAttribute("aria-hidden")).toBe("true");
  expect(formula.hasAttribute("data-math-source")).toBe(false);
  expect(container.querySelector("em, strong")).toBeNull();
});

test("math does not consume Markdown, source text, or delimiters used as currency and code", () => {
  const literal = String.raw`Prices: $5, $10.50, and $20; $10-$30; US$50. Escapes: \$x\$ and \\(y\\) and \\[z\\].`;
  const { container } = render(<MarkdownMessage content={[
    literal,
    "`$x_i$` and ``\\(a_`b\\)``",
    "```latex\n$$x_i$$\n\\[y_j\\]\n```",
    "~~~text\n$z$\n~~~",
    "    ~~~latex\n    $$q_i$$\n    ~~~",
    "## Heading with $x_i$",
    "- **Identity $a*b_c$** and _emphasis_",
    "1. Safe [reference](https://example.com/$5) and [unsafe](javascript:alert).",
    "![Image $z$](https://example.com/remote.png)",
    "\u5BC6\u5EA6 \\(\\rho\\), and $E=mc^2$.",
  ].join("\n\n")} />);
  expect(container.querySelector("p")?.textContent).toBe(literal);
  expect(Array.from(container.querySelectorAll("code"), node => node.textContent)).toEqual([
    "$x_i$", "\\(a_`b\\)", "$$x_i$$\n\\[y_j\\]", "$z$", "    $$q_i$$",
  ]);
  expect(container.querySelectorAll("[data-math]")).toHaveLength(4);
  expect(container.querySelector("h2 .katex")).toBeTruthy();
  expect(container.querySelector("li strong .katex")).toBeTruthy();
  expect(container.querySelector("li em")?.textContent).toBe("emphasis");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/$5");
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.querySelector("img, script")).toBeNull();
  expect(container.textContent).not.toContain("\uE000COVE");
});

test.each(["$", "$$", "\\(", "\\["])("keeps incomplete %s source readable until the stream closes it", (open) => {
  const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
  const formula = `${open}\\frac{a_i}{b_j}${close}`;
  const { container, rerender } = render(<MarkdownMessage content="" />);
  for (let length = 1; length <= formula.length; length += 1) {
    const prefix = formula.slice(0, length);
    rerender(<MarkdownMessage content={`Before.\n\n${prefix}\n\n## Following heading\n\nStill **readable**.`} />);
    expect(container.querySelector("h2")?.textContent).toBe("Following heading");
    expect(container.querySelector("strong")?.textContent).toBe("readable");
    expect(container.querySelector("em")).toBeNull();
    if (length === formula.length) expect(container.querySelectorAll(".katex")).toHaveLength(1);
    else expect(container.querySelector(".katex")).toBeNull();
  }
});

test.each([
  String.raw`$\frac{a}{b$`,
  String.raw`$$\unknownCoveCommand{x}$$`,
  String.raw`\[\href{javascript:alert(1)}{click}\]`,
  String.raw`$\includegraphics{https://example.com/private.png}$`,
  String.raw`$\htmlStyle{position:fixed}{x}$`,
  String.raw`$\def\a{\a}\a$`,
  `$${"a".repeat(16_001)}$`,
])("falls back to escaped source for malformed, unsupported, or bounded math", (content) => {
  const { container } = render(<MarkdownMessage content={content} />);
  expect(container.textContent).toBe(content);
  expect(container.querySelector(".katex, img, a, script, [style]")).toBeNull();
});

test("untrusted formula text and macro definitions cannot affect other formulas", () => {
  const { container } = render(<MarkdownMessage content={String.raw`$\unsupported{<img src=x onerror=alert(1)>}$ and $\gdef\coveMacro{secret}x$ and $\coveMacro$`} />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelectorAll(".katex")).toHaveLength(1);
  expect(container.querySelectorAll("[data-math-source]")).toHaveLength(2);
  expect(container.textContent).toContain(String.raw`$\coveMacro$`);
});

test("TeX comments, escaped closing dollars, and user text resembling placeholders remain intact", () => {
  const { container } = render(<MarkdownMessage content={"\uE000COVE0\uE001\n\n" + String.raw`$a + \$5$**bold**$b_i$

$$
x % $$ is a TeX comment, not a closing delimiter.

+ y
$$`} />);
  expect(container.querySelectorAll(".katex")).toHaveLength(3);
  expect(container.querySelector("strong")?.textContent).toBe("bold");
  expect(container.textContent).toContain("\uE000COVE0\uE001");
  expect(container.querySelector("[data-math-source]")).toBeNull();
});
