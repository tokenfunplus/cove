import { usePreviewAttachment } from "@/api/hooks/useGenerations";
import { LocalServiceError } from "@/api";
import type { AttachmentInput, AttachmentSnapshot } from "@cove/api-contract";
import { useEffect, useRef, useState } from "react";

export type DraftAttachment = {
  key: string;
  name: string;
  input?: AttachmentInput;
  snapshot?: AttachmentSnapshot;
  error?: string;
};

export function useAttachmentDraft(conversationId?: string) {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [selectionError, setSelectionError] = useState<string>();
  const epoch = useRef(0);
  const count = useRef(0);
  const preview = usePreviewAttachment().mutateAsync;
  useEffect(() => {
    clearAttachments();
  }, [conversationId]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );

  function clearAttachments() {
    epoch.current++;
    count.current = 0;
    setAttachments([]);
    setSelectionError(undefined);
  }
  function restoreAttachments(items: DraftAttachment[]) {
    count.current = items.length;
    setAttachments(items);
  }
  function removeAttachment(key: string) {
    count.current = Math.max(0, count.current - 1);
    setAttachments((current) => current.filter((item) => item.key !== key));
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
    attachments.some((item) => !item.snapshot || !item.input || item.error) ||
    totalCharacters > 120000;
  return {
    attachments,
    restoreAttachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
    totalCharacters,
    invalid,
    selectionError,
  };
}

export type AttachmentDraft = ReturnType<typeof useAttachmentDraft>;
