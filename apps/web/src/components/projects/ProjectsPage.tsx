import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import type { Project } from "@cove/api-contract";
import {
  ArrowLeft,
  Archive,
  ArrowRight,
  BookOpen,
  StickyNote,
  FileText,
  FolderClosed,
  MoreHorizontal,
  Plus,
  Pin,
  Search,
} from "lucide-react";
import { getProject, getProjects, projectKeys } from "@/api/projects";
import { searchConversations } from "@/api/conversations";
import { useConversations } from "@/api/hooks/useConversations";
import { conversationKeys } from "@/api/queryKeys";
import type { ChatWorkspace } from "@/hooks/workspace/use-chat-workspace";
import { ConversationActions } from "@/components/conversations/ConversationList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspaceToast } from "@/components/layout/WorkspaceToast";
import { primitivesStyles } from "@/styles/primitives";

export function ProjectsPage({ workspace: w }: { workspace: ChatWorkspace }) {
  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto"
      aria-label="Project workspace"
    >
      {w.feedback && (
        <WorkspaceToast feedback={w.feedback} onDismiss={w.setFeedback} />
      )}
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-10 sm:py-10">
        {w.narrowLayout && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-4"
            onClick={() => w.setMobileSidebarOpen(true)}
          >
            Menu
          </Button>
        )}
        {w.projectPage?.projectId ? (
          <ProjectHome
            key={w.projectPage.projectId}
            id={w.projectPage.projectId}
            workspace={w}
          />
        ) : (
          <ProjectDirectory workspace={w} />
        )}
      </div>
    </section>
  );
}

function ProjectDirectory({ workspace: w }: { workspace: ChatWorkspace }) {
  const projects = useQuery({
    queryKey: projectKeys,
    queryFn: getProjects,
    retry: false,
    enabled: w.connection === "ready",
  });
  const [search, setSearch] = useState("");
  const visible = (projects.data ?? []).filter((p) =>
    `${p.name} ${p.description}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="mb-8 -ml-3 gap-2 text-muted-foreground"
        onClick={() => w.setProjectPage(undefined)}
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Back to chat
      </Button>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">
            Projects
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            A place for related chats, shared background and reference
            materials.
          </p>
        </div>
        <Button className="gap-2" onClick={() => w.setProjectEditor(null)}>
          <Plus size={16} aria-hidden="true" />
          New project
        </Button>
      </header>
      <div className="relative my-8 max-w-sm">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          aria-label="Search projects"
          placeholder="Find a project"
          className="pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {projects.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading projects…
        </p>
      ) : projects.isError ? (
        <div role="alert">
          <p>Projects could not be loaded.</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void projects.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : visible.length ? (
        <div className="grid gap-4 md:grid-cols-2" aria-label="Your projects">
          {visible.map((p) => (
            <div key={p.id} className="relative">
              <button
                className="group flex h-full min-h-40 w-full items-start gap-4 rounded-2xl border border-border/70 bg-card p-6 pr-16 text-left transition-colors hover:border-primary/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => w.setProjectPage({ projectId: p.id })}
                aria-label={`Open project ${p.name}`}
              >
                <span className="rounded-xl bg-muted p-3 text-muted-foreground">
                  <FolderClosed size={22} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{p.name}</span>
                  {p.description && (
                    <span className="mt-2 line-clamp-2 block text-sm leading-relaxed text-muted-foreground">
                      {p.description}
                    </span>
                  )}
                  <span className="mt-4 block text-xs text-muted-foreground">
                    {p.conversation_count}{" "}
                    {p.conversation_count === 1 ? "chat" : "chats"} · Updated{" "}
                    {new Date(p.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </span>
              </button>
              <div className="absolute right-4 top-5">
                <ProjectActions project={p} workspace={w} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <FolderClosed
            size={32}
            className="mx-auto mb-4 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-lg font-medium">
            {search ? "No matching projects" : "Your first project starts here"}
          </h2>
          <p className="mx-auto mt-2 max-w-md px-4 text-sm leading-relaxed text-muted-foreground">
            {search
              ? "Try another name or description."
              : "Create a project when you want to reuse context across conversations."}
          </p>
        </div>
      )}
    </>
  );
}

function ProjectHome({
  id,
  workspace: w,
}: {
  id: string;
  workspace: ChatWorkspace;
}) {
  const project = useQuery({
    queryKey: [...projectKeys, id],
    queryFn: () => getProject(id),
    retry: false,
  });
  const active = useConversations(false, id),
    archived = useConversations(true, id);
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: [...conversationKeys.searches, "project-page", id, search],
    queryFn: async ({ signal }) =>
      (
        await Promise.all(
          [false, true].map((archived) =>
            searchConversations(search, archived, signal, { projectId: id }),
          ),
        )
      ).flat(),
    enabled: !!search,
    retry: false,
  });
  const chats = search
    ? (results.data ?? [])
    : [...(active.data ?? []), ...(archived.data ?? [])].sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
          b.updated_at.localeCompare(a.updated_at),
      );
  const loading = search
    ? results.isPending
    : active.isPending || archived.isPending;
  const failed = search ? results.isError : active.isError || archived.isError;
  const p = project.data;
  function openChat(chatId: string) {
    void w.handleSelectConversation(chatId);
  }
  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 gap-2 text-muted-foreground"
          onClick={() => w.setProjectPage({})}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Projects
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => w.setProjectPage(undefined)}
        >
          Back to chat
        </Button>
      </div>
      {project.isPending ? (
        <p role="status">Loading project…</p>
      ) : !p ? (
        <div role="alert">
          <h1 className="text-xl font-semibold">This project is unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Return to Projects to see the current list.
          </p>
        </div>
      ) : (
        <>
          <header className="mb-10 flex items-start justify-between gap-5">
            <div className="min-w-0">
              <h1 className="break-words font-serif text-4xl tracking-tight sm:text-5xl">
                {p.name}
              </h1>
              {p.description &&
                (p.description.length <= 180 &&
                p.description.split("\n").length <= 3 ? (
                  <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {p.description}
                  </p>
                ) : (
                  <details className="group mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <span className="line-clamp-3 whitespace-pre-wrap group-open:hidden">
                        {p.description}
                      </span>
                      <span className="mt-2 inline-block text-foreground group-open:hidden">
                        Show more
                      </span>
                      <span className="hidden text-foreground group-open:inline">
                        Show less
                      </span>
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap">{p.description}</p>
                  </details>
                ))}
            </div>
            <ProjectActions project={p} workspace={w} />
          </header>
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <section className="min-w-0" aria-label="Project chats">
              <form
                className="mb-10 rounded-2xl border border-border bg-muted/40 p-4 transition-colors focus-within:border-primary/40"
                onSubmit={(event) => {
                  event.preventDefault();
                  void w.handleCreateConversation(p.id, w.projectDrafts[p.id]);
                }}
              >
                <textarea
                  aria-label="New project chat draft"
                  placeholder={`New chat in ${p.name}`}
                  className="min-h-24 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                  value={w.projectDrafts[p.id] ?? ""}
                  disabled={
                    w.isNavigating || w.isSending || w.connection !== "ready"
                  }
                  onChange={(event) =>
                    w.setProjectDrafts((current) => ({
                      ...current,
                      [p.id]: event.target.value,
                    }))
                  }
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Shared project context is included in new chats.
                  </p>
                  <Button
                    type="submit"
                    size="sm"
                    aria-label="New chat in project"
                    disabled={
                      w.isSending || w.isNavigating || w.connection !== "ready"
                    }
                  >
                    Start chat <ArrowRight size={14} aria-hidden="true" />
                  </Button>
                </div>
              </form>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Recents
                </h2>
                <Input
                  aria-label="Search project chats"
                  placeholder="Search chats"
                  value={query}
                  maxLength={256}
                  className="h-8 max-w-52 text-xs"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {loading ? (
                <p role="status" className="py-6 text-sm text-muted-foreground">
                  Loading chats…
                </p>
              ) : failed ? (
                <p role="alert" className="py-6 text-sm text-destructive">
                  Project chats could not be loaded.
                </p>
              ) : !chats.length ? (
                <div className="py-8 text-sm text-muted-foreground">
                  <p>
                    {search
                      ? "No matching chats"
                      : "Your project chats will appear here."}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {chats.map((chat) => (
                    <div key={chat.id} className="relative">
                      <button
                        className="flex w-full items-center gap-4 py-5 pl-1 pr-12 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => openChat(chat.id)}
                        title={chat.title}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                            {chat.pinned && (
                              <Pin
                                size={13}
                                className="shrink-0 text-muted-foreground"
                                aria-label="Pinned conversation"
                              />
                            )}
                            <span className="truncate">{chat.title}</span>
                          </span>
                          {"excerpt" in chat && (
                            <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {String(chat.excerpt)}
                            </span>
                          )}
                        </span>
                        {chat.archived && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Archive size={12} aria-hidden="true" />
                            Archived
                          </span>
                        )}
                        <time
                          className="shrink-0 text-xs text-muted-foreground"
                          dateTime={chat.updated_at}
                        >
                          {new Date(chat.updated_at).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </time>
                      </button>
                      <ConversationActions
                        conversation={chat}
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
                  ))}
                </div>
              )}
            </section>
            <aside aria-label="Project background and materials">
              <div className="divide-y divide-border">
                {[
                  {
                    label: "Instructions",
                    icon: StickyNote,
                    filled: !!p.instructions,
                  },
                  {
                    label: "Background",
                    icon: BookOpen,
                    filled: !!p.background,
                  },
                  {
                    label: "Files and webpages",
                    icon: FileText,
                    filled: p.sources.length > 0,
                  },
                ].map(({ label, icon: Icon, filled }) => (
                  <div key={label}>
                    <Button
                      variant="ghost"
                      className="h-auto min-h-16 w-full justify-start gap-3 rounded-none px-1 py-5 font-normal"
                      aria-label={
                        label === "Instructions"
                          ? "Manage project context"
                          : `Manage project ${label.toLowerCase()}`
                      }
                      onClick={() => w.setProjectEditor(p)}
                    >
                      <Icon
                        size={18}
                        className="text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="flex-1 text-left">
                        {label}
                        {label === "Files and webpages" && p.sources.length > 0
                          ? ` · ${p.sources.length}`
                          : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {filled ? "Edit" : "Add"}
                      </span>
                    </Button>
                  </div>
                ))}
              </div>
              {p.sources.length > 0 && (
                <ul className="mt-2 space-y-2 pl-1 text-xs text-muted-foreground">
                  {p.sources.map((source) => (
                    <li key={source.id} className="break-words">
                      {source.snapshot.name}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-6 px-1 text-xs leading-relaxed text-muted-foreground">
                Stored locally. Shared with selected models when you send a
                message.
              </p>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

function ProjectActions({
  project,
  workspace: w,
}: {
  project: Project;
  workspace: ChatWorkspace;
}) {
  return (
    <Menu as="div">
      <MenuButton
        as={Button}
        variant="ghost"
        size="icon"
        aria-label={`Project actions: ${project.name}`}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        portal
        transition
        className={primitivesStyles.conversationActions_menu}
      >
        <MenuItem>
          <Button variant="ghost" onClick={() => w.setProjectEditor(project)}>
            Edit project
          </Button>
        </MenuItem>
        <MenuItem>
          <Button
            variant="ghost"
            onClick={() =>
              w.setProjectRemoval({ project, deleteConversations: false })
            }
          >
            Dissolve project
          </Button>
        </MenuItem>
        <MenuItem>
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() =>
              w.setProjectRemoval({ project, deleteConversations: true })
            }
          >
            Delete project
          </Button>
        </MenuItem>
      </MenuItems>
    </Menu>
  );
}
