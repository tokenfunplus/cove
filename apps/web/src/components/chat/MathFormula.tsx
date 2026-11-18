import { memo, useLayoutEffect, useRef } from "react";
import katex from "katex";
import { messagesStyles } from "@/styles/messages";
import type { MathExpression } from "@/lib/chat/markdown-math";
import "katex/dist/katex.min.css";

export const MathFormula = memo(function MathFormula({
  source,
  expression,
  display,
  complete,
}: MathExpression) {
  const rendered = useRef<HTMLSpanElement>(null);
  let html: string | undefined;
  if (complete && expression.trim() && expression.length <= 16_000) {
    try {
      let denied = false;
      html = katex.renderToString(expression, {
        displayMode: display,
        output: "htmlAndMathml",
        throwOnError: true,
        strict: "ignore",
        trust: () => {
          denied = true;
          return false;
        },
        maxExpand: 1000,
        maxSize: 20,
        // Each expression gets fresh macro state, including during streaming.
        macros: {},
      });
      if (denied) html = undefined;
    } catch {
      // Render the original source as React text, never an HTML error message.
    }
  }
  useLayoutEffect(() => {
    if (!rendered.current || html === undefined) return;
    // Keep Cove's style-src 'self': apply KaTeX's generated positioning through
    // CSSOM in an inert fragment, rather than parsing style attributes as HTML.
    // Only successful KaTeX output enters this boundary, never message source.
    const template = document.createElement("template");
    // Even inert HTML parsing reports style attributes as CSP violations. KaTeX
    // emits double-quoted attributes and escapes quotes in all source text.
    template.innerHTML = html.replaceAll(' style="', ' data-cove-math-style="');
    for (const element of template.content.querySelectorAll<HTMLElement>("[data-cove-math-style]")) {
      const style = element.getAttribute("data-cove-math-style") ?? "";
      element.removeAttribute("data-cove-math-style");
      element.style.cssText = style;
    }
    rendered.current.replaceChildren(template.content);
  }, [html]);
  const Formula = display ? "div" : "span";
  return (
    <Formula
      className={display ? messagesStyles.mathDisplay : messagesStyles.mathInline}
      data-math={display ? "display" : "inline"}
      data-math-source={html === undefined ? "" : undefined}
      tabIndex={display ? 0 : undefined}
      role={display ? "region" : undefined}
      aria-label={display ? "Mathematical expression" : undefined}
    >
      {html === undefined ? (
        source
      ) : (
        <span ref={rendered} />
      )}
    </Formula>
  );
});
