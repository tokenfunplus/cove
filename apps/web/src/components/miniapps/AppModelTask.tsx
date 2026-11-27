import { useAppTaskStatus } from "./use-app-task-status";
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
import {
  startVerifiedAppTask,
  stopVerifiedAppTask,
} from "@/lib/inference/mini-app-task";
import { Button } from "@/components/ui/button";
import { ErrorMessage, Fields, labelStyle, selectStyle } from "./presentation";

export function candidateRows(
  body: string,
  action: MiniAppAction,
  expectedCount?: number,
): MiniAppFields[] {
  try {
    const json = body.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
    const fields = Object.entries(action.inputs ?? {});
    const rows: unknown = JSON.parse(json);
    if (
      !Array.isArray(rows) ||
      rows.length > 100 ||
      (expectedCount !== undefined && rows.length !== expectedCount)
    )
      return [];
    const valid = rows.filter(
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
    return valid.length === rows.length ? valid : [];
  } catch {
    return [];
  }
}
function modelInputs(action: MiniAppAction, fields: MiniAppFields) {
  const local = new Set(Object.values(action.candidate_bindings ?? {}));
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([name]) => !local.has(name) || name === action.text_input,
    ),
  );
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
  const target = useAppModelTarget(
    localRequired,
    true,
    instance.cloud_enabled === true,
  );
  const [browserError, setBrowserError] = useState<unknown>();
  const cancelledBrowserTask = useRef<string | undefined>(undefined);
  const { profile, model, policyLocal, profiles, catalog } = target;
  const [started, setStarted] = useState<AppTask>();
  const [submitted, setSubmitted] = useState<{
    id: string;
    destination: string;
    model: string;
    inputs: MiniAppFields;
  }>();
  const history = useQuery({
    queryKey: ["mini-app-tasks", instance.id],
    queryFn: () => miniApps.tasks(instance.id),
    refetchInterval: (query) =>
      query.state.data?.tasks.some((task) => task.state === "running")
        ? 1000
        : false,
    retry: false,
  });
  const previous = (history.data?.tasks ?? []).filter(
    (job) => job.action === actionId,
  );
  const recent = started ?? previous.find((job) => job.state === "running");
  const retryKey = useRef<{ key: string; id: string } | undefined>(undefined);
  const { poll, task } = useAppTaskStatus(instance.id, recent, "generation");
  const active = task?.state === "running";
  useEffect(() => {
    if (task?.state === "cancelled") cancelledBrowserTask.current = task.id;
    if (task && task.state !== "running") void history.refetch();
    if (task && task.state !== "running")
      stopVerifiedAppTask(instance.id, task.id);
  }, [instance.id, task?.id, task?.state]);
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
        expected_instance_revision: instance.revision,
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
        void startVerifiedAppTask(instance.id, job.id).catch((error) => {
          if (
            cancelledBrowserTask.current !== job.id &&
            !(error instanceof DOMException && error.name === "AbortError")
          )
            setBrowserError(error);
        });
      }
      setSubmitted({ ...data, id: job.id });
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
      const cancelled = await miniApps.cancel(instance.id, task!.id);
      cancelledBrowserTask.current = task!.id;
      stopVerifiedAppTask(instance.id, task!.id);
      return cancelled;
    },
    onSuccess: () => {
      setBrowserError(undefined);
      void poll.refetch();
    },
  });
  const source =
    task?.inputs ??
    (submitted?.id === task?.id ? submitted?.inputs : undefined);
  const inputReady = !!source;
  const bindings = action.candidate_bindings ?? {};
  const generated = candidate && {
    ...candidate,
    inputs: Object.fromEntries(
      Object.entries(candidate.inputs ?? {}).filter(
        ([key]) => !Object.hasOwn(bindings, key),
      ),
    ),
  };
  const expectedCount = action.count_input
    ? Number(
        source?.[action.count_input] ?? action.defaults?.[action.count_input],
      )
    : undefined;
  const raw =
    inputReady && generated && task?.result
      ? candidateRows(task.result, generated, expectedCount)
      : [];
  const results = raw.map((row) => ({
    ...row,
    ...Object.fromEntries(
      Object.entries(bindings).map(([key, field]) => [
        key,
        source?.[field] ?? action.defaults?.[field] ?? "",
      ]),
    ),
  }));
  const checkingDuplicates =
    !!candidate &&
    instance.grants.includes("records.query") &&
    results.length > 0 &&
    task?.state === "completed";
  const duplicates = useQuery({
    queryKey: [
      "mini-app-records",
      instance.id,
      "candidate-duplicates",
      instance.revision,
      task?.id,
      results,
    ],
    enabled: checkingDuplicates,
    retry: false,
    refetchOnWindowFocus: "always",
    queryFn: () =>
      miniApps.checkCandidates(instance, actionId, surface, results),
  });
  return (
    <section
      className="space-y-3 border-t border-border pt-4"
      aria-label="Model task"
    >
      <fieldset className="space-y-3" disabled={active || start.isPending}>
        <AppModelTarget target={target} />
        {model && !active && (
          <div className="space-y-2 rounded-xl bg-muted p-3 text-sm">
            <strong>
              Input to {profile?.name} / {model}
            </strong>
            <p className="break-all">
              {profile?.endpoint || "Cove-managed local worker"}
            </p>
            <p className="whitespace-pre-wrap">{action.prompt}</p>
            <Fields fields={modelInputs(action, inputs)} />
          </div>
        )}
        <Button
          disabled={
            !profile ||
            !model ||
            Object.entries(inputs).some(
              ([key, v]) =>
                typeof v === "string" &&
                !v.trim() &&
                action.defaults?.[key] !== "",
            ) ||
            (action.count_input !== undefined &&
              (!Number.isInteger(inputs[action.count_input]) ||
                Number(inputs[action.count_input]) < 1 ||
                Number(inputs[action.count_input]) > 8))
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
            <option value="">Select a previous task</option>
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
          {(task.inputs ?? submitted?.inputs) && (
            <div className="text-sm">
              <strong>Submitted input</strong>
              <Fields
                fields={modelInputs(action, task.inputs ?? submitted!.inputs)}
              />
              <p>
                {task.destination ?? submitted?.destination} ·{" "}
                {task.modelId ?? submitted?.model}
              </p>
            </div>
          )}
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
          <ErrorMessage error={duplicates.error} />
          {duplicates.isError && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void duplicates.refetch()}
            >
              Retry duplicate check
            </Button>
          )}
          {task.state === "completed" && !inputReady && (
            <p role="status">
              Loading the saved task input before using candidates…
            </p>
          )}
          {task.state === "completed" &&
            inputReady &&
            (results.length ? (
              <CandidateSelection
                key={task.id}
                rows={results}
                duplicates={duplicates.data?.duplicates ?? []}
                checking={checkingDuplicates && !duplicates.isSuccess}
                choose={choose}
                canSave={instance.grants.includes("records.commit")}
                preview={previewCandidates}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm">
                {expectedCount !== undefined && (
                  <strong className="block">
                    Expected {expectedCount} valid candidates. Review the model
                    response or try again.
                  </strong>
                )}
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
  duplicates,
  checking,
}: {
  duplicates: number[];
  checking: boolean;
  rows: MiniAppFields[];
  choose: (row: MiniAppFields) => void;
  preview: (rows: MiniAppFields[]) => void;
  canSave: boolean;
}) {
  const [selection, setSelection] = useState<number[]>([]);
  const selected = selection.filter((index) => !duplicates.includes(index));
  return (
    <div className="space-y-2">
      {checking && <p role="status">Checking for saved records…</p>}
      {duplicates.length > 0 && (
        <p role="status">
          {duplicates.length}{" "}
          {duplicates.length === 1 ? "candidate is" : "candidates are"} already
          saved or repeated in this result.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Select up to 50 candidates for one save.
      </p>
      {rows.map((row, index) => (
        <div
          key={index}
          className="space-y-2 rounded-xl border border-border p-3"
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(index)}
              disabled={
                !canSave ||
                checking ||
                duplicates.includes(index) ||
                (!selected.includes(index) && selected.length >= 50)
              }
              onChange={(e) =>
                setSelection(
                  e.target.checked
                    ? [...selected, index]
                    : selected.filter((n) => n !== index),
                )
              }
            />
            Select candidate {index + 1}
          </label>
          <Fields fields={row} />
          <Button
            size="sm"
            variant="outline"
            disabled={!canSave || checking || duplicates.includes(index)}
            onClick={() => choose(row)}
          >
            Use candidate {index + 1}
          </Button>
        </div>
      ))}
      <Button
        disabled={!canSave || checking || selected.length === 0}
        onClick={() =>
          preview(rows.filter((_, index) => selected.includes(index)))
        }
      >
        Preview selected ({selected.length})
      </Button>
    </div>
  );
}
