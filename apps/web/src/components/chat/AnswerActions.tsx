import { answerToolsCopy as toolCopy } from "@/messages/answer-tools";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ProviderSnapshot } from "@cove/api-contract";
import { Button } from "@/components/ui/button";
import { answerToolsStyles as styles } from "@/styles/answer-tools";
import { MessageSquarePlus, SquarePen } from "lucide-react";

export interface AnswerSource {
  messageId: string;
  conversationId: string;
  body: string;
  snapshot?: ProviderSnapshot;
}

export const AnswerToolsContext = createContext<
  | {
      busy: boolean;
      ask: (source: AnswerSource, quote: string, question?: string) => void;
      edit: (source: AnswerSource) => void;
    }
  | undefined
>(undefined);

export function AnswerActions({
  source,
  children,
}: {
  source: AnswerSource;
  children: ReactNode;
}) {
  const tools = useContext(AnswerToolsContext);
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
  }>();
  useEffect(() => {
    if (!tools) return;
    const clear = () => setSelection(undefined);
    document.addEventListener("scroll", clear, true);
    const onSelectionChange = () => {
      const current = window.getSelection();
      if (
        !current?.toString().trim() ||
        !root.current?.contains(current.anchorNode) ||
        !root.current.contains(current.focusNode)
      )
        clear();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("scroll", clear, true);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [Boolean(tools)]);
  function captureSelection() {
    const current = window.getSelection();
    if (
      !current ||
      current.isCollapsed ||
      !root.current?.contains(current.anchorNode) ||
      !root.current.contains(current.focusNode)
    ) {
      setSelection(undefined);
      return;
    }
    const text = current.toString().trim();
    if (!text || text.length > 8000) {
      setSelection(undefined);
      return;
    }
    const rectangle = current.getRangeAt(0).getBoundingClientRect();
    setSelection({
      text,
      x: Math.max(12, Math.min(rectangle.left, window.innerWidth - 300)),
      y: Math.max(12, Math.min(rectangle.bottom + 6, window.innerHeight - 100)),
    });
  }
  return (
    <>
      <div
        ref={root}
        data-answer-source={source.messageId}
        onPointerUp={captureSelection}
        onKeyUp={captureSelection}
      >
        {children}
      </div>
      {tools && (
        <div className={styles.actions}>
          <Button
            size="xs"
            variant="ghost"
            disabled={tools.busy}
            onClick={() => tools.ask(source, source.body.slice(0, 8000))}
          >
            <MessageSquarePlus aria-hidden="true" />
            {source.body.length > 8000
              ? toolCopy.askExcerpt
              : toolCopy.askAnswer}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={tools.busy || source.body.length > 120000}
            onClick={() => tools.edit(source)}
          >
            <SquarePen aria-hidden="true" />
            {toolCopy.editAnswer}
          </Button>
        </div>
      )}
      {tools && selection && (
        <div
          role="toolbar"
          aria-label={toolCopy.selectedTextActions}
          className={styles.toolbar}
          style={{ left: selection.x, top: selection.y }}
          onPointerDown={(event) => event.preventDefault()}
        >
          {[
            [toolCopy.explain, toolCopy.explainQuestion],
            [toolCopy.example, toolCopy.exampleQuestion],
            [toolCopy.askSelection, ""],
          ].map(([label, question]) => (
            <Button
              key={label}
              size="sm"
              variant="ghost"
              disabled={tools.busy}
              onClick={() => {
                tools.ask(source, selection.text, question);
                setSelection(undefined);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
