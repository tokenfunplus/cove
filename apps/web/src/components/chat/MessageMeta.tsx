import { messagesStyles } from "@/styles/messages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VerificationLanes } from "@/components/verification/VerificationLanes";
import { formatTime } from "@/lib/format-date";
import { type SecureInferenceMode } from "@/lib/inference/secure-inference";
import { type ApplicationCopy } from "@/messages";
import { type GenerationVerification } from "@cove/api-contract";
import { ChevronDown, Info } from "lucide-react";
import { useId, useState } from "react";

export function MessageMeta({
  role,
  providerName,
  modelId,
  createdAt,
  verification,
  copy,
  mode,
}: {
  role: string;
  providerName?: string;
  modelId?: string;
  createdAt?: string;
  verification?: GenerationVerification;
  copy: ApplicationCopy;
  mode?: SecureInferenceMode;
}) {
  const isAssistant = role === "assistant";
  return (
    <div
      className={cn(
        messagesStyles.message_role,
        `message__role message__role--${role} byline`,
      )}
      data-message-meta={role}
    >
      <span className={messagesStyles.message_roleName}>
        {isAssistant ? (
          <>
            via <b>{providerName ?? copy.assistant}</b>
          </>
        ) : (
          copy.you
        )}
      </span>
      {modelId ? <code>{modelId}</code> : null}
      {isAssistant && (verification || mode) ? (
        <VerificationLanes
          copy={copy}
          mode={mode}
          verification={verification}
        />
      ) : null}
      {createdAt ? (
        <time className={messagesStyles.message_timestamp} dateTime={createdAt}>
          {formatTime(createdAt)}
        </time>
      ) : null}
    </div>
  );
}

export function MessageFootnote({
  providerName,
  notice,
  copy,
}: {
  providerName?: string;
  notice?: string;
  copy: ApplicationCopy;
}) {
  const [open, setOpen] = useState(false);
  const noticeId = useId();
  return (
    <>
      <Button
        variant="ghost"
        aria-controls={noticeId}
        aria-expanded={open}
        className={messagesStyles.message_privacyToggle}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Info aria-hidden="true" size={14} />
        {copy.privacyNoticeToggle}
        <ChevronDown aria-hidden="true" size={13} />
      </Button>
      <div
        id={noticeId}
        hidden={!open}
        className={messagesStyles.message_privacyFootnote}
      >
        <p>
          This turn was sent to{" "}
          <strong>{providerName ?? copy.assistant}</strong> for computation.{" "}
          {notice}
        </p>
        <p className={messagesStyles.message_privacyFootnote_src}>
          {copy.privacyNoticeSource}
        </p>
      </div>
    </>
  );
}
