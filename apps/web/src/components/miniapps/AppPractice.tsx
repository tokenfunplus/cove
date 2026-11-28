import "./study-book.css";
import { StudyDialog } from "./StudyDialog";
import { BookOpen, Check, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  MiniAppPackage,
  MiniAppRecord,
  MiniAppInvocation,
} from "@cove/api-contract";
import { LocalReading } from "./AppProcessing";
import { miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ErrorMessage, Fields } from "./presentation";

interface Props {
  modal?: boolean;
  instance: string;
  revision: number;
  allowReading: boolean;
  pkg: MiniAppPackage;
  practice: NonNullable<MiniAppPackage["pages"][number]["practice"]>;
  records: MiniAppRecord[];
  finish: () => void;
  changed: () => void;
  refresh?: () => Promise<void>;
}

// Keep the reviewed revisions for this session even when another tab edits a card.
export function AppPractice({
  modal = false,
  instance,
  revision,
  allowReading,
  pkg,
  practice,
  records,
  finish,
  changed,
  refresh,
}: Props) {
  const [index, setIndex] = useState(0);
  const [shown, show] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{
    command: MiniAppInvocation;
    fields: MiniAppRecord["fields"];
  }>();
  const record = records[index];
  const mark = useMutation({
    retry: false,
    mutationFn: async (command: MiniAppInvocation) => {
      const result = await miniApps.invoke(instance, {
        ...command,
        expected_instance_revision: revision,
      });
      if (!command.confirm) {
        if (!result.confirmation || !result.records?.[0])
          throw new Error("This change could not be previewed.");
        setPreview({
          command: { ...command, confirm: result.confirmation },
          fields: result.records[0].fields,
        });
        return;
      }
      setCounts((old) => ({
        ...old,
        [command.action]: (old[command.action] ?? 0) + 1,
      }));
      setIndex((i) => i + 1);
      setPreview(undefined);
      show(false);
      changed();
    },
  });
  const conflict =
    (mark.error as { envelope?: { error?: { code?: string } } })?.envelope
      ?.error?.code === "conflict";
  const refreshQueue = useMutation({
    retry: false,
    mutationFn: async () => {
      if (refresh) await refresh();
      else changed();
      finish();
    },
  });
  const busy = mark.isPending || refreshQueue.isPending;
  const content = (
    <section className="study-session space-y-5" aria-label="Practice session">
      <div className="flex items-center justify-between gap-4">
        <span className="study-kicker">
          <BookOpen className="size-4" /> Practice session
        </span>
        <h3 className="text-sm text-muted-foreground" aria-live="polite">
          {record
            ? `Card ${index + 1} of ${records.length}`
            : "Practice complete"}
        </h3>
      </div>
      <progress
        className="study-progress"
        aria-label="Session progress"
        value={index}
        max={Math.max(records.length, 1)}
      />
      <div className="study-session-card">
        {record ? (
          <>
            <p className="text-xs text-muted-foreground">
              Recall the answer before turning the card.
            </p>
            <p className="study-session-question">
              {String(record.fields[practice.front])}
            </p>
            {shown ? (
              <div className="study-session-answer">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Answer
                </p>
                {String(record.fields[practice.back])}
              </div>
            ) : (
              <Button
                className="h-11 rounded-xl px-6"
                onClick={() => show(true)}
              >
                Show answer <ArrowRight className="size-4" />
              </Button>
            )}
            {allowReading && pkg.speech_language && (
              <div className="mt-4">
                <LocalReading
                  key={record.id + (shown ? "/back" : "/front")}
                  path={
                    "/api/mini-apps/instances/" +
                    encodeURIComponent(instance) +
                    "/speech"
                  }
                  language={pkg.speech_language}
                  text={String(
                    record.fields[shown ? practice.back : practice.front],
                  )}
                />
              </div>
            )}
            {shown && !preview && (
              <div className="mt-6 flex flex-wrap gap-3">
                {practice.outcomes.map((action) => (
                  <Button
                    variant="outline"
                    key={action}
                    disabled={busy}
                    onClick={() =>
                      mark.mutate({
                        action,
                        surface: "page",
                        operation_id: crypto.randomUUID(),
                        inputs: {},
                        records: [{ id: record.id, revision: record.revision }],
                      })
                    }
                  >
                    {pkg.actions[action].title}
                  </Button>
                ))}
              </div>
            )}
            {preview && (
              <div className="mt-6 space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="font-medium">
                  {pkg.actions[preview.command.action].title}
                </p>
                <p className="text-sm text-muted-foreground">
                  Review the change to this card.
                </p>
                <Fields
                  fields={Object.fromEntries(
                    Object.entries(preview.fields).filter(
                      ([key, value]) => record.fields[key] !== value,
                    ),
                  )}
                />
                <Button
                  disabled={busy}
                  onClick={() => mark.mutate(preview.command)}
                >
                  Confirm change
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setPreview(undefined)}
                >
                  Back
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-7" />
            </div>
            <h4 className="text-3xl font-semibold tracking-tight">
              A little practice, lasting progress.
            </h4>
            <p className="text-muted-foreground">
              You reviewed {index} {index === 1 ? "card" : "cards"} in this
              session.
            </p>
            <ul className="flex flex-wrap justify-center gap-4">
              {practice.outcomes.map((id) => (
                <li key={id} className="min-w-32 rounded-xl bg-muted/50 p-4">
                  <span className="block text-2xl font-semibold">
                    {counts[id] ?? 0}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {pkg.actions[id].title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ErrorMessage error={mark.error} />
        <ErrorMessage error={refreshQueue.error} />
        {conflict && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => refreshQueue.mutate()}
          >
            Return to refreshed queue
          </Button>
        )}
      </div>
      <Button variant="ghost" disabled={busy} onClick={finish}>
        {record ? "End practice" : "Return to book"}
      </Button>
    </section>
  );
  return modal ? (
    <StudyDialog
      title={record ? "Study session" : "Session complete"}
      close={finish}
      busy={busy}
    >
      {content}
    </StudyDialog>
  ) : (
    content
  );
}
