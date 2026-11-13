import { verificationStyles } from "@/styles/verification";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GenerationVerification,
  VerificationEvidence,
} from "@cove/api-contract";
import { Button } from "@/components/ui/button";
import {
  connectVerificationViewer,
  verificationReports,
} from "@/lib/verification/viewer";
import { englishConversationCopy } from "@/messages";

export function NearAIVerificationFrame({
  evidence,
  modelId,
  verification,
  onClose,
}: {
  evidence?: VerificationEvidence;
  modelId?: string;
  verification?: GenerationVerification;
  onClose: () => void;
}) {
  const copy = englishConversationCopy;
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.theme === "dark",
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const reports = useMemo(
    () => verificationReports(evidence, modelId, verification),
    [evidence, modelId, verification],
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === "dark"),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!frame || !reports.length) return;
    setState("loading");
    try {
      return connectVerificationViewer(frame, reports, dark, {
        ready: () => setState("ready"),
        error: () => setState("error"),
        close: () => closeRef.current(),
      });
    } catch {
      setState("error");
    }
  }, [frame, reports, dark, attempt]);
  if (!reports.length)
    return (
      <p role="status" className={verificationStyles.viewer_empty}>
        {copy.verificationViewerLegacy}
      </p>
    );
  return (
    <section
      aria-label={copy.verificationViewerTitle}
      className={verificationStyles.viewer_frame}
    >
      {state !== "ready" && (
        <div
          className={verificationStyles.viewer_overlay}
          role={state === "error" ? "alert" : "status"}
        >
          <p className={verificationStyles.viewer_status}>
            {state === "error"
              ? copy.verificationViewerFailed
              : copy.verificationViewerLoading}
          </p>
          {state === "error" && (
            <Button
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {copy.verificationViewerReload}
            </Button>
          )}
        </div>
      )}
      <iframe
        ref={setFrame}
        title={copy.verificationViewerTitle}
        allow="clipboard-write"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin"
        tabIndex={state === "ready" ? 0 : -1}
        aria-hidden={state !== "ready"}
        onError={() => setState("error")}
        className={verificationStyles.viewer_iframe}
      />
    </section>
  );
}
