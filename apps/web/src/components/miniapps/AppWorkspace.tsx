import "./study-book.css";
import { StudyDialog } from "./StudyDialog";
import { BookOpen, Layers, FileText, ChevronRight } from "lucide-react";
import { MacSelection } from "./MacSelection";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  MiniAppAction,
  MiniAppFields,
  MiniAppInstance,
  MiniAppPackage,
  MiniAppResult,
  MiniAppRecord,
  MiniAppSurface,
} from "@cove/api-contract";
import {
  ChevronLeft,
  Settings2,
  Check,
  Plus,
  Sparkles,
  Search,
  ListFilter,
  Play,
  X,
} from "lucide-react";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AppPractice } from "./AppPractice";
import { AppRecordSource } from "./AppRecordSource";
import { AppTurnScope } from "./AppTurnScope";
import { AppBlobs } from "./AppBlobs";
import { AppProposal } from "./AppProposal";
import { AppActionForm } from "./AppActionForm";
import { AppSettings } from "./AppSettings";
import { AppRecordFields, recordPrimaryField } from "./AppRecordFields";
import {
  ErrorMessage,
  OpenApp,
  CopyAppLink,
  sectionStyle,
  snapshot,
} from "./presentation";

export interface AppContext {
  selectionSource?: "selection";
  onScope?: (
    scope: import("@cove/api-contract").MiniAppTurnScope,
    name: string,
  ) => void;
  proposal?: {
    action: string;
    inputs: MiniAppFields;
    actions: string[];
    origin?: string;
  };
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
  const study = pkg.pages.find((p) => p.practice)?.practice;
  const studyCollection = study && pkg.actions[study.query].collection;
  const materialPage =
    studyCollection &&
    pkg.pages.find((p) =>
      p.actions.some((id) => {
        const action = pkg.actions[id];
        return action.op === "create" && action.collection !== studyCollection;
      }),
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={back}>
          <ChevronLeft />
          My apps
        </Button>
        <div>
          {context.surface === "page" && page && (
            <CopyAppLink instance={instance} view={page.id} />
          )}
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
      <header
        className={
          study
            ? "py-3 sm:py-5"
            : "rounded-2xl border border-border/70 bg-card p-5 sm:p-6"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            {study && (
              <p className="study-kicker mb-2">
                <BookOpen className="size-4" /> Your study space
              </p>
            )}
            <h2
              className={
                study
                  ? "text-3xl font-semibold tracking-tight sm:text-4xl"
                  : "text-2xl font-semibold tracking-tight sm:text-3xl"
              }
            >
              {instance.name}
            </h2>
          </div>
          {materialPage &&
            page?.id !== materialPage.id &&
            !settings &&
            instance.enabled && (
              <Button
                variant="outline"
                onClick={() => navigate(id, materialPage.id)}
              >
                <Plus className="size-4" /> Add study material
              </Button>
            )}
        </div>
        {pkg.description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {pkg.description}
          </p>
        )}
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer hover:text-foreground">
            About this app
          </summary>
          <p className="mt-2 break-words">
            {pkg.name} · v{pkg.version} · {pkg.publisher} / {pkg.app}
          </p>
        </details>
        {artwork && (
          <img
            className="mt-3 max-h-64 max-w-full rounded-lg object-contain"
            alt={artwork.alt}
            src={"data:" + artwork.mime + ";base64," + artwork.data}
          />
        )}
      </header>
      {instance.enabled && !settings && context.onScope && (
        <AppTurnScope
          key={instance.revision}
          pkg={pkg}
          instance={instance}
          choose={context.onScope}
          actions={Object.keys(pkg.actions).filter(
            (id) =>
              pkg.actions[id].surfaces.includes("chat") &&
              instance.grants.includes(capability[pkg.actions[id].op]),
          )}
        />
      )}
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
            className="flex flex-wrap gap-1 border-b border-border/70 pb-3"
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
  const actionIDs =
    surface === "page"
      ? page.actions
      : [
          ...page.actions,
          ...Object.keys(pkg.actions).filter(
            (id) => !pkg.pages.some((p) => p.actions.includes(id)),
          ),
        ];
  const actions = (proposal?.actions ?? actionIDs).filter((id) =>
    pkg.actions[id].surfaces.includes(surface),
  );
  const desired = proposal && pkg.actions[proposal.action];
  // Queries stay local until the user explicitly attaches records to a draft.
  const selectionQueries =
    proposal && desired && (desired.op === "update" || desired.op === "delete")
      ? Object.keys(pkg.actions).filter(
          (id) =>
            pkg.actions[id].op === "query" &&
            pkg.actions[id].collection === desired.collection &&
            pkg.actions[id].surfaces.includes(surface),
        )
      : [];
  const autoQuery = [...actions, ...selectionQueries].find(
    (id) =>
      pkg.actions[id].op === "query" &&
      (!desired || pkg.actions[id].collection === desired.collection) &&
      Object.keys(pkg.actions[id].inputs ?? {}).every((key) =>
        Object.hasOwn(pkg.actions[id].defaults ?? {}, key),
      ),
  );
  const [query, setQuery] = useState<
    { action: string; inputs: MiniAppFields } | undefined
  >(() =>
    proposal && desired?.op === "query"
      ? { action: proposal.action, inputs: proposal.inputs }
      : autoQuery
        ? { action: autoQuery, inputs: {} }
        : undefined,
  );
  const [form, setForm] = useState<
    | {
        id: string;
        key: string;
        initial?: MiniAppFields;
        records?: MiniAppRecord[];
      }
    | undefined
  >(() =>
    proposal && desired?.op !== "query"
      ? { id: proposal.action, initial: proposal.inputs, key: proposal.action }
      : undefined,
  );
  const formIdentity = useRef(form?.key);
  const [formPending, setFormPending] = useState(false);
  function closeForm() {
    formIdentity.current = undefined;
    setForm(undefined);
  }
  const openForm = (
    id: string,
    initial?: MiniAppFields,
    target?: MiniAppRecord[],
  ) => {
    const key = crypto.randomUUID();
    formIdentity.current = key;
    setForm({
      id,
      initial,
      records: ["update", "delete"].includes(pkg.actions[id].op)
        ? (target ?? selected)
        : undefined,
      key,
    });
  };
  const [selectedRecords, setSelected] = useState<
    Record<string, MiniAppRecord>
  >({});
  const selectedRefs = Object.fromEntries(
    Object.values(selectedRecords).map((record) => [
      record.id,
      record.revision,
    ]),
  );
  const [filter, setFilter] = useState("");
  const search = useDeferredValue(filter);
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
      search,
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
        search: search || undefined,
        operation_id: crypto.randomUUID(),
      }),
    enabled: !!query && canQuery,
    retry: false,
  });
  const records = rows.data?.pages.flatMap((page) => page.records ?? []) ?? [];
  const selectionScope = JSON.stringify([query, search]);
  const previousRows = useRef(new Map<string, Map<string, number>>());
  useEffect(() => {
    if (!rows.data) return;
    const revisions = new Map(
      rows.data.pages
        .flatMap((page) => page.records ?? [])
        .map((record) => [record.id, record.revision]),
    );
    const previous = previousRows.current.get(selectionScope);
    previousRows.current.set(selectionScope, revisions);
    const stale = (record: MiniAppRecord) =>
      revisions.has(record.id)
        ? revisions.get(record.id) !== record.revision
        : previous?.has(record.id);
    const staleIds = Object.keys(selectedRecords).filter((id) =>
      stale(selectedRecords[id]),
    );
    if (form?.records?.some(stale)) {
      formIdentity.current = undefined;
      setForm(undefined);
      setFeedback(
        "Saved items changed. Reopen the action to review the latest selection.",
      );
    } else if (staleIds.length && !form) {
      setFeedback(
        "Some selected items changed or are no longer in the loaded results. Review the remaining selection before continuing.",
      );
    }
    if (staleIds.length)
      setSelected((selected) => {
        const next = { ...selected };
        for (const id of staleIds) delete next[id];
        return next;
      });
  }, [rows.data, selectionScope, form, selectedRecords]);
  const selected = Object.values(selectedRecords);
  const selectedPracticeRecords = records.filter(
    (record) => selectedRefs[record.id] === record.revision,
  );
  const practiceQueue = selectedPracticeRecords.length
    ? selectedPracticeRecords
    : records;
  const [practiceRecords, setPracticeRecords] = useState<typeof records>();
  const [detail, setDetail] = useState<MiniAppRecord>();
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
      const localFields = collection
        ? Object.keys(pkg.collections[collection].links ?? {})
        : [];
      await attach(
        snapshot(instance, query.action, page.id, records, localFields),
      );
    },
  });
  function choose(id: string) {
    setFeedback("");
    const act = pkg.actions[id];
    const suggested = proposal?.action === id ? proposal.inputs : undefined;
    if (act.op === "query" && !Object.keys(act.inputs ?? {}).length)
      return performQuery(id, {});
    const record = selected.length === 1 ? selected[0] : undefined;
    if (
      record &&
      act.selection_inputs &&
      query &&
      act.selection_inputs.collection === pkg.actions[query.action].collection
    ) {
      const initial = Object.fromEntries(
        Object.entries(act.selection_inputs.fields).map(([input, field]) => [
          input,
          field === "$id" ? record.id : record.fields[field],
        ]),
      );
      return openForm(id, { ...initial, ...suggested });
    }
    openForm(
      id,
      suggested ??
        (record && (act.op === "update" || act.op === "generate")
          ? record.fields
          : undefined),
    );
  }
  function performQuery(action: string, inputs: MiniAppFields) {
    if (
      query?.action === action &&
      JSON.stringify(query.inputs) === JSON.stringify(inputs)
    )
      void rows.refetch();
    setQuery({ action, inputs });
    setFilter("");
    setSelected({});
    closeForm();
  }
  function saved(count: number, identity: string, actionId: string) {
    void cache.invalidateQueries({
      queryKey: ["mini-app-records", instance.id],
    });
    if (formIdentity.current !== identity) return;
    closeForm();
    setSelected({});
    setFeedback(
      (pkg.actions[actionId].op === "delete" ? "Deleted " : "Saved ") +
        count +
        " " +
        (count === 1 ? "record" : "records") +
        (pkg.actions[actionId].op === "delete" ? " from " : " to ") +
        instance.name +
        ".",
    );
  }
  const practicePanel =
    practiceRecords && page.practice ? (
      <AppPractice
        modal
        allowReading={instance.grants.includes("speech.speak")}
        instance={instance.id}
        revision={instance.revision}
        pkg={pkg}
        practice={page.practice}
        records={practiceRecords}
        finish={() => {
          setPracticeRecords(undefined);
          setSelected({});
        }}
        changed={() =>
          void cache.invalidateQueries({
            queryKey: ["mini-app-records", instance.id],
          })
        }
        refresh={async () => {
          const refreshed = await cache.fetchQuery({
            queryKey: appKeys.instance(instance.id),
            queryFn: () => miniApps.get(instance.id),
            staleTime: 0,
          });
          await cache.invalidateQueries({
            queryKey: ["mini-app-records", instance.id],
            refetchType:
              refreshed.instance.revision === instance.revision
                ? "active"
                : "none",
          });
        }}
      />
    ) : null;
  function renderAction(id: string) {
    const action = pkg.actions[id];
    const allowed = instance.grants.includes(capability[action.op]);
    const needsSelection =
      (action.op === "update" || action.op === "delete") &&
      (!selected.length ||
        !query ||
        pkg.actions[query.action].collection !== action.collection);
    const active =
      form?.id === id || (action.op === "query" && query?.action === id);
    return (
      <Button
        key={id}
        size="sm"
        variant={
          active
            ? "secondary"
            : action.op === "create"
              ? "default"
              : action.op === "query"
                ? "ghost"
                : "outline"
        }
        className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left"
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
        {action.op === "create" && <Plus aria-hidden="true" />}
        {action.op === "generate" && <Sparkles aria-hidden="true" />}
        {action.title}
      </Button>
    );
  }
  const study = pkg.pages.find((p) => p.practice)?.practice;
  const studyCollection = study && pkg.actions[study.query].collection;
  const isStudyList =
    !!study &&
    !!query &&
    pkg.actions[query.action].collection === studyCollection;
  const studySurface = !!study && surface === "page";
  const isPracticeQuery =
    surface === "page" &&
    page.practice &&
    query?.action === page.practice.query;
  const sourceLinks = query
    ? (pkg.collections[pkg.actions[query.action].collection!]?.links ?? {})
    : {};
  return (
    <div className={studySurface ? "study-workspace space-y-5" : "space-y-4"}>
      {practicePanel}
      {isPracticeQuery && (
        <section className="study-overview" aria-label="Study overview">
          <div>
            <span className="study-kicker">
              <Layers className="size-4" /> Study session
            </span>
            <h3>Today’s review</h3>
            <p>
              {!canQuery
                ? "Allow record access in Settings to see your review queue."
                : rows.isPending
                  ? "Getting your review queue ready…"
                  : rows.isError
                    ? "Your review queue could not be loaded. Try refreshing below."
                    : records.length
                      ? `${records.length}${rows.hasNextPage ? "+" : ""} ${records.length === 1 && !rows.hasNextPage ? "card" : "cards"} ready to practice${search ? " in these search results" : ""}. Take a moment to recall each answer before revealing it.`
                      : search
                        ? "No cards match your search. Try another phrase."
                        : "You’re all caught up. Add study material or visit your question library to keep learning."}
            </p>
            {records.length > 0 && (
              <Button
                disabled={
                  !instance.grants.includes("records.commit") || rows.isFetching
                }
                title={
                  !instance.grants.includes("records.commit")
                    ? "Allow saving changes in Settings to practice"
                    : undefined
                }
                onClick={() => {
                  setPracticeRecords(practiceQueue);
                  setSelected({});
                  setFeedback("");
                }}
                className="mt-5 h-11 gap-2 rounded-xl px-5"
              >
                <Play className="size-4" aria-hidden="true" /> Start practice (
                {practiceQueue.length})
              </Button>
            )}
            {rows.hasNextPage && (
              <p className="mt-2 text-xs">
                This session uses the loaded cards. Load more below to include
                them.
              </p>
            )}
          </div>
          <div className="study-card-art" aria-hidden="true">
            <BookOpen />
          </div>
        </section>
      )}
      {surface === "page" &&
        instance.grants.includes("mac.selection.receive") && (
          <MacSelection instance={instance.id} view={page.id} open={openForm} />
        )}
      {selectionQueries.length > 0 && (
        <label className="grid gap-1 text-sm">
          Choose records locally
          <select
            value={query?.action ?? ""}
            onChange={(event) => choose(event.target.value)}
          >
            {!query && (
              <option value="" disabled>
                Choose a query
              </option>
            )}
            {selectionQueries.map((id) => (
              <option key={id} value={id}>
                {pkg.actions[id].title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        aria-label="App actions"
      >
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="View filters"
        >
          {actions.filter((id) => pkg.actions[id].op === "query").length >
            0 && (
            <ListFilter
              className="mr-1 size-4 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          {actions
            .filter((id) => pkg.actions[id].op === "query")
            .map(renderAction)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions
            .filter((id) => {
              const op = pkg.actions[id].op;
              return op === "create" || op === "generate";
            })
            .map(renderAction)}
        </div>
      </div>
      {(selected.length > 0 || proposal) &&
        actions.some(
          (id) =>
            pkg.actions[id].op === "update" || pkg.actions[id].op === "delete",
        ) && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/15 bg-primary/5 p-3"
            aria-label="Selected item actions"
          >
            <span className="mr-1 text-xs font-medium">
              {selected.length} selected
            </span>
            {actions
              .filter(
                (id) =>
                  pkg.actions[id].op === "update" ||
                  pkg.actions[id].op === "delete",
              )
              .map(renderAction)}
            {selected.length > 0 && (
              <Button
                size="xs"
                variant="ghost"
                disabled={!!form?.records?.length}
                onClick={() => setSelected({})}
              >
                <X aria-hidden="true" /> Clear selection
              </Button>
            )}
          </div>
        )}
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
      {form &&
        (studySurface ? (
          <StudyDialog title={pkg.actions[form.id].title} close={closeForm} busy={formPending}>
            <AppActionForm
              onPendingChange={setFormPending}
              key={form.key}
              instance={instance}
              pkg={pkg}
              actionId={form.id}
              proposalKey={proposal?.origin}
              surface={surface}
              initial={form.initial}
              selected={form.records ?? selected}
              draft={draft}
              selectionSource={selectionSource}
              localRequired={localRequired}
              close={closeForm}
              query={performQuery}
              saved={(count) => saved(count, form.key, form.id)}
              candidate={openForm}
            />
          </StudyDialog>
        ) : (
          <AppActionForm
            key={form.key}
            instance={instance}
            pkg={pkg}
            actionId={form.id}
            proposalKey={proposal?.origin}
            surface={surface}
            initial={form.initial}
            selected={form.records ?? selected}
            draft={draft}
            selectionSource={selectionSource}
            localRequired={localRequired}
            close={closeForm}
            query={performQuery}
            saved={(count) => saved(count, form.key, form.id)}
            candidate={openForm}
          />
        ))}
      {detail && studySurface && (
        <StudyDialog
          title={isStudyList ? "Question details" : "Material details"}
          close={() => setDetail(undefined)}
        >
          <AppRecordFields
            fields={Object.fromEntries(
              Object.entries(detail.fields).filter(
                ([key]) =>
                  !Object.hasOwn(sourceLinks, key) &&
                  !Object.values(sourceLinks).some(
                    (link) => link.label === key,
                  ),
              ),
            )}
            primary={recordPrimaryField(
              pkg,
              query && pkg.actions[query.action].collection,
            )}
            reveal={isStudyList ? study?.back : undefined}
            compact={isStudyList}
          />
          {Object.entries(sourceLinks).map(([field, link]) =>
            detail.fields[field] &&
            pkg.actions[link.query].surfaces.includes(surface) ? (
              <AppRecordSource
                key={field}
                instance={instance.id}
                revision={instance.revision}
                action={link.query}
                surface={surface}
                id={String(detail.fields[field])}
                label={String(detail.fields[link.label] || "Open material")}
              />
            ) : null,
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setDetail(undefined)}>
              Close
            </Button>
            {actions
              .filter(
                (id) =>
                  ["update", "delete"].includes(pkg.actions[id].op) &&
                  pkg.actions[id].collection ===
                    (query && pkg.actions[query.action].collection),
              )
              .map((id) => (
                <Button
                  key={id}
                  variant="outline"
                  disabled={!instance.grants.includes("records.commit")}
                  onClick={() => {
                    openForm(id, detail.fields, [detail]);
                    setDetail(undefined);
                  }}
                >
                  {pkg.actions[id].title}
                </Button>
              ))}
          </div>
        </StudyDialog>
      )}
      {feedback && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Check className="size-4" />
          {feedback}
        </p>
      )}
      {query && canQuery && (
        <section className="space-y-5 rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <h3 className="font-semibold">
                {pkg.actions[query.action].title}
              </h3>
              <p className="text-xs text-muted-foreground">
                {selected.length
                  ? "Your selection stays local until you choose an action."
                  : instance.grants.includes("records.commit") &&
                      instance.grants.includes("chat.attach")
                    ? "Select items to edit them or bring them into a chat."
                    : instance.grants.includes("records.commit")
                      ? "Select items to apply an action."
                      : instance.grants.includes("chat.attach")
                        ? "Select items to bring them into a chat."
                        : "Saved in this app on your Mac."}
              </p>
            </div>
            <Button
              size="xs"
              variant="ghost"
              disabled={rows.isFetching}
              onClick={() => void rows.refetch()}
            >
              Refresh
            </Button>
          </div>
          <label className="relative block">
            <span className="sr-only">Filter records</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="h-10 rounded-xl pl-9"
              type="search"
              value={filter}
              maxLength={256}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search matching records"
            />
          </label>
          {selected.length > 0 && (
            <p className="text-sm">
              {selected.length} selected across these results.
            </p>
          )}
          {rows.isPending && <p role="status">Loading records…</p>}
          <ErrorMessage error={rows.error} />
          {rows.isSuccess && !records.length && (
            <p className="text-sm text-muted-foreground">
              No matching records.
            </p>
          )}
          {records.map((record, i) => (
            <div
              className={
                (studySurface
                  ? "study-record flex items-center gap-3 border p-4 "
                  : "flex items-start gap-3 rounded-xl border p-4 transition-colors ") +
                (selectedRefs[record.id] === record.revision
                  ? "border-primary/30 bg-primary/4"
                  : "border-border/70 bg-background/35 hover:border-primary/20")
              }
              key={record.id}
            >
              <input
                className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                aria-label={"Select record " + (i + 1)}
                type="checkbox"
                checked={selectedRefs[record.id] === record.revision}
                disabled={
                  !!form?.records?.length ||
                  (selected.length >= 50 &&
                    selectedRefs[record.id] !== record.revision)
                }
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelected((old) => {
                    const next = { ...old };
                    if (checked) next[record.id] = record;
                    else delete next[record.id];
                    return next;
                  });
                }}
              />
              <div className="min-w-0 flex-1">
                {studySurface ? (
                  <button
                    type="button"
                    className="study-record-open"
                    onClick={() => setDetail(record)}
                  >
                    <span className="study-record-icon">
                      {isStudyList ? (
                        <Layers className="size-5" />
                      ) : (
                        <FileText className="size-5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <strong className="block truncate text-sm font-semibold">
                        {String(
                          record.fields[
                            recordPrimaryField(
                              pkg,
                              pkg.actions[query.action].collection,
                            ) ?? ""
                          ] ??
                            Object.values(record.fields).find(
                              (v) => typeof v === "string",
                            ) ??
                            "Open record",
                        )}
                      </strong>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {isStudyList
                          ? Object.values(sourceLinks)
                              .map((link) =>
                                String(record.fields[link.label] ?? ""),
                              )
                              .filter(Boolean)
                              .join(" · ") || "Review question"
                          : Object.entries(record.fields)
                              .filter(
                                ([key, v]) =>
                                  key !==
                                    recordPrimaryField(
                                      pkg,
                                      pkg.actions[query.action].collection,
                                    ) && typeof v === "string",
                              )
                              .map(([, v]) => String(v))
                              .join(" · ")}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ) : (
                  <AppRecordFields
                    fields={Object.fromEntries(
                      Object.entries(record.fields).filter(
                        ([key]) =>
                          !Object.hasOwn(sourceLinks, key) &&
                          !Object.values(sourceLinks).some(
                            (link) => link.label === key,
                          ),
                      ),
                    )}
                    primary={recordPrimaryField(
                      pkg,
                      pkg.actions[query.action].collection,
                    )}
                    reveal={
                      pkg.actions[query.action].reveal_field ??
                      (isStudyList ? study?.back : undefined)
                    }
                    compact={isStudyList}
                  />
                )}
                {surface === "page" &&
                  actions
                    .filter((id) => {
                      const action = pkg.actions[id];
                      return (
                        action.op === "generate" &&
                        action.selection_inputs?.collection ===
                          pkg.actions[query.action].collection
                      );
                    })
                    .map((id) => (
                      <Button
                        key={id}
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        disabled={!instance.grants.includes("ai.generate")}
                        onClick={() =>
                          openForm(
                            id,
                            Object.fromEntries(
                              Object.entries(
                                pkg.actions[id].selection_inputs!.fields,
                              ).map(([input, field]) => [
                                input,
                                field === "$id"
                                  ? record.id
                                  : record.fields[field],
                              ]),
                            ),
                          )
                        }
                      >
                        <Sparkles className="size-4" /> {pkg.actions[id].title}
                      </Button>
                    ))}
                {!studySurface &&
                  Object.entries(sourceLinks).map(([field, link]) =>
                    record.fields[field] &&
                    pkg.actions[link.query].surfaces.includes(surface) ? (
                      <AppRecordSource
                        key={field}
                        instance={instance.id}
                        revision={instance.revision}
                        action={link.query}
                        surface={surface}
                        id={String(record.fields[field])}
                        label={String(
                          record.fields[link.label] || "Open material",
                        )}
                      />
                    ) : null,
                  )}
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
