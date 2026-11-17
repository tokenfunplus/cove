import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AttachmentSnapshot,
  GenerationBatch,
  GenerationContextMessage,
} from "@cove/api-contract";
import { fetchLocalService } from "@/api/client";
import { useGenerationCache } from "@/api/hooks/useGenerations";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";
import { englishConversationCopy as copy } from "@/messages";

type SavedSource = { document: AttachmentSnapshot; batchId?: string };
export type SourceNavigation = {
  resolve: (url: string) => (() => void) | undefined;
};
const Sources = createContext<SourceNavigation>({ resolve: () => undefined });
export function useSourceNavigation() {
  return useContext(Sources);
}

export function SourceDocuments({
  batches,
  children,
}: {
  batches: GenerationBatch[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<
    SavedSource & { section?: string }
  >();
  const sources = batches.flatMap((batch) =>
    (batch.attachments ?? []).map((document) => ({
      document,
      batchId: batch.id,
    })),
  );
  // Source snapshots are immutable; streaming state changes do not invalidate history rendering.
  const identity = sources
    .map(
      (source) =>
        `${source.batchId}:${source.document.id}:${source.document.extraction_version}`,
    )
    .join("|");
  const navigation = useMemo<SourceNavigation>(
    () => ({
      resolve(url: string) {
        const match = /^cove:([a-f0-9]{64}):([LP][1-9]\d*)$/.exec(url);
        if (!match) return undefined;
        const source = sources.find(
          (item) =>
            item.document.id === match[1] &&
            item.document.sections.some((section) => section.id === match[2]),
        );
        return source
          ? () => setSelected({ ...source, section: match[2] })
          : undefined;
      },
    }),
    [identity],
  );
  return (
    <Sources.Provider value={navigation}>
      {children}
      {selected && (
        <DocumentPreview {...selected} onClose={() => setSelected(undefined)} />
      )}
    </Sources.Provider>
  );
}

export function DocumentPreview({
  document,
  batchId,
  section,
  onClose,
}: SavedSource & { section?: string; onClose: () => void }) {
  const highlighted = useRef<HTMLDivElement>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "pending" | "failed">("idle");

  async function downloadOriginal() {
    if (!batchId) return;
    setDownloadState("pending");
    try {
      const response = await fetchLocalService(
        `/api/generation-batches/${encodeURIComponent(batchId)}/attachments/${encodeURIComponent(document.id)}`,
      );
      if (!response.ok) throw new Error("Source download failed");
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadState("idle");
    } catch {
      setDownloadState("failed");
    }
  }

  useEffect(() => {
    highlighted.current?.scrollIntoView?.({ block: "center" });
  }, [section]);
  return (
    <Dialog
      open
      onClose={onClose}
      label={document.name}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
    >
      <DialogOverlay />
      <DialogContent className="flex max-h-[85dvh] w-full max-w-3xl flex-col gap-3 rounded-2xl p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words font-semibold">{document.name}</h2>
            <p className="text-sm text-muted-foreground">
              {copy.sourceSnapshot} · {document.characters.toLocaleString()}{" "}
              {copy.characters}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.close}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {copy.sourceCitationNotice}
        </p>
        <div
          className="min-h-0 overflow-auto rounded-lg border border-border"
          tabIndex={0}
          aria-label={copy.sourceText}
        >
          {document.sections.map((item) => (
            <div
              key={item.id}
              ref={item.id === section ? highlighted : undefined}
              className={`grid grid-cols-[3rem_minmax(0,1fr)] gap-3 px-3 py-1 text-sm ${item.id === section ? "bg-accent text-accent-foreground" : ""}`}
            >
              <span className="select-none font-mono text-muted-foreground">
                {item.id}
              </span>
              <pre className="whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]">
                {item.text || " "}
              </pre>
            </div>
          ))}
        </div>
        <details className="text-xs text-muted-foreground">
          <summary>{copy.sourceFileDetails}</summary>
          <p className="mt-2 break-all">SHA-256: {document.id}</p>
          <p>
            {document.extraction_version} · {document.size.toLocaleString()}{" "}
            bytes
          </p>
        </details>
        {batchId && (
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={downloadState === "pending"}
              onClick={() => void downloadOriginal()}
            >
              {copy.downloadOriginal}
            </Button>
            {downloadState === "failed" && <p role="alert">{copy.sourceDownloadFailed}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function BatchSources({
  batch,
  userBody,
}: {
  batch: GenerationBatch;
  userBody: string;
}) {
  const [selected, setSelected] = useState<AttachmentSnapshot>();
  return (
    <div
      className="my-2 flex flex-wrap items-center gap-2"
      aria-label={copy.sources}
    >
      {(batch.attachments ?? []).map((document) => (
        <Button
          key={document.id}
          type="button"
          variant="outline"
          className="h-auto max-w-full whitespace-normal break-words py-1 text-xs"
          onClick={() => setSelected(document)}
        >
          {document.name}
        </Button>
      ))}
      <ContextSnapshotButton batch={batch} userBody={userBody} />
      {selected && (
        <DocumentPreview
          document={selected}
          batchId={batch.id}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}

function ContextSnapshotButton({
  batch,
  userBody,
}: {
  batch: GenerationBatch;
  userBody: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-auto py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        {copy.viewContext}
      </Button>
      {open && (
        <ContextSnapshotDialog
          batch={batch}
          userBody={userBody}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ContextSnapshotDialog({
  batch,
  userBody,
  onClose,
}: {
  batch: GenerationBatch;
  userBody: string;
  onClose: () => void;
}) {
  const [context, setContext] = useState<GenerationContextMessage[]>();
  const [error, setError] = useState(false);
  const [targetIndex, setTargetIndex] = useState(0);
  const { loadContext } = useGenerationCache();
  const target = batch.targets[targetIndex] ?? batch.targets[0];
  const prompt = target?.generation.configuration_snapshot.system_prompt ?? "";
  const current = batch.input_content ?? userBody;
  const characters = [
    prompt,
    current,
    ...(context ?? []).map((item) => item.content),
  ].reduce((sum, text) => sum + Array.from(text).length, 0);
  useEffect(() => {
    let disposed = false;
    setError(false);
    setContext(undefined);
    void loadContext(batch.id)
      .then((value) => {
        if (!disposed) setContext(value);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
    };
  }, [batch.id]);
  return (
    <Dialog
      open
      onClose={onClose}
      label={copy.contextSnapshot}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
    >
      <DialogOverlay />
      <DialogContent className="flex max-h-[85dvh] w-full max-w-3xl flex-col gap-3 rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{copy.contextSnapshot}</h2>
          <Button variant="outline" onClick={onClose}>
            {copy.close}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {copy.contextSourceNotice}
        </p>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {copy.model}
          <select
            className="max-w-full rounded-md border border-border bg-background p-2"
            value={targetIndex}
            onChange={(event) => setTargetIndex(Number(event.target.value))}
          >
            {batch.targets.map((item, index) => (
              <option value={index} key={item.id}>
                {item.model_id}
              </option>
            ))}
          </select>
        </label>
        {context ? (
          <p className="text-sm">
            {characters.toLocaleString()} / 240,000 {copy.characters} ·{" "}
            {copy.contextBudgetNotice}
          </p>
        ) : (
          <p role="status">{error ? copy.contextLoadFailed : copy.loading}</p>
        )}
        {error && (
          <Button variant="outline" onClick={onClose}>
            {copy.close}
          </Button>
        )}
        {context && (
          <div
            className="min-h-0 space-y-4 overflow-auto text-sm"
            tabIndex={0}
            aria-label={copy.contextSnapshot}
          >
            {prompt && <ContextEntry role="System" content={prompt} />}
            {context.map((item, index) => (
              <ContextEntry
                key={index}
                role={item.role}
                content={item.content}
              />
            ))}
            <ContextEntry role="user" content={current} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContextEntry({ role, content }: { role: string; content: string }) {
  return (
    <div>
      <p className="mb-1 font-semibold capitalize">{role}</p>
      <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs [overflow-wrap:anywhere]">
        {content}
      </pre>
    </div>
  );
}
