import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MiniAppAction,
  MiniAppFields,
  MiniAppInstance,
  MiniAppSurface,
} from "@cove/api-contract";
import { miniApps, type AppTask } from "@/api/mini-apps";
import { AppModelTarget, useAppModelTarget } from "./AppModelTarget";
import { runVerifiedAppTask } from "@/lib/inference/mini-app-task";
import { Button } from "@/components/ui/button";
import { ErrorMessage, Fields, labelStyle, selectStyle } from "./presentation";

export function candidateRows(
  body: string,
  action: MiniAppAction,
): MiniAppFields[] {
  try {
    const json = body.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
    const fields = Object.entries(action.inputs ?? {});
    const rows: unknown = JSON.parse(json);
    if (!Array.isArray(rows) || rows.length > 100) return [];
    return rows.filter(
      (row): row is MiniAppFields =>
        row !== null &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.keys(row).length === fields.length &&
        fields.every(
          ([key, type]) =>
            Object.hasOwn(row, key) &&
            typeof row[key] ===
              (type === "bool"
                ? "boolean"
                : type === "number"
                  ? "number"
                  : "string"),
        ),
    );
  } catch {
    return [];
  }
}
export function AppModelTask({
  instance,
  actionId,
  action,
  inputs,
  surface,
  localRequired,
  candidate,
  previewCandidates,
  choose,
}: {
  instance: MiniAppInstance;
  actionId: string;
  action: MiniAppAction;
  inputs: MiniAppFields;
  surface: MiniAppSurface;
  localRequired: boolean;
  candidate?: MiniAppAction;
  previewCandidates: (rows: MiniAppFields[]) => void;
  choose: (row: MiniAppFields) => void;
}) {
  const target = useAppModelTarget(localRequired, true);
  const browser = useRef<
    { id: string; controller: AbortController } | undefined
  >(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      browser.current?.controller.abort();
    };
  }, []);
  const [browserError, setBrowserError] = useState<unknown>();
  const { profile, model, policyLocal, profiles, catalog } = target;
  const [started, setStarted] = useState<AppTask>();
  const [submitted, setSubmitted] = useState<{
    destination: string;
    model: string;
    inputs: MiniAppFields;
  }>();
  const history = useQuery({
    queryKey: ["mini-app-tasks", instance.id],
    queryFn: () => miniApps.tasks(instance.id),
    retry: false,
  });
  const previous = (history.data?.tasks ?? []).filter(
    (job) => job.action === actionId,
  );
  const recent = started ?? previous[0];
  const retryKey = useRef<{ key: string; id: string } | undefined>(undefined);
  const poll = useQuery({
    queryKey: ["mini-app-task", instance.id, recent?.id],
    queryFn: () => miniApps.task(instance.id, recent!.id),
    enabled: !!recent,
    refetchInterval: (q) =>
      q.state.status === "error" ||
      (q.state.data && q.state.data.state !== "running")
        ? false
        : 700,
    retry: false,
  });
  const task = poll.data ?? recent;
  const active = task?.state === "running";
  useEffect(() => {
    if (browser.current?.id === task?.id && (poll.isError || !active))
      browser.current?.controller.abort();
  }, [task?.id, poll.isError, active]);
  const start = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!profile || !model) throw new Error("Choose a model.");
      setBrowserError(undefined);
      const data = {
        destination: profile.endpoint,
        model,
        inputs: { ...inputs },
      };
      const fingerprint = JSON.stringify([data, profile.id, policyLocal]);
      if (retryKey.current?.key !== fingerprint)
        retryKey.current = { key: fingerprint, id: crypto.randomUUID() };
      const job = await miniApps.startTask(instance.id, {
        action: actionId,
        input: data.inputs,
        providerId: profile.id,
        modelId: model,
        localOnly: policyLocal,
        operationId: retryKey.current.id,
        surface,
        destination: data.destination,
      });
      retryKey.current = undefined;
      if (job.browser && job.state === "running") {
        if (!mounted.current) {
          await miniApps.cancel(instance.id, job.id);
          return job;
        }
        browser.current?.controller.abort();
        const controller = new AbortController();
        browser.current = { id: job.id, controller };
        setBrowserError(undefined);
        void runVerifiedAppTask(instance.id, job.id, controller.signal)
          .catch((error) => {
            if (!controller.signal.aborted && mounted.current)
              setBrowserError(error);
          })
          .finally(() => {
            if (browser.current?.controller === controller)
              browser.current = undefined;
          });
      }
      setSubmitted(data);
      return job;
    },
    onSuccess: (job) => {
      setStarted(job);
      void history.refetch();
    },
  });
  const cancel = useMutation({
    retry: false,
    mutationFn: async () => {
      browser.current?.controller.abort();
      return miniApps.cancel(instance.id, task!.id);
    },
    onSuccess: () => {
      void poll.refetch();
    },
  });
  const results =
    candidate && task?.result ? candidateRows(task.result, candidate) : [];
  return (
    <section
      className="space-y-3 border-t border-border pt-4"
      aria-label="Model task"
    >
      <fieldset className="space-y-3" disabled={active || start.isPending}>
        <AppModelTarget target={target} />
        {model && (
          <div className="space-y-2 rounded-xl bg-muted p-3 text-sm">
            <strong>
              Input to {profile?.name} / {model}
            </strong>
            <p className="break-all">
              {profile?.endpoint || "Cove-managed local worker"}
            </p>
            <p className="whitespace-pre-wrap">{action.prompt}</p>
            <Fields fields={inputs} />
          </div>
        )}
        <Button
          disabled={
            !profile ||
            !model ||
            Object.values(inputs).some(
              (v) => typeof v === "string" && !v.trim(),
            )
          }
          onClick={() => start.mutate()}
        >
          Start model task
        </Button>
      </fieldset>
      {previous.length > 0 && (
        <label className={labelStyle}>
          Recent tasks
          <select
            className={selectStyle}
            disabled={active}
            value={recent?.id ?? ""}
            onChange={(e) => {
              setSubmitted(undefined);
              setStarted(previous.find((t) => t.id === e.target.value));
            }}
          >
            {previous.map((t, i) => (
              <option key={t.id} value={t.id}>
                {t.modelId} · {t.state} · {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      <ErrorMessage
        error={
          history.error ??
          profiles.error ??
          catalog.error ??
          start.error ??
          browserError ??
          poll.error ??
          cancel.error
        }
      />
      {poll.isError && (
        <Button variant="outline" size="sm" onClick={() => void poll.refetch()}>
          Retry status
        </Button>
      )}
      {task && (
        <section className="space-y-3" aria-label="Model result">
          <p role="status" className="text-sm">
            Task {task.state}
            {submitted ? " · " + submitted.model : ""}
          </p>
          {active && (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancel task
            </Button>
          )}
          {task.verification && (
            <details className="text-sm">
              <summary>
                NearAI verification ·{" "}
                {task.verification.status.replaceAll("_", " ")}
              </summary>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(task.verification, null, 2)}
              </pre>
            </details>
          )}
          {task.error && <ErrorMessage error={task.error} />}
          {task.state === "completed" &&
            (results.length ? (
              <CandidateSelection
                key={task.id}
                rows={results}
                choose={choose}
                canSave={instance.grants.includes("records.commit")}
                preview={previewCandidates}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm">
                {task.result}
              </p>
            ))}
        </section>
      )}
    </section>
  );
}

function CandidateSelection({
  rows,
  choose,
  preview,
  canSave,
}: {
  rows: MiniAppFields[];
  choose: (row: MiniAppFields) => void;
  preview: (rows: MiniAppFields[]) => void;
  canSave: boolean;
}) {
  const [selection, setSelection] = useState<number[]>([]);
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div
          key={index}
          className="space-y-2 rounded-xl border border-border p-3"
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selection.includes(index)}
              disabled={!canSave}
              onChange={(e) =>
                setSelection(
                  e.target.checked
                    ? [...selection, index]
                    : selection.filter((n) => n !== index),
                )
              }
            />
            Select candidate {index + 1}
          </label>
          <Fields fields={row} />
          <Button
            size="sm"
            variant="outline"
            disabled={!canSave}
            onClick={() => choose(row)}
          >
            Use candidate {index + 1}
          </Button>
        </div>
      ))}
      <Button
        disabled={!canSave || selection.length === 0 || selection.length > 50}
        onClick={() =>
          preview(rows.filter((_, index) => selection.includes(index)))
        }
      >
        Preview selected ({selection.length})
      </Button>
    </div>
  );
}
