import { useLayoutEffect, useRef } from "react";
import { getBrowserAppTurn } from "@/api/generations";
import { useQuery } from "@tanstack/react-query";
import type { MiniAppFields, MiniAppTurnScope } from "@cove/api-contract";
import { miniApps, appKeys } from "@/api/mini-apps";
import { AppView } from "@/components/miniapps/AppWorkspace";
import { AssistantMessage } from "./AssistantMessage";
import { ErrorMessage, OpenApp } from "@/components/miniapps/presentation";

interface Props {
  generationId: string;
  reasoning?: string;
  verifiedGeneration?: string;
  verification?: string;
  scope: MiniAppTurnScope;
  body: string;
  draft?: string;
  change?: (text: string) => void;
  localRequired: boolean;
  disabled: boolean;
}

export default function AppTurnAnswer({
  generationId,
  reasoning,
  verifiedGeneration,
  verification,
  scope,
  body,
  draft,
  change,
  localRequired,
  disabled,
}: Props) {
  let candidate: { action?: string; inputs?: MiniAppFields } | undefined;
  try {
    const parsed: unknown = JSON.parse(
      body
        .trim()
        .replace(/^(?:Suggestion:|Suggested:|Proposed action:)\s*/, "")
        .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1"),
    );
    if (parsed && typeof parsed === "object" && "action" in parsed)
      candidate = parsed as { action?: string; inputs?: MiniAppFields };
  } catch {}
  const ordinary = !candidate;
  const item = useQuery({
    queryKey: appKeys.instance(scope.instance),
    queryFn: () => miniApps.get(scope.instance),
    enabled: !ordinary,
    retry: false,
  });
  const verified = useQuery({
    queryKey: [
      "verified-app-turn",
      verifiedGeneration,
      verification,
      scope.release,
      scope.revision,
    ],
    enabled:
      !ordinary &&
      !!verifiedGeneration &&
      (verification === "verified_model" ||
        verification === "verified_gateway"),
    retry: false,
    queryFn: () => getBrowserAppTurn(verifiedGeneration!),
  });
  const target = useRef<{
    draft?: string;
    change?: Props["change"];
    disabled: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    target.current = { draft, change, disabled };
    return () => {
      target.current = null;
    };
  }, [draft, change, disabled]);
  function attach(text: string) {
    const t = target.current;
    if (!t?.change || t.disabled)
      throw new Error("This conversation is unavailable.");
    t.change(t.draft ? t.draft + "\n\n" + text : text);
  }
  if (ordinary)
    return <AssistantMessage content={body} reasoning={reasoning} />;
  if (!item.data)
    return item.error ? (
      <ErrorMessage error={item.error} />
    ) : (
      <p role="status">Opening app result…</p>
    );
  const { instance, package: pkg } = item.data;
  if (
    !instance.enabled ||
    instance.revision !== scope.revision ||
    instance.release_id !== scope.release
  )
    return (
      <p>
        {instance.name} changed since this request. Choose its actions again to
        run a new request.
      </p>
    );
  if (
    verifiedGeneration &&
    verification !== "verified_model" &&
    verification !== "verified_gateway"
  ) {
    return <p>The model reply has no verified app action.</p>;
  }
  let proposal: { action: string; inputs: MiniAppFields };
  try {
    if (verifiedGeneration && !verified.data?.proposal)
      return verified.isPending ? (
        <p>Checking verified proposal…</p>
      ) : (
        <p>This reply has no usable verified app action.</p>
      );
    proposal = verifiedGeneration
      ? verified.data!.proposal!
      : (candidate as { action: string; inputs: MiniAppFields });
    if (
      !scope.actions.includes(proposal.action) ||
      !pkg.actions[proposal.action] ||
      !proposal.inputs
    )
      throw new Error();
  } catch {
    return <p>The app action is unavailable.</p>;
  }
  const page =
    pkg.pages.find((p) => p.actions.includes(proposal.action)) ?? pkg.pages[0];
  const action = pkg.actions[proposal.action];
  return (
    <section aria-label="App response" className="grid gap-2">
      <header className="flex flex-wrap items-center gap-3">
        <strong>
          {instance.name} · {action.title}
        </strong>
        <OpenApp instance={instance} view={page.id} />
      </header>
      {verifiedGeneration && (
        <details>
          <summary>Original verified response</summary>
          <pre className="whitespace-pre-wrap">{body}</pre>
        </details>
      )}
      {disabled && (
        <p>
          App controls are available when this conversation is active and idle.
        </p>
      )}
      <fieldset className="min-w-0" disabled={disabled}>
        <AppView
          key={body}
          instance={instance}
          pkg={pkg}
          page={page}
          surface="chat"
          draft={draft}
          localRequired={localRequired}
          attach={attach}
          proposal={{
            ...proposal,
            actions: scope.actions,
            origin: generationId,
          }}
        />
      </fieldset>
    </section>
  );
}
