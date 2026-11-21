import type { Conversation, ConversationView, GenerationBatch, Message } from "@cove/api-contract";
import { debateMarkdown } from "@/lib/debate-export";

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
  if (view.debate_export) return debateMarkdown(view.debate_export);
  const lines = [
    `# ${view.title}`,
    "",
    `- Created: ${view.created_at}`,
    `- Updated: ${view.updated_at}`,
    `- Exported locally from Cove: ${new Date().toISOString()}`,
    "",
  ];
  if(view.branch) lines.push(`Branch of: ${view.branch.source_title}`, `Source conversation: ${view.branch.source_conversation_id}`, `Edited source batch: ${view.branch.source_batch_id}`, "Earlier messages are copied context; their evidence belongs to the original responses.", "");
  const batches = view.generation_batches ?? [];
  const byUser = new Map(batches.map((batch) => [batch.user_message_id, batch]));
  if (batches.some((batch) => batch.targets.length > 1)) {
    lines.push(
      "Answer selections below describe saved state at export time. Later Generations retain their own immutable Context Snapshots; these labels do not rewrite their context.",
      "",
    );
  }
  const emitted = new Set<string>();
  const answerBatches = new Map(batches.flatMap((batch) => [
    ...batch.targets.map((target) => [target.generation.assistant_message_id, batch.id] as const),
    [batch.selected_answer?.assistant_message_id, batch.id] as const,
  ]));
  const answersByBatch = new Map<string, Message[]>();
  for (const message of view.messages) {
    const batchId = message.generation_batch_id ?? answerBatches.get(message.id);
    if (batchId) answersByBatch.set(batchId, [...(answersByBatch.get(batchId) ?? []), message]);
  }
  function appendMessage(message: Message, batch?: GenerationBatch) {
    emitted.add(message.id);
    const heading = batch ? "###" : "##";
    lines.push(
      `${heading} ${message.role === "assistant" ? "Assistant" : "You"}`,
      "",
      ...(message.reasoning ? ["<details>", "<summary>Reasoning</summary>", "", message.reasoning, "", "</details>", ""] : []),
      message.body,
      "",
    );
    if (message.role === "user" && batch) {
      const selected = batch.targets.find(
        (target) => target.generation.id === batch.selected_generation_id,
      );
      const selectedName = batch.selected_answer
        ? `${batch.selected_answer.provider_name} (${batch.selected_answer.model_id}), `
        : selected ? `${selected.generation.snapshot.provider_name} (${selected.model_id}), ` : "";
      const disposition = batch.context_skipped
        ? "Skipped for later context"
        : batch.selected_generation_id
          ? `Selected Answer at export: ${selectedName}Generation ${batch.selected_generation_id}`
          : batch.targets.length > 1
            ? "Unresolved comparison: no Selected Answer; not skipped"
            : "No completed answer selected";
      lines.push(`> Context disposition: ${disposition}`, "");
    }
    if (message.role === "assistant" && batch?.targets.length) {
      const target = batch.targets.find(
        (item) => item.generation.assistant_message_id === message.id,
      );
      if (target?.generation.configuration_snapshot.web_search) {
        const info = target.generation.web_search;
        lines.push(`> Web research: ${info?.provider ?? target.generation.configuration_snapshot.web_search.provider}; ${info?.searches ?? 0} searches; ${info?.pages ?? 0} page reads`, "");
        for (const step of info?.steps ?? []) lines.push(`- ${step.name}: ${JSON.stringify(step.query ?? step.url)} (${step.cached ? "cached" : step.status})${step.error ? ` — ${step.error}` : ""}${step.usage == null ? "" : `; reported usage: ${JSON.stringify(step.usage)}`}`);
        lines.push("");
      }
      if ((target && target.generation.id === batch.selected_generation_id) || batch.selected_answer?.assistant_message_id === message.id) {
        lines.push("> Selected Answer at export", "");
      }
    }
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
  let turn = 0;
  for (const message of view.messages) {
    if (emitted.has(message.id)) continue;
    if (message.role === "user") turn++;
    const batch = message.role === "user" ? byUser.get(message.id) : undefined;
    if (!batch) {
      appendMessage(message);
      continue;
    }
    lines.push(`## Turn ${turn}`, "");
    appendMessage(message, batch);
    for (const answer of answersByBatch.get(batch.id) ?? []) {
      if (!emitted.has(answer.id)) appendMessage(answer, batch);
    }
  }
  const sources = new Map(
    [...(view.generation_batches ?? []).flatMap(batch => [...(batch.attachments ?? []), ...batch.targets.flatMap(target => target.generation.web_search?.sources ?? [])]), ...view.messages.flatMap(message => message.web_sources ?? [])].map(source => [source.id, source] as const),
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
      `${source.web ? "Snapshot ID" : "SHA-256"}: ${source.id}`,
      `Extraction: ${source.extraction_version}`,
      "",
    );
    if (source.web) lines.push(
      `Original URL: ${source.web.original_url}`,
      `Final URL: ${source.web.final_url}`,
      `Capture type: ${source.web.kind === "search_result" ? "Search excerpt" : "Retrieved webpage"}`,
      `Saved at: ${source.web.fetched_at}`,
      ...(source.web.published_at ? [`Published at: ${source.web.published_at}`] : []),
      `Content SHA-256: ${source.web.content_sha256}`,
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
