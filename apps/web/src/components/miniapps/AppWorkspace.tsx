import { MacSelection } from "./MacSelection";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MiniAppAction,
  MiniAppFields,
  MiniAppInstance,
  MiniAppPackage,
  MiniAppResult,
  MiniAppSurface,
} from "@cove/api-contract";
import { ChevronLeft, Settings2, Check } from "lucide-react";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { AppPractice } from "./AppPractice";
import { AppRecordSource } from "./AppRecordSource";
import { AppTurnScope } from "./AppTurnScope";
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
  selectionSource?: "selection";
  onScope?: (scope:import("@cove/api-contract").MiniAppTurnScope,name:string)=>void;
  proposal?: {action:string;inputs:MiniAppFields;actions:string[]};
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
  const artwork = page?.image && pkg.assets?.[page.image];
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
      {artwork && <img className="mt-3 max-h-64 max-w-full rounded-lg object-contain" alt={artwork.alt} src={"data:"+artwork.mime+";base64,"+artwork.data} />}
      </header>
      {instance.enabled && !settings && context.onScope && <AppTurnScope key={instance.revision} pkg={pkg} instance={instance} choose={context.onScope} actions={Object.keys(pkg.actions).filter(id=>pkg.actions[id].surfaces.includes("chat") && instance.grants.includes(capability[pkg.actions[id].op]))}/>}
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
  delete: "records.commit",
  update: "records.commit",
  generate: "ai.generate",
};

export function AppView({
  selectionSource,
  proposal,
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
  const actionIDs = surface === "page" ? page.actions : [
    ...page.actions,
    ...Object.keys(pkg.actions).filter((id) => !pkg.pages.some((p) => p.actions.includes(id))),
  ];
  const actions = (proposal?.actions ?? actionIDs).filter((id) => pkg.actions[id].surfaces.includes(surface));
  const desired = proposal && pkg.actions[proposal.action];
  const autoQuery = actions.find(
    (id) =>
      pkg.actions[id].op === "query" && (!desired || pkg.actions[id].collection === desired.collection) &&
      Object.keys(pkg.actions[id].inputs ?? {}).every((key) => Object.hasOwn(pkg.actions[id].defaults ?? {}, key)),
  );
  const [query, setQuery] = useState<
    { action: string; inputs: MiniAppFields } | undefined
  >(() => proposal && desired?.op==="query" ? {action:proposal.action,inputs:proposal.inputs} : (autoQuery ? { action: autoQuery, inputs: {} } : undefined));
  const [form, setForm] = useState<{
    id: string;
    key: string;
    initial?: MiniAppFields;
  } | undefined>(()=>proposal && desired?.op!=="query" ? {id:proposal.action,initial:proposal.inputs,key:proposal.action} : undefined);
  const openForm = (id: string, initial?: MiniAppFields) =>
    setForm({ id, initial, key: crypto.randomUUID() });
  const [selectedRefs, setSelected] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  const canQuery = instance.grants.includes("records.query");
  const rows = useInfiniteQuery({
    queryKey: [
      "mini-app-records",
      instance.id,
      instance.release_id,
      page.id,
      instance.revision,
      surface,
      query,
    ],
    initialPageParam: "",
    getNextPageParam: (last: MiniAppResult) => last.next_cursor,
    queryFn: ({ pageParam }) =>
      miniApps.invoke(instance.id, {
        expected_instance_revision: instance.revision,
        action: query!.action,
        cursor: pageParam || undefined,
        surface,
        inputs: query!.inputs,
        operation_id: crypto.randomUUID(),
      }),
    enabled: !!query && canQuery,
    retry: false,
  });
  const records = rows.data?.pages.flatMap((page) => page.records ?? []) ?? [];
  const selected = records.filter((r) => selectedRefs[r.id] === r.revision);
  const [practiceRecords, setPracticeRecords] = useState<typeof records>();
  const transfer = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!query || !selected.length) return;
      const { records } = await miniApps.attach(instance.id, {
        expected_instance_revision: instance.revision,
        action: query.action,
        inputs: query.inputs,
        surface,
        view: page.id,
        records: selected.map(({ id, revision }) => ({ id, revision })),
      });
      const collection = pkg.actions[query.action].collection;
      const localFields = collection ? Object.keys(pkg.collections[collection].links ?? {}) : [];
      await attach(snapshot(instance, query.action, page.id, records,localFields));
    },
  });
  function choose(id: string) {
    setFeedback("");
    const act = pkg.actions[id];
    if (act.op === "query" && !Object.keys(act.inputs ?? {}).length)
      return performQuery(id, {});
    const record = selected.length === 1 ? selected[0] : undefined;
    if (record && act.selection_inputs && query && act.selection_inputs.collection === pkg.actions[query.action].collection) {
      const initial = Object.fromEntries(Object.entries(act.selection_inputs.fields).map(([input, field]) =>
        [input, field === "$id" ? record.id : record.fields[field]]));
      return openForm(id, initial);
    }
    openForm(id, record && (act.op === "update" || act.op === "generate") ? record.fields : undefined);
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
  if (practiceRecords && page.practice) return <AppPractice allowReading={instance.grants.includes("speech.speak")} instance={instance.id} revision={instance.revision} pkg={pkg} practice={page.practice}
    records={practiceRecords} finish={() => setPracticeRecords(undefined)}
    changed={() => void cache.invalidateQueries({queryKey: ["mini-app-records", instance.id]})}/>;
  const sourceLinks = query ? pkg.collections[pkg.actions[query.action].collection!]?.links ?? {} : {};
  return (
    <div className="space-y-4">
      {surface === "page" && page.practice && query?.action === page.practice.query && records.length > 0 && instance.grants.includes("records.commit") &&
        <Button onClick={() => setPracticeRecords(selected.length ? selected : records)}>Start practice ({selected.length || records.length})</Button>}
      {surface === "page" && instance.grants.includes("mac.selection.receive") && <MacSelection instance={instance.id} view={page.id} open={openForm}/>}
      <div className="flex flex-wrap gap-2" aria-label="App actions">
        {actions.map((id) => {
          const act = pkg.actions[id];
          const allowed = instance.grants.includes(capability[act.op]);
          const needsSelection =
            (act.op === "update" || act.op === "delete") &&
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
      {!proposal && surface !== "page" && (
        <AppProposal
          instance={instance}
          pkg={pkg}
          actions={actions.filter((id) => {
            const act = pkg.actions[id];
            return (
              instance.grants.includes(capability[act.op]) &&
              ((act.op !== "update" && act.op !== "delete") ||
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
          selectionSource={selectionSource}
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
                disabled={selected.length >= 50 && selectedRefs[record.id] !== record.revision}
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
              <div className="min-w-0">
              <Fields
                fields={Object.fromEntries(Object.entries(record.fields).filter(([key]) => !Object.hasOwn(sourceLinks,key) && !Object.values(sourceLinks).some((link) => link.label === key)))}
                reveal={pkg.actions[query.action].reveal_field}
              />
              {Object.entries(sourceLinks).map(([field, link]) => record.fields[field] && pkg.actions[link.query].surfaces.includes(surface)
                ? <AppRecordSource key={field} instance={instance.id} revision={instance.revision} action={link.query} surface={surface}
                  id={String(record.fields[field])} label={String(record.fields[link.label] || "Open material")}/> : null)}
              </div>
            </div>
          ))}
          {rows.hasNextPage && (
            <Button
              size="sm"
              variant="outline"
              disabled={rows.isFetching}
              onClick={() => void rows.fetchNextPage()}
            >
              Load more records
            </Button>
          )}
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
