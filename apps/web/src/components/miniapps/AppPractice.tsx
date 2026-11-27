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
import { ErrorMessage, Fields, sectionStyle } from "./presentation";

interface Props {
  instance: string;
  revision: number;
  allowReading: boolean;
  pkg: MiniAppPackage;
  practice: NonNullable<MiniAppPackage["pages"][number]["practice"]>;
  records: MiniAppRecord[];
  finish: () => void;
  changed: () => void;
}

// Keep the reviewed revisions for this session even when another tab edits a card.
export function AppPractice({
  instance,
  revision,
  allowReading,
  pkg,
  practice,
  records,
  finish,
  changed,
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
  return (
    <section className={sectionStyle} aria-label="Practice session">
      <h3 className="font-semibold">
        {record
          ? `Card ${index + 1} of ${records.length}`
          : "Practice complete"}
      </h3>
      {record ? (
        <>
          <p className="whitespace-pre-wrap text-lg">
            {String(record.fields[practice.front])}
          </p>
          {shown ? (
            <p className="whitespace-pre-wrap">
              {String(record.fields[practice.back])}
            </p>
          ) : (
            <Button onClick={() => show(true)}>Show answer</Button>
          )}
          {allowReading && pkg.speech_language && (
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
          )}
          {shown && !preview && (
            <div className="flex flex-wrap gap-2">
              {practice.outcomes.map((action) => (
                <Button
                  variant="outline"
                  key={action}
                  disabled={mark.isPending}
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
            <div className="space-y-2">
              <p>Review the change to this card.</p>
              <Fields fields={preview.fields} />
              <Button
                disabled={mark.isPending}
                onClick={() => mark.mutate(preview.command)}
              >
                Confirm change
              </Button>
              <Button
                variant="ghost"
                disabled={mark.isPending}
                onClick={() => setPreview(undefined)}
              >
                Back
              </Button>
            </div>
          )}
        </>
      ) : (
        <ul>
          {practice.outcomes.map((id) => (
            <li key={id}>
              {pkg.actions[id].title} · {counts[id] ?? 0}
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" disabled={mark.isPending} onClick={finish}>
        {record ? "End practice" : "Return to book"}
      </Button>
      <ErrorMessage error={mark.error} />
    </section>
  );
}
