import { CodeBlock } from "@/components/chat/CodeBlock";
import { messagesStyles } from "@/styles/messages";
import { cn } from "@/lib/utils";
import { memo, type ReactNode } from "react";
import { MathFormula } from "@/components/chat/MathFormula";
import { protectMarkdownMath } from "@/lib/chat/markdown-math";
import {
  useSourceNavigation,
  type SourceNavigation,
} from "@/components/chat/SourceDocuments";

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
}: {
  content: string;
}) {
  const navigation = useSourceNavigation();
  return (
    <div
      className={cn(
        messagesStyles.message_body,
        messagesStyles.message_markdown,
      )}
    >
      {renderMarkdownBlocks(content, navigation)}
    </div>
  );
});

function renderMarkdownBlocks(
  content: string,
  navigation: SourceNavigation,
): ReactNode[] {
  const math = protectMarkdownMath(content);
  const lines = math.text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const formula = math.expressions.get(line.trim());
    if (formula?.display) {
      blocks.push(<MathFormula key={`math-${blocks.length}`} {...formula} />);
      index += 1;
      continue;
    }
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const language = fence[2].trim().split(/\s+/)[0] ?? "";
      const closingFence = new RegExp(`^[ \\t]*${fence[1][0]}{${fence[1].length},}[ \\t]*$`);
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !closingFence.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <CodeBlock
          key={`code-${blocks.length}`}
          content={code.join("\n")}
          language={language}
        />,
      );
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Heading = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(
        <Heading key={`heading-${blocks.length}`}>
          {renderInline(heading[2], navigation, math)}
        </Heading>,
      );
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push(
          <li key={`item-${items.length}`}>
            {renderInline(
              (lines[index] ?? "").replace(/^\s*[-*]\s+/, ""),
              navigation,
              math,
            )}
          </li>,
        );
        index += 1;
      }
      blocks.push(<ul key={`list-${blocks.length}`}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        items.push(
          <li key={`item-${items.length}`}>
            {renderInline(
              (lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""),
              navigation,
              math,
            )}
          </li>,
        );
        index += 1;
      }
      blocks.push(<ol key={`list-${blocks.length}`}>{items}</ol>);
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index]?.trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[index] ?? "") &&
      !/^\s*[-*]\s+/.test(lines[index] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[index] ?? "") &&
      !/^[ \t]*(`{3,}|~{3,})/.test(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${blocks.length}`}>
        {renderInline(paragraph.join("\n"), navigation, math)}
      </p>,
    );
  }
  return blocks;
}

function renderInline(
  text: string,
  navigation: SourceNavigation,
  math: ReturnType<typeof protectMarkdownMath>,
): ReactNode[] {
  function renderText(value: string) {
    const parts: ReactNode[] = [];
    let copied = 0;
    math.pattern.lastIndex = 0;
    let token: RegExpExecArray | null;
    while ((token = math.pattern.exec(value))) {
      parts.push(value.slice(copied, token.index));
      const formula = math.expressions.get(token[0]);
      if (formula) parts.push(<MathFormula key={token[0]} {...formula} />);
      copied = math.pattern.lastIndex;
    }
    parts.push(value.slice(copied));
    return parts;
  }
  const nodes: ReactNode[] = [];
  const pattern =
    /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\5(?!`)|\*\*(.+?)\*\*|__(.+?)__|\*([^*]+)\*|_([^_]+)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...renderText(text.slice(lastIndex, match.index)));
    }
    const key = `inline-${nodes.length}`;
    if (match[1] !== undefined) {
      nodes.push(
        <span className="markdown-image-alt" key={key}>
          {match[1]}
        </span>,
      );
    } else if (match[3] !== undefined) {
      const openSource = navigation.resolve(match[4] ?? "");
      if (openSource) {
        nodes.push(
          <button
            type="button"
            className="cursor-pointer text-primary underline underline-offset-2"
            key={key}
            onClick={openSource}
          >
            {renderText(match[3])}
          </button>,
        );
        lastIndex = pattern.lastIndex;
        continue;
      }
      const href = safeMarkdownHref(match[4]);
      nodes.push(
        href ? (
          <a href={href} key={key} rel="noreferrer" target="_blank">
            {renderText(match[3])}
          </a>
        ) : (
          <span key={key}>{renderText(match[3])}</span>
        ),
      );
    } else if (match[5] !== undefined) {
      nodes.push(<code key={key}>{match[6]}</code>);
    } else if (match[7] !== undefined || match[8] !== undefined) {
      nodes.push(<strong key={key}>{renderText(match[7] ?? match[8])}</strong>);
    } else {
      nodes.push(<em key={key}>{renderText(match[9] ?? match[10])}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(...renderText(text.slice(lastIndex)));
  }
  return nodes;
}

function safeMarkdownHref(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return /^(?:https?:\/\/|\/|#)/i.test(value) ? value : undefined;
}
