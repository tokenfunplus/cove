// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ProjectControls,
  ProjectDialogs,
  ProjectEditor,
  ProjectRemovalDialog,
} from "./ProjectControls";
import * as api from "@/api/projects";
import * as transport from "@/api";
import { conversationKeys } from "@/api/queryKeys";
import { LocalServiceError } from "@/api";
import type { ChatWorkspace } from "@/hooks/workspace/use-chat-workspace";
import type { Project } from "@cove/api-contract";
vi.mock("@/api/projects", async (original) => ({
  ...(await original<typeof api>()),
  getProjects: vi.fn(),
  getProject: vi.fn(),
  saveProject: vi.fn(),
  addProjectSource: vi.fn(),
  removeProjectSource: vi.fn(),
  setProjectSourceUsage: vi.fn(),
  deleteProject: vi.fn(),
  moveProjectConversation: vi.fn(),
}));
const browserMethods: string[] = [];
afterEach(() => {
  cleanup();
  for (const name of browserMethods.splice(0)) Reflect.deleteProperty(Element.prototype, name);
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
test("a rejected project edit retains the edited background and chat draft", async () => {
  const p: Project = {
    id: "project",
    name: "Research",
    description: "",
    instructions: "Old rule",
    background: "Old background",
    revision: 1,
    sources: [],
    membership_token: "a".repeat(64), conversation_count: 1,
    historical_copies: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  vi.mocked(api.getProjects).mockResolvedValue([p]);
  vi.mocked(api.getProject).mockResolvedValue(p);
  vi.mocked(api.saveProject).mockRejectedValue(
    new LocalServiceError({
      error: {
        code: "project_context_changed",
        message: "Project changed. Review your draft.",
        details: null,
        request_id: "local",
      },
    }),
  );
  const workspace = {
    connection: "ready",
    conversationView: undefined,
    isSending: false,
    isNavigating: false,
    draft: "Unsent question",
    attachmentDraft: { attachments: [], invalid: false },
    feedback: undefined,
  } as unknown as ChatWorkspace;
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProjectEditor
        value={p}
        close={vi.fn()}
        saved={vi.fn()}
        remove={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const background = screen.getByRole("textbox", {
    name: "Project background",
  });
  await user.clear(background);
  await user.type(background, "My edited project background");
  await user.click(screen.getByRole("button", { name: "Save project" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Project changed"),
  );
  expect((background as HTMLTextAreaElement).value).toBe(
    "My edited project background",
  );
  expect(workspace.draft).toBe("Unsent question");
  vi.mocked(api.getProject).mockResolvedValue({
    ...p,
    revision: 2,
    instructions: "Updated remote rule",
    background: "Updated remote background",
  });
  await user.click(
    screen.getByRole("button", { name: "Refresh revision and keep my edits" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "Project instructions",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Updated remote rule"),
  );
  expect((background as HTMLTextAreaElement).value).toBe(
    "My edited project background",
  );
  await user.click(screen.getByRole("button", { name: "Save project" }));
  await waitFor(() =>
    expect(api.saveProject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        revision: 2,
        instructions: "Updated remote rule",
        background: "My edited project background",
      }),
    ),
  );
});

test("reviewing current project input updates the admission revision without replacing the draft", async () => {
  const p: Project = {
    id: "project",
    name: "Research",
    description: "",
    instructions: "Rule",
    background: "Background",
    revision: 2,
    sources: [],
    membership_token: "a".repeat(64), conversation_count: 1,
    historical_copies: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  vi.mocked(api.getProjects).mockResolvedValue([p]);
  vi.mocked(api.getProject).mockResolvedValue(p);
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = {
    id: "conversation",
    project_id: p.id,
    project_revision: 1,
    membership_revision: 0,
    messages: [],
    generation_batches: [],
  };
  cache.setQueryData(conversationKeys.detail(view.id), view);
  const preview = {
    messages: [],
    project_context: null,
    expected_project: {
      project_id: p.id,
      project_revision: 2,
      membership_revision: 0,
    },
    usage: {
      instructions: 0,
      background: 0,
      sources: 0,
      history: 0,
      question: 0,
      total: 0,
      limit: 240000,
    },
  };
  vi.spyOn(transport, "previewGenerationContext").mockResolvedValue(preview);
  const showPreview = vi.fn();
  const workspace = {
    connection: "ready",
    conversationView: view,
    copy: { conversationActions: "Conversation actions" },
    draft: "Preserved draft",
    attachmentDraft: { attachments: [], invalid: false },
    setProjectContextPreview: showPreview,
  } as unknown as ChatWorkspace;
  render(
    <QueryClientProvider client={cache}>
      <ProjectControls workspace={workspace} />
    </QueryClientProvider>,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Review project context" }));
  await waitFor(() => expect(showPreview).toHaveBeenCalledWith(preview));
  expect(cache.getQueryData(conversationKeys.detail(view.id))).toMatchObject({
    project_id: p.id,
    project_revision: 2,
    membership_revision: 0,
  });
  expect(workspace.draft).toBe("Preserved draft");
  cache.clear();
});

const savedProject: Project = {
  id: "project",
  name: "Research",
  description: "",
  instructions: "",
  background: "",
  revision: 1,
  sources: [],
  membership_token: "a".repeat(64), conversation_count: 0,
  historical_copies: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderProjectDialogs(initial: Project | null) {
  const setProjectPage = vi.fn();
  function Harness() {
    const [projectEditor, setProjectEditor] = useState<
      Project | null | undefined
    >(initial);
    return (
      <ProjectDialogs
        workspace={
          {
            projectEditor,
            setProjectEditor,
            setProjectPage,
          } as unknown as ChatWorkspace
        }
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
  return { setProjectPage };
}

test("creating a project closes the dialog and opens its home", async () => {
  vi.mocked(api.saveProject).mockResolvedValue(savedProject);
  const { setProjectPage } = renderProjectDialogs(null);
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Project name" }),
    savedProject.name,
  );
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(setProjectPage).toHaveBeenCalledWith({ projectId: savedProject.id });
});

test("saving project edits closes the editor without changing the page", async () => {
  vi.mocked(api.saveProject).mockResolvedValue({
    ...savedProject,
    description: "Updated",
    revision: 2,
  });
  const { setProjectPage } = renderProjectDialogs(savedProject);
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Project description" }),
    "Updated",
  );
  await user.click(screen.getByRole("button", { name: "Save project" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(setProjectPage).not.toHaveBeenCalled();
});

test("removing a fixed source keeps the editor open with the saved revision", async () => {
  const project = {
    ...savedProject,
    sources: [
      {
        id: "source",
        blob_hash: "hash",
        snapshot: {
          id: "hash",
          name: "Notes.txt",
          media_type: "text/plain" as const,
          size: 5,
          characters: 5,
          extraction_version: "text-v1",
          sections: [{ id: "L1", text: "Notes" }],
        },
      },
    ],
  };
  vi.mocked(api.removeProjectSource).mockResolvedValue({
    ...savedProject,
    revision: 2,
  });
  renderProjectDialogs(project);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Remove from future turns" }));
  await waitFor(() =>
    expect(screen.queryByText("Notes.txt", { exact: false })).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: "Edit project" })).toBeTruthy();
  expect(screen.getByText(/Project materials · 0 \/ 3/)).toBeTruthy();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Project description" }),
    "Next edit",
  );
  vi.mocked(api.saveProject).mockResolvedValue({
    ...savedProject,
    revision: 3,
  });
  await user.click(screen.getByRole("button", { name: "Save project" }));
  await waitFor(() =>
    expect(api.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2 }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a changed project must be reviewed and explicitly confirmed again before deletion", async () => {
  vi.mocked(api.deleteProject)
    .mockRejectedValueOnce(
      new LocalServiceError({
        error: {
          code: "project_context_changed",
          message: "Project changed. Review its details.",
          details: null,
          request_id: "local",
        },
      }),
    )
    .mockResolvedValueOnce(undefined);
  vi.mocked(api.getProject).mockResolvedValue({
    ...savedProject,
    revision: 2,
    membership_token: "b".repeat(64), conversation_count: 3,
  });
  const removed = vi.fn().mockResolvedValue(undefined);
  render(
    <ProjectRemovalDialog
      project={savedProject}
      deleteConversations
      close={vi.fn()}
      beforeRemove={vi.fn().mockResolvedValue(undefined)}
      removed={removed}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await screen.findByRole("alert");
  expect(
    (
      screen.getByRole("button", {
        name: "Confirm deletion",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(
    screen.getByRole("button", { name: "Refresh project details" }),
  );
  await screen.findByText(/3 current conversations/);
  expect(api.deleteProject).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await waitFor(() =>
    expect(api.deleteProject).toHaveBeenLastCalledWith(
      savedProject.id,
      2,
      true,
      "b".repeat(64),
    ),
  );
  await waitFor(() => expect(removed).toHaveBeenCalledWith(true));
});

test("moving to the current project is disabled and conflicts require a fresh explicit move", async () => {
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"]) {
    if (Reflect.get(Element.prototype, name) !== undefined) continue;
    Object.defineProperty(Element.prototype, name, { configurable: true, value: name === "hasPointerCapture" ? () => false : () => {} });
    browserMethods.push(name);
  }
  vi.stubGlobal("ResizeObserver", class {observe() {} unobserve() {} disconnect() {}});
  const projectB = { ...savedProject, id: "project-b", name: "Project B" };
  vi.mocked(api.getProjects).mockResolvedValue([savedProject, projectB]);
  const target = {
    id: "chat",
    title: "Chat",
    project_id: savedProject.id,
    membership_revision: 1,
    created_at: savedProject.created_at,
    updated_at: savedProject.updated_at,
    messages: [],
  };
  const fresh = { ...target, project_id: projectB.id, membership_revision: 2 };
  vi.spyOn(transport, "getConversation").mockResolvedValue(fresh);
  vi.mocked(api.moveProjectConversation)
    .mockRejectedValueOnce(
      new LocalServiceError({
        error: {
          code: "project_context_changed",
          message: "Project context changed. Review your preserved draft.",
          details: null,
          request_id: "local",
        },
      }),
    )
    .mockResolvedValueOnce({
      ...fresh,
      project_id: savedProject.id,
      membership_revision: 3,
    });
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProjectDialogs
        workspace={
          {
            projectMoveTarget: target,
            setProjectMoveTarget: close,
          } as unknown as ChatWorkspace
        }
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText("Current project: Research");
  expect(
    (
      screen.getByRole("button", {
        name: "Move conversation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  async function choose(name: string) {
    await user.click(
      screen.getByRole("combobox", { name: "Move conversation to project" }),
    );
    await user.click(await screen.findByRole("option", { name }));
  }
  await choose(projectB.name);
  await user.click(screen.getByRole("button", { name: "Move conversation" }));
  const error = await screen.findByRole("alert");
  expect(error.textContent).not.toContain("draft");
  expect(
    (
      screen.getByRole("button", {
        name: "Move conversation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(
    screen.getByRole("button", { name: "Refresh current project" }),
  );
  await screen.findByText("Current project: Project B");
  expect(api.moveProjectConversation).toHaveBeenCalledTimes(1);
  expect(
    (
      screen.getByRole("button", {
        name: "Move conversation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await choose(savedProject.name);
  await user.click(screen.getByRole("button", { name: "Move conversation" }));
  await waitFor(() =>
    expect(api.moveProjectConversation).toHaveBeenLastCalledWith(
      target.id,
      savedProject.id,
      2,
    ),
  );
  await waitFor(() => expect(close).toHaveBeenCalledWith(undefined));
});

test("source requests lock project text until they settle", async () => {
 let reject!: (error: Error) => void;
 vi.mocked(api.addProjectSource).mockReturnValue(new Promise((_, r) => {reject = r;}));
 const saved = vi.fn();
 render(<ProjectEditor value={savedProject} close={vi.fn()} saved={saved} remove={vi.fn()} />);
 const user = userEvent.setup();
 await user.upload(screen.getByLabelText("Choose fixed project file"),new File(["Fixture"],"fixture.txt",{type:"text/plain"}));
 await waitFor(()=>expect(api.addProjectSource).toHaveBeenCalledOnce());
 for (const label of ["Project name","Project description","Project instructions","Project background"]) {
  expect((screen.getByRole("textbox",{name:label}) as HTMLInputElement).disabled).toBe(true);
 }
 reject(new Error("Source request failed"));
 await screen.findByRole("alert");
 expect((screen.getByRole("textbox",{name:"Project background"}) as HTMLTextAreaElement).disabled).toBe(false);
 expect(saved).not.toHaveBeenCalled();
});

test("a failed move response reconciles membership that already committed", async()=>{
 for(const name of ["hasPointerCapture","setPointerCapture","releasePointerCapture","scrollIntoView"]){
  if(Reflect.get(Element.prototype,name)!==undefined)continue;
  Object.defineProperty(Element.prototype,name,{configurable:true,value:name==="hasPointerCapture"?()=>false:()=>{}});
  browserMethods.push(name);
 }
 vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
 const target={id:"moved-chat",title:"Moved chat",project_id:savedProject.id,membership_revision:1,created_at:savedProject.created_at,updated_at:savedProject.updated_at,messages:[]};
 const latest={...target,project_id:undefined,membership_revision:2};
 vi.mocked(api.getProjects).mockResolvedValue([savedProject]);
 vi.mocked(api.moveProjectConversation).mockRejectedValue(new Error("Response read failed"));
 vi.spyOn(transport,"getConversation").mockResolvedValue(latest);
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 cache.setQueryData(conversationKeys.detail(target.id),target);
 render(<QueryClientProvider client={cache}><ProjectDialogs workspace={{projectMoveTarget:target,setProjectMoveTarget:vi.fn()} as unknown as ChatWorkspace}/></QueryClientProvider>);
 const user=userEvent.setup();
 await screen.findByText("Current project: Research");
 await user.click(screen.getByRole("combobox",{name:"Move conversation to project"}));
 await user.click(await screen.findByRole("option",{name:"No project"}));
 await user.click(screen.getByRole("button",{name:"Move conversation"}));
 await screen.findByRole("alert");
 expect(cache.getQueryData(conversationKeys.detail(target.id))).toMatchObject({membership_revision:2});
 expect(screen.getByText("Current project: No project")).toBeTruthy();
 expect((screen.getByRole("button",{name:"Move conversation"}) as HTMLButtonElement).disabled).toBe(true);
 cache.clear();
});


test("project material usage changes keep the editor open and submit the reviewed revision",async()=>{
 const project:Project={...savedProject,sources:[{id:"source",blob_hash:"hash",usage:"always",snapshot:{id:"hash",name:"Search.txt",media_type:"text/plain",size:5,characters:5,extraction_version:"text-v1",sections:[{id:"L1",text:"Notes"}]}}]};
 vi.mocked(api.setProjectSourceUsage).mockResolvedValue({...project,revision:project.revision+1,sources:[{...project.sources[0],usage:"search"}]});
 renderProjectDialogs(project);
 await userEvent.setup().selectOptions(screen.getByRole("combobox",{name:"Use Search.txt"}),"search");
 await waitFor(()=>expect(api.setProjectSourceUsage).toHaveBeenCalledWith(project.id,"source",project.revision,"search"));
 await waitFor(()=>expect(screen.getByRole<HTMLSelectElement>("combobox",{name:"Use Search.txt"}).value).toBe("search"));
 expect(screen.getByRole("dialog",{name:"Edit project"})).toBeTruthy();
});
