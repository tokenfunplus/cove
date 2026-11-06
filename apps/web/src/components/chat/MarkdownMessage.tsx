import { messagesStyles } from "@/styles/messages";
import { cn } from "@/lib/utils";
import { memo, type ReactNode } from "react";

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
}: {
  content: string;
}) {
  return (
    <div
      className={cn(
        messagesStyles.message_body,
        messagesStyles.message_markdown,
      )}
    >
      {renderMarkdownBlocks(content)}
    </div>
  );
});

function renderMarkdownBlocks(content: string): ReactNode[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]?.trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={`code-${blocks.length}`}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Heading = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(
        <Heading key={`heading-${blocks.length}`}>
          {renderInline(heading[2])}
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
            {renderInline((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""))}
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
            {renderInline((lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""))}
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
      !lines[index]?.trim().startsWith("```")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${blocks.length}`}>
        {renderInline(paragraph.join("\n"))}
      </p>,
    );
  }
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `inline-${nodes.length}`;
    if (match[1] !== undefined) {
      nodes.push(
        <span className="markdown-image-alt" key={key}>
          {match[1]}
        </span>,
      );
    } else if (match[3] !== undefined) {
      const href = safeMarkdownHref(match[4]);
      nodes.push(
        href ? (
          <a href={href} key={key} rel="noreferrer" target="_blank">
            {match[3]}
          </a>
        ) : (
          match[3]
        ),
      );
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push(<strong key={key}>{match[5] ?? match[6]}</strong>);
    } else if (match[7] !== undefined) {
      nodes.push(<code key={key}>{match[7]}</code>);
    } else {
      nodes.push(<em key={key}>{match[8] ?? match[9]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function safeMarkdownHref(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return /^(?:https?:\/\/|\/|#)/i.test(value) ? value : undefined;
}
