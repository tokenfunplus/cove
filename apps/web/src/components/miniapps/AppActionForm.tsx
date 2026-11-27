import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  MiniAppAction,
  MiniAppPackage,
  MiniAppInstance,
  MiniAppInvocation,
  MiniAppFields,
  MiniAppSurface,
  MiniAppRecord,
} from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ErrorMessage,
  Fields,
  humanize,
  labelStyle,
  sectionStyle,
} from "./presentation";
import { AppModelTask } from "./AppModelTask";
import { AppProcessing } from "./AppProcessing";
import { AppFileInput } from "./AppFileInput";

interface Props {
  instance: MiniAppInstance;
  pkg: MiniAppPackage;
  actionId: string;
  surface: MiniAppSurface;
  selected: MiniAppRecord[];
  draft?: string;
  localRequired: boolean;
  initial?: MiniAppFields;
  query: (id: string, inputs: MiniAppFields) => void;
  saved: (count: number) => void;
  close: () => void;
  candidate: (id: string, values: MiniAppFields) => void;
}
function defaults(
  action: MiniAppAction,
  initial?: MiniAppFields,
): MiniAppFields {
  return Object.fromEntries(
    Object.entries(action.inputs ?? {}).map(([k, t]) => [
      k,
      initial?.[k] ?? (t === "bool" ? false : t === "number" ? 0 : ""),
    ]),
  );
}
export function AppActionForm({
  instance,
  pkg,
  actionId,
  surface,
  selected,
  draft,
  localRequired,
  initial,
  query,
  saved,
  close,
  candidate,
}: Props) {
  const action = pkg.actions[actionId];
  const [inputs, setInputs] = useState(() => defaults(action, initial));
  const [preview, setPreview] = useState<{
    command: MiniAppInvocation;
    rows: MiniAppRecord[];
  }>();
  const call = useMutation({
    retry: false,
    mutationFn: async (command: MiniAppInvocation) => {
      const result = await miniApps.invoke(instance.id, command);
      if (result.confirmation)
        setPreview({
          command: { ...command, confirm: result.confirmation },
          rows: result.records ?? [],
        });
      else if (command.confirm) saved(result.records?.length ?? 0);
      else throw new Error("The service did not return a change preview.");
    },
  });
  const selection = useMutation({
    retry: false,
    mutationFn: async ({ key, text }: { key: string; text: string }) => {
      const snapshot = await miniApps.receiveSelection(instance.id, text);
      update(key, snapshot.text);
    },
  });
  function run() {
    if (action.op === "query") return query(actionId, inputs);
    call.mutate({
      action: actionId,
      inputs,
      operation_id: crypto.randomUUID(),
      surface,
      ...(action.op === "update"
        ? { records: selected.map(({ id, revision }) => ({ id, revision })) }
        : {}),
    });
  }
  const update = (key: string, value: string | number | boolean) =>
    setInputs((old) => ({ ...old, [key]: value }));
  const candidateAction =
    action.candidate_action &&
    pkg.actions[action.candidate_action]?.surfaces.includes(surface)
      ? pkg.actions[action.candidate_action]
      : undefined;
  const complete = Object.values(inputs).every(
    (x) => typeof x !== "string" || x.trim().length > 0,
  );
  return (
    <section className={sectionStyle} aria-label={action.title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{action.title}</h3>
        <Button
          size="xs"
          variant="ghost"
          onClick={close}
          disabled={call.isPending}
        >
          Close
        </Button>
      </div>
      {preview ? (
        <>
          <p className="text-sm">
            Review {preview.rows.length} proposed{" "}
            {preview.rows.length === 1 ? "record" : "records"} in{" "}
            <strong>{instance.name}</strong>.
          </p>
          {preview.rows.map((row) => (
            <div className="border-t border-border pt-2" key={row.id}>
              <Fields fields={row.fields} />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={call.isPending}
              onClick={() => call.mutate(preview.command)}
            >
              Confirm changes
            </Button>
            <Button
              variant="outline"
              disabled={call.isPending}
              onClick={() => {
                setPreview(undefined);
                call.reset();
              }}
            >
              Edit proposal
            </Button>
          </div>
        </>
      ) : (
        <>
          <fieldset className="space-y-3" disabled={call.isPending}>
            {Object.entries(action.inputs ?? {}).map(([key, type]) => (
              <div key={key} className="space-y-1">
                <label className={labelStyle}>
                  {humanize(key)}
                  {type === "bool" ? (
                    <input
                      type="checkbox"
                      className="justify-self-start"
                      checked={!!inputs[key]}
                      onChange={(e) => update(key, e.target.checked)}
                    />
                  ) : type === "text" ? (
                    <Textarea
                      rows={3}
                      value={String(inputs[key])}
                      onChange={(e) => update(key, e.target.value)}
                    />
                  ) : (
                    <Input
                      type={type === "date" ? "date" : "number"}
                      value={String(inputs[key])}
                      onChange={(e) =>
                        update(
                          key,
                          type === "number" && e.target.value !== ""
                            ? Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </label>
                {type === "text" && (
                  <div className="flex flex-wrap items-center gap-2">
                    {instance.grants.includes("mac.files.pick") && (
                      <AppFileInput
                        instance={instance.id}
                        onChoose={(text) => update(key, text)}
                      />
                    )}
                    <AppProcessing
                      instance={instance}
                      text={String(inputs[key])}
                      onSelect={(text) => update(key, text)}
                    />
                    {draft &&
                      instance.grants.includes("mac.selection.receive") && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={selection.isPending}
                          onClick={() => selection.mutate({ key, text: draft })}
                        >
                          Use current draft
                        </Button>
                      )}
                  </div>
                )}
              </div>
            ))}
          </fieldset>
          {action.op === "generate" ? (
            <AppModelTask
              instance={instance}
              actionId={actionId}
              action={action}
              inputs={inputs}
              surface={surface}
              localRequired={localRequired}
              candidate={candidateAction}
              previewCandidates={(rows) =>
                call.mutate({
                  action: action.candidate_action!,
                  surface,
                  operation_id: crypto.randomUUID(),
                  inputs: {},
                  items: rows,
                })
              }
              choose={(row) => candidate(action.candidate_action!, row)}
            />
          ) : (
            <Button
              disabled={
                !complete ||
                call.isPending ||
                (action.op === "update" && !selected.length)
              }
              onClick={run}
            >
              {action.op === "query" ? "Find records" : "Preview changes"}
            </Button>
          )}
        </>
      )}
      <ErrorMessage error={selection.error ?? call.error} />
    </section>
  );
}
