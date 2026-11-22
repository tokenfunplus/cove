import { usePreviewAttachment } from "@/api/hooks/useGenerations";
import { LocalServiceError, prepareWebSource, releaseWebSource } from "@/api";
import type { AttachmentInput, AttachmentSnapshot } from "@cove/api-contract";
import { useEffect, useRef, useState } from "react";

export type DraftAttachment = {
  key: string;
  name: string;
  input?: AttachmentInput;
  snapshot?: AttachmentSnapshot;
  webSourceToken?: string;
  expiresAt?: number;
  sourceUrl?: string;
  error?: string;
};

function expireAttachments(items: DraftAttachment[]) {
  return items.map(item => item.webSourceToken && item.expiresAt !== undefined && Date.now() >= item.expiresAt
    ? { ...item, error: "The webpage preview expired. Remove it and read the webpage again." }
    : item);
}

export function useAttachmentDraft(conversationId?: string) {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [selectionError, setSelectionError] = useState<string>();
  const transfer=useRef<{id:string;items:DraftAttachment[]}|undefined>(undefined);
  const epoch = useRef(0);
  const count = useRef(0);
  const preview = usePreviewAttachment().mutateAsync;
  const webRequests = useRef(new Map<string, AbortController>());
  const webTokens = useRef(new Map<string, string>());
  useEffect(() => {
    const next = Math.min(...attachments.filter(item => item.webSourceToken && !item.error && item.expiresAt !== undefined).map(item => item.expiresAt!));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setAttachments(expireAttachments), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [attachments]);
  useEffect(() => {
    if(transfer.current && transfer.current.id===conversationId){const items=transfer.current.items;transfer.current=undefined;clearAttachments(false);restoreAttachments(items);}else{clearAttachments();}
  }, [conversationId]);
  useEffect(
    () => () => {
      epoch.current++;
      for (const request of webRequests.current.values()) request.abort();
      for (const token of webTokens.current.values()) {
        void releaseWebSource(token).catch(() => undefined);
      }
    },
    [],
  );

  function clearAttachments(releaseSources = true) {
    epoch.current++;
    for (const request of webRequests.current.values()) request.abort();
    webRequests.current.clear();
    if (releaseSources) {
      for (const token of webTokens.current.values()) {
        void releaseWebSource(token).catch(() => undefined);
      }
    }
    webTokens.current.clear();
    count.current = 0;
    setAttachments([]);
    setSelectionError(undefined);
  }
  function restoreAttachments(items: DraftAttachment[]) {
    for (const item of items) {
      if (item.webSourceToken) webTokens.current.set(item.key, item.webSourceToken);
    }
    count.current = items.length;
    setAttachments(expireAttachments(items));
  }
  function removeAttachment(key: string) {
    webRequests.current.get(key)?.abort();
    webRequests.current.delete(key);
    const token = webTokens.current.get(key);
    if (token) void releaseWebSource(token).catch(() => undefined);
    webTokens.current.delete(key);
    count.current = Math.max(0, count.current - 1);
    setAttachments((current) => current.filter((item) => item.key !== key));
  }
  async function addWebSource(url: string) {
    if (count.current >= 4) {
      setSelectionError("Attach at most four files or webpages per message.");
      return;
    }
    const key = crypto.randomUUID();
    const controller = new AbortController();
    const currentEpoch = epoch.current;
    const requestedAt = Date.now();
    count.current++;
    setSelectionError(undefined);
    webRequests.current.set(key, controller);
    setAttachments((current) => [
      ...current,
      { key, name: url, sourceUrl: url },
    ]);
    try {
      const source = await prepareWebSource(url, controller.signal);
      if (epoch.current !== currentEpoch || controller.signal.aborted) {
        void releaseWebSource(source.source_token).catch(() => undefined);
        return;
      }
      webTokens.current.set(key, source.source_token);
      setAttachments((current) => current.map((item) =>
        item.key === key
          ? {
              ...item,
              name: source.snapshot.name,
              snapshot: source.snapshot,
              webSourceToken: source.source_token,
              expiresAt: source.expires_at ? Date.parse(source.expires_at) : requestedAt + 15 * 60 * 1000,
            }
          : item,
      ));
    } catch (error) {
      if (epoch.current !== currentEpoch || controller.signal.aborted) return;
      const message =
        error instanceof LocalServiceError
          ? error.envelope.error.message
          : "The webpage could not be read. Check the URL and try again.";
      setAttachments((current) => current.map((item) =>
        item.key === key ? { ...item, error: message } : item,
      ));
    } finally {
      webRequests.current.delete(key);
    }
  }
  async function addAttachments(files: File[]) {
    setSelectionError(
      files.length + count.current > 4
        ? "Only the first four files can be attached. Add remaining files in another message."
        : undefined,
    );
    const currentEpoch = epoch.current;
    for (const file of files) {
      if (count.current >= 4 || epoch.current !== currentEpoch) break;
      const key = crypto.randomUUID();
      count.current++;
      setAttachments((current) => [...current, { key, name: file.name }]);
      try {
        if (file.size === 0 || file.size > 4 * 1024 * 1024)
          throw new Error("Each file must contain between 1 byte and 4 MiB.");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(String(reader.result).split(",", 2)[1] ?? "");
          reader.onerror = () =>
            reject(new Error("The file could not be read."));
          reader.readAsDataURL(file);
        });
        const input = { name: file.name, data };
        const snapshot = await preview(input);
        if (epoch.current !== currentEpoch) continue;
        setAttachments((current) =>
          current.map((item) =>
            item.key === key
              ? current.some(
                  (other) =>
                    other.key !== key && other.snapshot?.id === snapshot.id,
                )
                ? {
                    ...item,
                    error: "The same file content is already attached.",
                  }
                : { ...item, input, snapshot }
              : item,
          ),
        );
      } catch (error) {
        if (epoch.current !== currentEpoch) continue;
        const message =
          error instanceof LocalServiceError
            ? error.envelope.error.message
            : error instanceof Error
              ? error.message
              : "The file could not be parsed.";
        setAttachments((current) =>
          current.map((item) =>
            item.key === key ? { ...item, error: message } : item,
          ),
        );
      }
    }
  }
  const totalCharacters = attachments.reduce(
    (sum, item) => sum + (item.snapshot?.characters ?? 0),
    0,
  );
  const invalid =
    attachments.some((item) => !item.snapshot || (!item.input && !item.webSourceToken) || item.error) ||
    totalCharacters > 120000;
  function validateAttachments() {
    const current = expireAttachments(attachments);
    if (current.some(item => item.error)) {
      setAttachments(current);
      return false;
    }
    return !invalid;
  }
  return {
    transferToConversation:(id:string,items:DraftAttachment[])=>{transfer.current={id,items};},
    attachments,
    restoreAttachments,
    addAttachments,
    addWebSource,
    removeAttachment,
    clearAttachments,
    totalCharacters,
    invalid,
    validateAttachments,
    selectionError,
  };
}

export type AttachmentDraft = ReturnType<typeof useAttachmentDraft>;
