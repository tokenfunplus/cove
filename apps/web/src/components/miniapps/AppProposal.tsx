import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MiniAppFields,
  MiniAppInstance,
  MiniAppPackage,
  MiniAppSurface,
} from "@cove/api-contract";
import { miniApps, type AppTask } from "@/api/mini-apps";
import { useAppTaskStatus } from "./use-app-task-status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AppModelTarget, useAppModelTarget } from "./AppModelTarget";
import { ErrorMessage, Fields, labelStyle, sectionStyle } from "./presentation";

interface Props {
  instance: MiniAppInstance;
  pkg: MiniAppPackage;
  actions: string[];
  surface: MiniAppSurface;
  localRequired: boolean;
  choose: (id: string, inputs: MiniAppFields) => void;
}
interface Proposal {
  action: string;
  inputs: MiniAppFields;
}

export function AppProposal(props: Props) {
  const [open, setOpen] = useState(false);
  if (!props.actions.length || props.surface === "page") return null;
  return (
    <section className={sectionStyle} aria-label="Model action proposal">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Ask a model to propose an action
      </Button>
      {open && <ProposalForm {...props} />}
    </section>
  );
}

function ProposalForm({
  instance,
  pkg,
  actions,
  surface,
  localRequired,
  choose,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const allowed = selected.filter((id) => actions.includes(id));
  const [question, setQuestion] = useState("");
  const [started, setStarted] = useState<AppTask>();
  const target = useAppModelTarget(
    localRequired,
    false,
    instance.cloud_enabled === true,
  );
  const { profile, model, policyLocal } = target;
  const retry = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const history = useQuery({
    queryKey: [
      "mini-app-latest-proposal",
      instance.id,
      instance.revision,
      surface,
    ],
    queryFn: () => miniApps.latestProposal(instance.id, surface),
    retry: false,
  });
  const recent = started ?? history.data;
  const { poll, task } = useAppTaskStatus(instance.id, recent, "proposal");
  const busy = task?.state === "running";
  const start = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!profile || !model || !allowed.length || !question.trim())
        throw new Error("Choose a model and actions, then enter a question.");
      const command = {
        actions: allowed,
        question,
        surface,
        providerId: profile.id,
        modelId: model,
        destination: profile.endpoint,
        localOnly: policyLocal,
      };
      const fingerprint = JSON.stringify(command);
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, id: crypto.randomUUID() };
      const result = await miniApps.startProposal(instance.id, {
        ...command,
        operationId: retry.current.id,
      });
      retry.current = undefined;
      return result;
    },
    onSuccess: setStarted,
  });
  const cancel = useMutation({
    retry: false,
    mutationFn: () => miniApps.cancelProposal(instance.id, task!.id),
    onSuccess: () => {
      void poll.refetch();
    },
  });
  let proposal: Proposal | undefined;
  if (task?.state === "completed" && task.result) {
    try {
      const value = JSON.parse(task.result) as Proposal;
      if (
        actions.includes(value.action) &&
        value.inputs &&
        typeof value.inputs === "object"
      )
        proposal = value;
    } catch {
      /* Preserve manual action selection if a saved result cannot be read. */
    }
  }
  return (
    <div className="mt-3 space-y-3">
      <fieldset className="space-y-3" disabled={busy || start.isPending}>
        <fieldset>
          <legend className={labelStyle}>
            Actions to describe to the model
          </legend>
          {actions.map((id) => (
            <label className="flex items-center gap-2 text-sm" key={id}>
              <input
                type="checkbox"
                checked={allowed.includes(id)}
                disabled={!allowed.includes(id) && allowed.length >= 16}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, id]
                      : old.filter((key) => key !== id),
                  )
                }
              />
              {pkg.actions[id].title}
            </label>
          ))}
        </fieldset>
        <label className={labelStyle}>
          What would you like to do?
          <Textarea
            rows={2}
            maxLength={8000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <AppModelTarget target={target} />
        {profile && model && (
          <div className="space-y-2 rounded-xl bg-muted p-3 text-sm">
            <strong>
              {profile.name} / {model}
            </strong>
            <p className="break-all">{profile.endpoint}</p>
            <p>
              This sends your question and the selected action definitions.
              Review the suggestion before using the action.
            </p>
            {allowed.map((id) => (
              <p key={id} className="break-words">
                {id} · {pkg.actions[id].op} ·{" "}
                {Object.entries(pkg.actions[id].inputs ?? {})
                  .map(([name, type]) => name + " (" + type + ")")
                  .join(", ") || "No inputs"}
              </p>
            ))}
          </div>
        )}
        <Button
          disabled={!profile || !model || !question.trim() || !allowed.length}
          onClick={() => start.mutate()}
        >
          Request suggestion
        </Button>
      </fieldset>
      <ErrorMessage
        error={
          history.error ??
          start.error ??
          poll.error ??
          cancel.error ??
          target.profiles.error ??
          target.catalog.error
        }
      />
      {poll.isError && (
        <Button size="sm" variant="outline" onClick={() => void poll.refetch()}>
          Retry status
        </Button>
      )}
      {busy && (
        <Button
          size="sm"
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          Cancel suggestion
        </Button>
      )}
      {task && (
        <p role="status" className="text-sm">
          Suggestion {task.state}
          {task.state === "failed"
            ? ". You can choose an action manually."
            : ""}
        </p>
      )}
      {proposal && (
        <div className={sectionStyle}>
          <h4 className="font-semibold">
            {pkg.actions[proposal.action].title}
          </h4>
          <Fields fields={proposal.inputs} />
          <Button
            size="sm"
            onClick={() => choose(proposal.action, proposal.inputs)}
          >
            Review suggested action
          </Button>
        </div>
      )}
    </div>
  );
}
