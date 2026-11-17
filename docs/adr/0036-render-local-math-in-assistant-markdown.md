# Render local math in assistant Markdown

Resolves the local rendering behavior requested in [issue #25](https://github.com/tokenfunplus/cove/issues/25).

Assistant Markdown supports inline `$...$` and `\(...\)`, and display `$$...$$` and `\[...\]`. Display expressions may span lines and include aligned equations and matrices. A presentation-only pass protects formulas before the existing Markdown parser handles emphasis and blocks. Code spans, backtick/tilde fences, escaped delimiters, and link destinations are excluded. Single-dollar math requires tight delimiters on one line; a closing dollar followed by a digit is treated as currency. Prefer the explicit parenthesis delimiters for ambiguous prose.

KaTeX 0.19.1, its stylesheet, and fonts are bundled locally. This adds no content destination, remote script, remote font, or persistence migration. The original message source remains authoritative for storage, Provider context, copying, and exports. All assistant surfaces share the same renderer during streaming and when history reloads.

Cove's CSP remains unchanged. Successful KaTeX output is parsed in an inert template; generated positioning styles are applied through CSSOM before insertion. This preserves fraction and superscript layout without permitting HTML style attributes or relaxing `style-src 'self'`.

Incomplete expressions remain readable source until their closing delimiter arrives. Unclosed expressions stop at a paragraph or Markdown block boundary so later prose remains readable. Unsupported or malformed expressions also fall back to React-escaped original source. Typesetting is limited to 16,000 UTF-16 code units per expression, 1,000 macro expansions, and 20em user-specified sizes. Macro state is fresh for each expression. Commands requiring trust, including links, images, and HTML extensions, are denied and displayed as source. Only successful KaTeX output enters the HTML rendering boundary; raw Markdown and error messages never do. MathML accompanies visual HTML for accessibility.

Display formulas have a focusable horizontal scroll region contained by the message width, including narrow Model Comparison cards. Styling follows ADR-0020's Tailwind recipes; KaTeX's bundled vendor stylesheet is the exception required for its generated layout and local fonts. Existing raw HTML, remote image, safe-link, and saved-source citation rules remain in effect.
