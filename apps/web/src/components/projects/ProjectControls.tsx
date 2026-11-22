import { FolderClosed } from "lucide-react";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@cove/api-contract";
import type { ChatWorkspace } from "@/hooks/workspace/use-chat-workspace";
import {
  getProjects,
  saveProject,
  addProjectSource,
  removeProjectSource,
  deleteProject,
  moveProjectConversation,
  projectKeys,
  getProject,
} from "@/api/projects";
import { usePreviewGenerationContext } from "@/api/hooks/useGenerations";
import {
  getConversation,
  prepareWebSource,
  releaseWebSource,
  LocalServiceError,
} from "@/api";
import { conversationKeys, generationKeys, debateKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FrontSelect } from "@/components/ui/front-select";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";
import { ConversationActions } from "@/components/conversations/ConversationList";
import { ProjectContextUsage } from "@/components/chat/ProjectContextUsage";

const errorText = (error: unknown) =>
  error instanceof LocalServiceError
    ? error.envelope.error.message
    : error instanceof Error
      ? error.message
      : "The project request failed.";
export function ProjectControls({
  workspace: w,
}: {
  workspace: ChatWorkspace;
}) {
  const previewContext = usePreviewGenerationContext().mutateAsync;
  const active = w.conversationView;
  const projectQuery = useQuery({
    queryKey: [...projectKeys, active?.project_id],
    queryFn: () => getProject(active!.project_id!),
    enabled: w.connection === "ready" && !!active?.project_id,
    retry: false,
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function review(id = active?.id) {
    if (!id) return;
    setBusy(true);
    try {
      const preview = await previewContext({
        conversationId: id,
        body: w.draft,
        attachments: w.attachmentDraft.attachments.flatMap((a) =>
          a.input ? [a.input] : [],
        ),
        webSourceTokens: w.attachmentDraft.attachments.flatMap((a) =>
          a.webSourceToken ? [a.webSourceToken] : [],
        ),
      });
      if (Array.isArray(preview))
        throw new Error(
          "The project-aware preview is unavailable. Reload Cove before sending.",
        );
      w.setProjectContextPreview(preview);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!active?.project_id && !w.feedback?.message.includes("240,000"))
    return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-5 py-2 text-xs"
      aria-label="Conversation project"
    >
      {active?.project_id && (
        <>
          <Button
            variant="ghost"
            size="xs"
            className="gap-2 text-muted-foreground"
            onClick={() => {
              w.exitFocusMode();
              w.setProjectPage({ projectId: active.project_id });
            }}
          >
            <FolderClosed size={14} aria-hidden="true" />
            {projectQuery.data?.name ?? "Project"}
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              aria-label="Review project context"
              disabled={busy || w.isSending}
              onClick={() => void review()}
            >
              Context
            </Button>
            <div className="relative h-8 w-8">
              <ConversationActions
                conversation={active}
                disabled={w.isSending}
                copy={w.copy}
                onRename={w.setRenameTarget}
                onPin={(conversation) =>
                  void w.handleUpdateConversation(conversation.id, {
                    pinned: !conversation.pinned,
                  })
                }
                onArchive={(conversation) =>
                  void w.handleUpdateConversation(conversation.id, {
                    archived: !conversation.archived,
                  })
                }
                onDownload={(conversation) =>
                  void w.handleRequestDownload(conversation.id)
                }
                onMoveToProject={w.setProjectMoveTarget}
                onDelete={w.handleDeleteConversation}
              />
            </div>
          </div>
        </>
      )}
      {w.feedback?.message.includes("240,000") && (
        <Button
          size="xs"
          variant="outline"
          disabled={busy || w.isSending || w.attachmentDraft.invalid}
          onClick={() =>
            void w.continueProjectDraft().then((id) => {
              if (id) void review(id);
            })
          }
        >
          Continue in a new conversation
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function ProjectDialogs({ workspace: w }: { workspace: ChatWorkspace }) {
  const cache = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: projectKeys }),
      cache.invalidateQueries({ queryKey: conversationKeys.all }),
    ]);
  };
  return (
    <>
      {w.projectMoveTarget && (
        <ProjectMoveDialog key={w.projectMoveTarget.id} workspace={w} />
      )}
      {w.projectEditor !== undefined && (
        <ProjectEditor
          key={
            w.projectEditor
              ? `${w.projectEditor.id}:${w.projectEditor.revision}`
              : "new"
          }
          value={w.projectEditor}
          close={() => w.setProjectEditor(undefined)}
          saved={async (p, options) => {
            if (w.projectEditor === null) w.setProjectPage({ projectId: p.id });
            w.setProjectEditor(options?.keepOpen ? p : undefined);
            await refresh();
          }}
          remove={(project, deleteConversations) => {
            w.setProjectEditor(undefined);
            w.setProjectRemoval({ project, deleteConversations });
          }}
        />
      )}
      {w.projectRemoval && (
        <ProjectRemovalDialog
          key={`${w.projectRemoval.project.id}:${w.projectRemoval.deleteConversations}`}
          project={w.projectRemoval.project}
          deleteConversations={w.projectRemoval.deleteConversations}
          close={() => w.setProjectRemoval(undefined)}
          beforeRemove={async (deleteConversations) => {
            if (
              deleteConversations &&
              w.conversationView?.project_id === w.projectRemoval?.project.id &&
              w.isSending &&
              !(await w.handleCancel())
            ) {
              throw new Error(
                "Active work could not be stopped. The project was preserved.",
              );
            }
          }}
          removed={async (deleteConversations) => {
            if (deleteConversations) {
              if (
                w.conversationView?.project_id === w.projectRemoval?.project.id
              ) {
                w.selectedIdRef.current = undefined;
                w.setSelectedId(undefined);
                w.setGenerationBatch(undefined);
                w.setLiveTurn(undefined);
                w.setIsSending(false);
              }
              await cache.cancelQueries({ queryKey: conversationKeys.all });
              cache.removeQueries({ queryKey: conversationKeys.all });
              cache.removeQueries({ queryKey: generationKeys.all });
              cache.removeQueries({ queryKey: debateKeys.all });
            }
            w.setProjectDrafts((current) => {
              const next = { ...current };
              delete next[w.projectRemoval!.project.id];
              return next;
            });
            w.setProjectRemoval(undefined);
            w.setProjectPage({});
            await refresh();
          }}
        />
      )}
      {w.projectContextPreview && (
        <Dialog
          open
          label="Project context"
          onClose={() => w.setProjectContextPreview(undefined)}
          className="fixed inset-0 z-50 flex items-center justify-center p-3"
        >
          <DialogOverlay />
          <DialogContent className="max-h-[85dvh] w-full max-w-3xl space-y-3 overflow-auto rounded-2xl p-5">
            <div className="flex justify-between">
              <h2>Project context</h2>
              <Button
                variant="outline"
                onClick={() => w.setProjectContextPreview(undefined)}
              >
                Close
              </Button>
            </div>
            <p>Preview only. Nothing has been sent to a model.</p>
            <p className="text-xs text-muted-foreground">
              Selected destinations:{" "}
              {w.activeModelSet
                .map((t) => {
                  const p = w.providerProfiles.find(
                    (p) => p.id === t.providerId,
                  );
                  return `${p?.name ?? t.providerId} / ${t.modelId}: ${p?.endpoint ?? "unavailable"}`;
                })
                .join("; ")}
            </p>
            <ProjectContextUsage
              project={w.projectContextPreview.project_context}
              usage={w.projectContextPreview.usage}
              preview
            />
            <p>
              {w.projectContextPreview.usage.total.toLocaleString()} characters
              in the complete request, including turn attachments.
            </p>
            {w.projectContextPreview.messages.map((m, i) => (
              <details key={i}>
                <summary>{m.role}</summary>
                <pre className="whitespace-pre-wrap break-words">
                  {m.content}
                </pre>
              </details>
            ))}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function ProjectEditor({
  value: initial,
  close,
  saved,
  remove,
}: {
  value: Project | null;
  close: () => void;
  saved: (p: Project, options?: { keepOpen?: boolean }) => Promise<void>;
  remove: (project: Project, deleteConversations: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [name, setName] = useState(value?.name ?? ""),
    [description, setDescription] = useState(value?.description ?? ""),
    [instructions, setInstructions] = useState(value?.instructions ?? ""),
    [background, setBackground] = useState(value?.background ?? ""),
    [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const dirty =
    !value ||
    name !== value.name ||
    description !== value.description ||
    instructions !== value.instructions ||
    background !== value.background;
  const chars =
    value?.sources.reduce((n, s) => n + s.snapshot.characters, 0) ?? 0;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(f: File) {
    if (!value) return;
    if (!f.size || f.size > 4 * 1024 * 1024)
      throw new Error("Each file must contain between 1 byte and 4 MiB.");
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("The file could not be read."));
      reader.readAsDataURL(f);
    });
    await saved(
      await addProjectSource(value.id, value.revision, {
        file: { name: f.name, data },
      }),
      { keepOpen: true },
    );
  }
  async function webpage() {
    if (!value) return;
    const prepared = await prepareWebSource(url, new AbortController().signal);
    try {
      await saved(
        await addProjectSource(value.id, value.revision, {
          web_source_token: prepared.source_token,
        }),
        { keepOpen: true },
      );
    } finally {
      await releaseWebSource(prepared.source_token).catch(() => undefined);
    }
  }
  return (
    <Dialog
      open
      label={value ? "Edit project" : "New project"}
      onClose={() => {
        if (!busy) close();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
    >
      <DialogOverlay />
      <DialogContent className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-auto rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">
            {value ? "Edit project" : "New project"}
          </h2>
          <Button variant="outline" disabled={busy} onClick={close}>
            {dirty ? "Cancel" : "Done"}
          </Button>
        </div>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () =>
              saved(
                await saveProject({
                  id: value?.id,
                  revision: value?.revision,
                  name,
                  description,
                  instructions,
                  background,
                }),
              ),
            );
          }}
        >
          <label className="block">
            Name
            <Input
              aria-label="Project name"
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            Description
            <Input
              aria-label="Project description"
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="block">
            Project instructions
            <textarea
              aria-label="Project instructions"
              className="mt-1 min-h-24 w-full rounded-lg border border-input bg-background p-2"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
          <label className="block">
            Project background
            <textarea
              aria-label="Project background"
              className="mt-1 min-h-32 w-full rounded-lg border border-input bg-background p-2"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Instructions guide behavior. Background and fixed sources are
            reference data. They are sent on every new turn to every selected
            model, use context, and may increase usage. Changes affect future
            turns; saved history keeps its original snapshots.
          </p>
          <Button type="submit" disabled={busy || !name.trim() || !dirty}>
            {busy ? "Saving…" : value ? "Save project" : "Create project"}
          </Button>
        </form>
        {value && (
          <section
            className="space-y-3 border-t border-border pt-3"
            aria-label="Fixed project sources"
          >
            <h3>
              Fixed sources · {value.sources.length} / 3 ·{" "}
              {chars.toLocaleString()} / 60,000 characters
            </h3>
            <p className="text-xs text-muted-foreground">
              At least one attachment slot and 60,000 source characters remain
              for each new turn.{" "}
              {dirty
                ? "Save project changes before changing sources."
                : "All fixed sources are included in each new turn."}
            </p>
            {value.sources.map((source) => (
              <div
                key={source.id}
                className="rounded-lg border border-border p-2"
              >
                <details>
                  <summary>
                    {source.snapshot.name} ·{" "}
                    {source.snapshot.characters.toLocaleString()} characters
                  </summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
                    {source.snapshot.sections
                      .map((s) => `${s.id}: ${s.text}`)
                      .join("\n")}
                  </pre>
                </details>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || dirty}
                  onClick={() =>
                    void run(async () =>
                      saved(
                        await removeProjectSource(
                          value.id,
                          source.id,
                          value.revision,
                        ),
                        { keepOpen: true },
                      ),
                    )
                  }
                >
                  Remove from future turns
                </Button>
              </div>
            ))}
            <input
              ref={file}
              type="file"
              className="sr-only"
              aria-label="Choose fixed project file"
              disabled={busy || dirty || value.sources.length >= 3}
              onChange={(event) => {
                const f = event.target.files?.[0];
                if (f) void run(() => upload(f));
                event.target.value = "";
              }}
            />
            <Button
              variant="outline"
              disabled={busy || dirty || value.sources.length >= 3}
              onClick={() => file.current?.click()}
            >
              Add fixed file
            </Button>
            <label className="block">
              Public webpage
              <Input
                type="url"
                aria-label="Fixed webpage URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <Button
              variant="outline"
              disabled={
                busy || dirty || value.sources.length >= 3 || !url.trim()
              }
              onClick={() => void run(webpage)}
            >
              Read and save webpage
            </Button>
          </section>
        )}
        {value && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => remove(value, false)}
            >
              Dissolve and keep conversations
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => remove(value, true)}
            >
              Delete project and its conversations
            </Button>
          </div>
        )}
        {error && (
          <div className="space-y-2">
            <p role="alert">{error}</p>
            {value && (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const latest = await getProject(value.id);
                      setName((old) =>
                        old === value.name ? latest.name : old,
                      );
                      setDescription((old) =>
                        old === value.description ? latest.description : old,
                      );
                      setInstructions((old) =>
                        old === value.instructions ? latest.instructions : old,
                      );
                      setBackground((old) =>
                        old === value.background ? latest.background : old,
                      );
                      setValue(latest);
                    })
                  }
                >
                  Refresh revision and keep my edits
                </Button>
                <details>
                  <summary>Latest loaded project text for comparison</summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                    {value.instructions + "\n\n" + value.background}
                  </pre>
                </details>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProjectRemovalDialog({
  project,
  deleteConversations,
  close,
  beforeRemove,
  removed,
}: {
  project: Project;
  deleteConversations: boolean;
  close: () => void;
  beforeRemove: (deleteConversations: boolean) => Promise<void>;
  removed: (deleteConversations: boolean) => Promise<void>;
}) {
  const [value, setValue] = useState(project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [changed, setChanged] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
      setChanged(
        e instanceof LocalServiceError &&
          e.envelope.error.code === "project_context_changed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      label={deleteConversations ? "Delete project" : "Dissolve project"}
      onClose={() => {
        if (!busy) close();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
    >
      <DialogOverlay />
      <DialogContent className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-auto rounded-2xl p-6">
        <h2 className="text-lg font-semibold">
          {deleteConversations ? "Delete" : "Dissolve"} “{value.name}”?
        </h2>
        <p className="text-sm leading-relaxed">
          {deleteConversations
            ? `Permanently delete this project, its instructions, background, fixed sources and ${value.conversation_count} current conversations? Active work in those conversations will be stopped. This cannot be undone.`
            : `Remove this project's instructions, background and fixed sources, and move ${value.conversation_count} conversations to Ungrouped? The conversations will be kept. Active work must be stopped first.`}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {value.historical_copies} historical snapshots in conversations
          outside this project will remain, including their original source
          downloads.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {changed && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setValue(await getProject(value.id));
                setChanged(false);
              })
            }
          >
            Refresh project details
          </Button>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel removal
          </Button>
          <Button
            variant={deleteConversations ? "destructive" : "default"}
            disabled={busy || changed}
            onClick={() =>
              void run(async () => {
                await beforeRemove(deleteConversations);
                await deleteProject(
                  value.id,
                  value.revision,
                  deleteConversations,
                );
                await removed(deleteConversations);
              })
            }
          >
            {busy
              ? "Removing…"
              : deleteConversations
                ? "Confirm deletion"
                : "Confirm dissolution"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectMoveDialog({ workspace: w }: { workspace: ChatWorkspace }) {
  const [target, setTarget] = useState(w.projectMoveTarget!);
  const cache = useQueryClient();
  const list = useQuery({
    queryKey: projectKeys,
    queryFn: getProjects,
    retry: false,
  });
  const [destination, setDestination] = useState(target.project_id || "__none");
  const [conflict, setConflict] = useState(false);
  const unchanged = destination === (target.project_id || "__none");
  async function refreshMembership() {
    setBusy(true);
    setError(undefined);
    try {
      const latest = await getConversation(target.id);
      cache.setQueryData(conversationKeys.detail(latest.id), latest);
      setTarget(latest);
      setDestination(latest.project_id || "__none");
      await Promise.all([
        cache.invalidateQueries({ queryKey: conversationKeys.lists }),
        list.refetch({ throwOnError: true }),
      ]);
      setConflict(false);
    } catch {
      setError(
        "Current project membership could not be refreshed. Try again before moving this conversation.",
      );
    } finally {
      setBusy(false);
    }
  }
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  async function move() {
    if (unchanged || conflict) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await moveProjectConversation(
        target.id,
        destination === "__none" ? "" : destination,
        target.membership_revision ?? 0,
      );
      cache.setQueryData(conversationKeys.detail(next.id), next);
      await Promise.all([
        cache.invalidateQueries({ queryKey: conversationKeys.all }),
        cache.invalidateQueries({ queryKey: projectKeys }),
      ]);
      w.setProjectMoveTarget(undefined);
    } catch (e) {
      if (
        e instanceof LocalServiceError &&
        e.envelope.error.code === "project_context_changed"
      ) {
        setConflict(true);
        setError(
          "Conversation membership changed. Refresh its current project, then choose where to move it.",
        );
      } else {
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      label="Move conversation to project"
      onClose={() => {
        if (!busy) w.setProjectMoveTarget(undefined);
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <DialogOverlay />
      <DialogContent className="w-full max-w-md space-y-5 rounded-2xl p-6">
        <div>
          <h2 className="text-lg font-semibold">Move to project</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose shared context for future turns in “{target.title}”. Earlier
            turns keep their saved context.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Current project:{" "}
            {target.project_id
              ? (list.data?.find((p) => p.id === target.project_id)?.name ??
                "Project")
              : "No project"}
          </p>
        </div>
        <FrontSelect
          label="Project"
          ariaLabel="Move conversation to project"
          value={destination}
          onValueChange={setDestination}
          disabled={busy || list.isPending || list.isError}
          options={[
            { value: "__none", label: "No project" },
            ...(list.data ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        {(error || list.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? "Projects could not be loaded."}
          </p>
        )}
        {conflict && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void refreshMembership()}
          >
            Refresh current project
          </Button>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => w.setProjectMoveTarget(undefined)}
          >
            Cancel
          </Button>
          <Button
            disabled={
              busy || conflict || unchanged || list.isPending || list.isError
            }
            onClick={() => void move()}
          >
            {busy ? "Moving…" : "Move conversation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
