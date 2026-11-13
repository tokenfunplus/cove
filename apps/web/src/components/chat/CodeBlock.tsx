import { messagesStyles } from "@/styles/messages";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { englishConversationCopy as copy } from "@/messages";

export function CodeBlock({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    setStatus("idle");
  }, [content]);
  useEffect(() => {
    if (status !== "copied") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  return (
    <div className={messagesStyles.codeBlock}>
      <div className={messagesStyles.codeBlock_toolbar}>
        <span className={messagesStyles.codeBlock_language}>
          {language || copy.code}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={copy.copyCode}
          onClick={async () =>
            setStatus((await copyText(content)) ? "copied" : "failed")
          }
        >
          {status === "copied" ? copy.copied : copy.copy}
        </Button>
      </div>
      {status === "failed" && (
        <p role="alert" className={messagesStyles.codeBlock_error}>
          {copy.copyFailed}
        </p>
      )}
      <pre className={messagesStyles.codeBlock_pre}>
        <code>{content}</code>
      </pre>
      <span className="sr-only" role="status">
        {status === "copied" ? copy.copied : ""}
      </span>
    </div>
  );
}
