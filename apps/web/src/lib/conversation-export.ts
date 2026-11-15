import type { Conversation, ConversationView } from "@cove/api-contract";

export type ConversationExportFormat = "markdown" | "json";

type ConversationExport = {
  content: string;
  filename: string;
  mimeType: string;
};

export function buildConversationExport(
  view: ConversationView,
  format: ConversationExportFormat,
): ConversationExport {
  const filename = `${exportFileStem(view.title)}.${format === "markdown" ? "md" : "json"}`;
  if (format === "json") {
    return {
      content: `${JSON.stringify(view, null, 2)}\n`,
      filename,
      mimeType: "application/json;charset=utf-8",
    };
  }
  return {
    content: markdownExport(view),
    filename,
    mimeType: "text/markdown;charset=utf-8",
  };
}

export function downloadConversationExport(
  view: ConversationView,
  format: ConversationExportFormat,
): void {
  startLocalDownload(buildConversationExport(view, format));
}

export async function loadWorkspaceExportViews(
  listConversations: (archived: boolean) => Promise<Conversation[]>,
  loadConversation: (id: string) => Promise<ConversationView>,
): Promise<ConversationView[]> {
  const [active, archived] = await Promise.all([
    listConversations(false),
    listConversations(true),
  ]);
  const ids = [
    ...new Set([...active, ...archived].map((conversation) => conversation.id)),
  ];
  const views = new Array<ConversationView>(ids.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (nextIndex < ids.length) {
        const index = nextIndex++;
        views[index] = await loadConversation(ids[index]!);
      }
    }),
  );
  return views;
}

export function buildWorkspaceExport(
  views: ConversationView[],
  format: ConversationExportFormat,
): ConversationExport {
  if (format === "json") {
    return {
      content: `${JSON.stringify({ exported_at: new Date().toISOString(), conversations: views }, null, 2)}\n`,
      filename: "conversations.json",
      mimeType: "application/json;charset=utf-8",
    };
  }
  return {
    content: views.map((view) => markdownExport(view)).join("\n---\n\n"),
    filename: "conversations.md",
    mimeType: "text/markdown;charset=utf-8",
  };
}

export function downloadWorkspaceExport(
  views: ConversationView[],
  format: ConversationExportFormat,
): void {
  startLocalDownload(buildWorkspaceExport(views, format));
}

function startLocalDownload(exported: ConversationExport): void {
  const blob = new Blob([exported.content], { type: exported.mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = exported.filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

function markdownExport(view: ConversationView): string {
  const lines = [
    `# ${view.title}`,
    "",
    `- Created: ${view.created_at}`,
    `- Updated: ${view.updated_at}`,
    `- Exported locally from Cove: ${new Date().toISOString()}`,
    "",
  ];
  for (const message of view.messages) {
    lines.push(
      `## ${message.role === "assistant" ? "Assistant" : "You"}`,
      "",
      message.body,
      "",
    );
    if (message.provider_snapshot) {
      const snapshot = message.provider_snapshot;
      lines.push(
        `> Provider: ${snapshot.provider_name} (${snapshot.model_id})`,
        `> Destination: ${snapshot.destination}`,
        `> Transport: ${snapshot.transport_security}`,
        "",
      );
    }
  }
  const sources = new Map(
    (view.generation_batches ?? []).flatMap((batch) =>
      (batch.attachments ?? []).map((source) => [source.id, source] as const),
    ),
  );
  if (sources.size > 0)
    lines.push(
      "## Source snapshots",
      "",
      "Original file bytes are not included in this export. The extracted text below is the saved version supplied to Providers.",
      "",
    );
  for (const source of sources.values()) {
    lines.push(
      `### ${source.name.replace(/[\r\n]/g, " ")}`,
      "",
      `SHA-256: ${source.id}`,
      `Extraction: ${source.extraction_version}`,
      "",
    );
    for (const section of source.sections) {
      lines.push(
        `#### ${section.id}`,
        "",
        ...section.text.split("\n").map((line) => `    ${line}`),
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function exportFileStem(title: string): string {
  const compact = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");
  return compact.slice(0, 80) || "cove-conversation";
}
