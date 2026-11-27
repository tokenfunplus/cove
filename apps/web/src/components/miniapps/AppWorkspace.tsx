import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MiniAppAction,
  MiniAppFields,
  MiniAppInstance,
  MiniAppPackage,
  MiniAppSurface,
} from "@cove/api-contract";
import { ChevronLeft, Settings2, Check } from "lucide-react";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { AppBlobs } from "./AppBlobs";
import { AppProposal } from "./AppProposal";
import { AppActionForm } from "./AppActionForm";
import { AppSettings } from "./AppSettings";
import {
  ErrorMessage,
  Fields,
  OpenApp,
  sectionStyle,
  snapshot,
} from "./presentation";

export interface AppContext {
  surface: MiniAppSurface;
  draft?: string;
  localRequired?: boolean;
  attach: (body: string) => Promise<void> | void;
}
interface Props extends AppContext {
  id: string;
  view?: string;
  back: () => void;
  navigate: (id: string, view: string) => void;
}
export function AppWorkspace({ id, view, back, navigate, ...context }: Props) {
  const item = useQuery({
    queryKey: appKeys.instance(id),
    queryFn: () => miniApps.get(id),
    retry: false,
  });
  const [settings, setSettings] = useState(false);
  if (!item.data)
    return (
      <section className={sectionStyle}>
        <Button variant="ghost" size="sm" onClick={back}>
          <ChevronLeft />
          My apps
        </Button>
        {item.isPending ? (
          <p role="status">Opening app…</p>
        ) : (
          <>
            <ErrorMessage error={item.error} />
            <Button onClick={() => void item.refetch()}>Retry</Button>
          </>
        )}
      </section>
    );
  const { instance, package: pkg } = item.data;
  const page = view ? pkg.pages.find((p) => p.id === view) : pkg.pages[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={back}>
          <ChevronLeft />
          My apps
        </Button>
        <div>
          {context.surface !== "page" && page && (
            <OpenApp instance={instance} view={page.id} />
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={settings}
            onClick={() => setSettings((v) => !v)}
          >
            <Settings2 />
            Settings
          </Button>
        </div>
      </div>
      <header>
        <p className="text-sm text-muted-foreground">
          {pkg.publisher} / {pkg.app} · v{pkg.version}
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          {instance.name}
        </h2>
        {pkg.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {pkg.description}
          </p>
        )}
      </header>
      <ErrorMessage error={item.error} />
      {settings ? (
        <AppSettings
          key={instance.revision}
          instance={instance}
          pkg={pkg}
          removed={back}
        />
      ) : !instance.enabled ? (
        <p>
          This instance is disabled. Enable it in Settings to use its actions.
        </p>
      ) : (
        <>
          <nav
            aria-label="App views"
            className="flex flex-wrap gap-1 border-b border-border pb-2"
          >
            {pkg.pages.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={page?.id === p.id ? "secondary" : "ghost"}
                aria-current={page?.id === p.id ? "page" : undefined}
                onClick={() => navigate(id, p.id)}
              >
                {p.title}
              </Button>
            ))}
          </nav>
          {page ? (
            <AppView
              key={[
                id,
                pkg.version,
                page.id,
                instance.enabled,
                String(instance.grants),
              ].join("/")}
              instance={instance}
              pkg={pkg}
              page={page}
              {...context}
            />
          ) : (
            <p role="alert">This view is unavailable. Choose a view above.</p>
          )}
        </>
      )}
      {context.surface === "page" &&
        !settings &&
        instance.enabled &&
        instance.grants.includes("blobs.import") && (
          <AppBlobs instance={instance} />
        )}
    </div>
  );
}
const capability: Record<MiniAppAction["op"], string> = {
  query: "records.query",
  create: "records.commit",
  update: "records.commit",
  generate: "ai.generate",
};

function AppView({
  instance,
  pkg,
  page,
  surface,
  draft,
  localRequired = false,
  attach,
}: AppContext & {
  instance: MiniAppInstance;
  pkg: MiniAppPackage;
  page: MiniAppPackage["pages"][number];
}) {
  const cache = useQueryClient();
  const actions = page.actions.filter((id) =>
    pkg.actions[id].surfaces.includes(surface),
  );
  const autoQuery = actions.find(
    (id) =>
      pkg.actions[id].op === "query" &&
      !Object.keys(pkg.actions[id].inputs ?? {}).length,
  );
  const [query, setQuery] = useState<
    { action: string; inputs: MiniAppFields } | undefined
  >(() => (autoQuery ? { action: autoQuery, inputs: {} } : undefined));
  const [form, setForm] = useState<{
    id: string;
    key: string;
    initial?: MiniAppFields;
  }>();
  const openForm = (id: string, initial?: MiniAppFields) =>
    setForm({ id, initial, key: crypto.randomUUID() });
  const [selectedRefs, setSelected] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  const canQuery = instance.grants.includes("records.query");
  const rows = useQuery({
    queryKey: [
      "mini-app-records",
      instance.id,
      instance.release_id,
      page.id,
      surface,
      query,
    ],
    queryFn: () =>
      miniApps.invoke(instance.id, {
        action: query!.action,
        surface,
        inputs: query!.inputs,
        operation_id: crypto.randomUUID(),
      }),
    enabled: !!query && canQuery,
    retry: false,
  });
  const records = rows.data?.records ?? [];
  const selected = records.filter((r) => selectedRefs[r.id] === r.revision);
  const transfer = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!query || !selected.length) return;
      const { records } = await miniApps.attach(instance.id, {
        action: query.action,
        inputs: query.inputs,
        surface,
        view: page.id,
        records: selected.map(({ id, revision }) => ({ id, revision })),
      });
      await attach(snapshot(instance, query.action, page.id, records));
    },
  });
  function choose(id: string) {
    setFeedback("");
    const act = pkg.actions[id];
    if (act.op === "query" && !Object.keys(act.inputs ?? {}).length)
      return performQuery(id, {});
    openForm(id, selected.length === 1 ? selected[0].fields : undefined);
  }
  function performQuery(action: string, inputs: MiniAppFields) {
    if (
      query?.action === action &&
      JSON.stringify(query.inputs) === JSON.stringify(inputs)
    )
      void rows.refetch();
    setQuery({ action, inputs });
    setSelected({});
    setForm(undefined);
  }
  function saved(count: number) {
    setForm(undefined);
    setSelected({});
    setFeedback(
      "Saved " +
        count +
        " " +
        (count === 1 ? "record" : "records") +
        " to " +
        instance.name +
        ".",
    );
    void cache.invalidateQueries({
      queryKey: ["mini-app-records", instance.id],
    });
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" aria-label="App actions">
        {actions.map((id) => {
          const act = pkg.actions[id];
          const allowed = instance.grants.includes(capability[act.op]);
          const needsSelection =
            act.op === "update" &&
            (!selected.length ||
              !query ||
              pkg.actions[query.action].collection !== act.collection);
          return (
            <Button
              key={id}
              size="sm"
              variant={form?.id === id ? "secondary" : "outline"}
              disabled={!allowed || needsSelection}
              onClick={() => choose(id)}
              title={
                !allowed
                  ? "Allow this capability in Settings"
                  : needsSelection
                    ? "Select records from this collection"
                    : undefined
              }
            >
              {act.title}
            </Button>
          );
        })}
      </div>
      {surface !== "page" && (
        <AppProposal
          instance={instance}
          pkg={pkg}
          actions={actions.filter((id) => {
            const act = pkg.actions[id];
            return (
              instance.grants.includes(capability[act.op]) &&
              (act.op !== "update" ||
                (!!selected.length &&
                  !!query &&
                  pkg.actions[query.action].collection === act.collection))
            );
          })}
          surface={surface}
          localRequired={localRequired}
          choose={openForm}
        />
      )}
      {form && (
        <AppActionForm
          key={form.key}
          instance={instance}
          pkg={pkg}
          actionId={form.id}
          surface={surface}
          initial={form.initial}
          selected={selected}
          draft={draft}
          localRequired={localRequired}
          close={() => setForm(undefined)}
          query={performQuery}
          saved={saved}
          candidate={openForm}
        />
      )}
      {feedback && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Check className="size-4" />
          {feedback}
        </p>
      )}
      {query && canQuery && (
        <section className={sectionStyle}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{pkg.actions[query.action].title}</h3>
            <Button
              size="xs"
              variant="ghost"
              disabled={rows.isFetching}
              onClick={() => void rows.refetch()}
            >
              Refresh
            </Button>
          </div>
          {rows.isPending && <p role="status">Loading records…</p>}
          <ErrorMessage error={rows.error} />
          {rows.isSuccess && !records.length && (
            <p className="text-sm text-muted-foreground">
              No matching records.
            </p>
          )}
          {records.map((record, i) => (
            <div
              className="flex items-start gap-3 border-t border-border pt-3"
              key={record.id}
            >
              <input
                className="mt-1"
                aria-label={"Select record " + (i + 1)}
                type="checkbox"
                checked={selectedRefs[record.id] === record.revision}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelected((old) => {
                    const next = { ...old };
                    if (checked) next[record.id] = record.revision;
                    else delete next[record.id];
                    return next;
                  });
                }}
              />
              <Fields
                fields={record.fields}
                reveal={pkg.actions[query.action].reveal_field}
              />
            </div>
          ))}
          {instance.grants.includes("chat.attach") && records.length > 0 && (
            <Button
              disabled={!selected.length || transfer.isPending}
              onClick={() => transfer.mutate()}
            >
              {surface === "page"
                ? "Start a chat draft"
                : "Add to current draft"}
              {selected.length > 0 && " (" + selected.length + ")"}
            </Button>
          )}
          <ErrorMessage error={transfer.error} />
        </section>
      )}
    </div>
  );
}
