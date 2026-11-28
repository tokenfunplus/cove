// @vitest-environment jsdom

import {afterEach, expect, test, vi} from "vitest";
import {act, cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import type {LocalDocument, MiniAppInstance} from "@cove/api-contract";
import {getLocalDocuments} from "@/api/local-models";
import {fetchLocalService, request} from "@/api/client";
import {AppProcessing, LocalReading} from "./AppProcessing";

vi.mock("@/api/local-models",()=>({getLocalDocuments:vi.fn()}));
vi.mock("@/api/client",()=>({request:vi.fn(),fetchLocalService:vi.fn()}));

afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
const base:MiniAppInstance={id:"book",name:"Book",enabled:true,release_id:"v1",revision:1,grants:[]};

function panel(grants:string[],select=vi.fn()) {
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const view=render(<QueryClientProvider client={cache}>
    <AppProcessing instance={{...base,grants}} text="A passage." onSelect={select}/>
  </QueryClientProvider>);
  return {...view,cache};
}

test("only selected library documents reach the search, and a chosen excerpt enters the field",async()=>{
  vi.mocked(getLocalDocuments).mockResolvedValue([{name:"Notes.txt",id:"notes"},{name:"Journal.txt",id:"journal"}] as LocalDocument[]);
  vi.mocked(request).mockResolvedValue({hits:[{document_id:"notes",ordinal:0,text:"Selected section"}]});
  const choose=vi.fn();panel(["documents.search"],choose);const user=userEvent.setup();
  expect(getLocalDocuments).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Find a document excerpt"}));
  await user.click(await screen.findByRole("checkbox",{name:"Notes.txt"}));
  await user.type(screen.getByRole("textbox"),"Search");
  await user.click(screen.getByRole("button",{name:"Search"}));
  await screen.findByText("Selected section");
  expect(request).toHaveBeenCalledWith("/api/mini-apps/instances/book/documents/search",expect.objectContaining({
    body:JSON.stringify({document_ids:["notes"],query:"Search"}),
  }));
  expect(choose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Use this excerpt"}));
  expect(choose).toHaveBeenCalledWith("Selected section");
});

test("closing a field while a reading starts releases its instance-owned job",async()=>{
  let finish!:(value:unknown)=>void;
  vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(undefined);
  const view=panel(["speech.speak"]);const user=userEvent.setup();
  await user.click(screen.getByRole("button",{name:"Read this text aloud"}));view.unmount();
  await act(async()=>finish({id:"pending",state:"preparing"}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith("/api/mini-apps/instances/book/speech/pending",{method:"DELETE",keepalive:true}));
});

test("Japanese kana uses an instance-owned Japanese voice only after a click",async()=>{
  vi.mocked(request).mockRejectedValue(new Error("No installed macOS Japanese voice is available for local playback."));
  const cache=new QueryClient();
  render(<QueryClientProvider client={cache}>
    <AppProcessing instance={{...base,grants:["speech.speak"]}} text={"\u306d\u3053"} onSelect={vi.fn()}/>
  </QueryClientProvider>);
  expect(request).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button",{name:"Read in Japanese"}));
  expect(request).toHaveBeenCalledWith("/api/mini-apps/instances/book/speech",expect.objectContaining({body:JSON.stringify({text:"\u306d\u3053",language:"ja"})}));
  await screen.findByText(/No installed macOS Japanese voice/);
});

test("a library refresh removes deleted and reindexing documents from the selection and request", async () => {
  const documents = ["one", "two", "three", "four", "five"].map((id) => ({ id, name: `${id}.txt` })) as LocalDocument[];
  vi.mocked(getLocalDocuments).mockResolvedValue(documents);
  vi.mocked(request).mockResolvedValue({ hits: [] });
  const { cache } = panel(["documents.search"]);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Find a document excerpt" }));
  for (const document of documents.slice(0, 4)) {
    await user.click(await screen.findByRole("checkbox", { name: document.name }));
  }
  expect((screen.getByRole("checkbox", { name: "five.txt" }) as HTMLInputElement).disabled).toBe(true);
  act(() => {
    cache.setQueryData(["mini-app-document-picker", "/api/mini-apps/instances/book"], [
      { ...documents[1], needs_reindex: true }, ...documents.slice(2),
    ]);
  });
  await waitFor(() => expect(screen.queryByRole("checkbox", { name: "one.txt" })).toBeNull());
  expect((screen.getByRole("checkbox", { name: "two.txt (reindex required)" }) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole("checkbox", { name: "five.txt" }));
  await user.type(screen.getByRole("textbox"), "Find");
  await user.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("/api/mini-apps/instances/book/documents/search", expect.objectContaining({
    body: JSON.stringify({ document_ids: ["three", "four", "five"], query: "Find" }),
  })));
});

test.each(["text", "language"])("changing reading %s deletes a late job without displaying it", async (change) => {
  let complete!: (value: unknown) => void;
  vi.mocked(request).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; })).mockResolvedValue(undefined);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = (text: string, language?: "ja") => <QueryClientProvider client={cache}>
    <LocalReading path="/api/mini-apps/instances/book/speech" text={text} language={language} />
  </QueryClientProvider>;
  const { rerender } = render(view("Original passage"));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Read this text aloud" }));
  rerender(view(change === "text" ? "Replacement passage" : "Original passage", change === "language" ? "ja" : undefined));
  expect(screen.getByRole("button", { name: change === "language" ? "Read in Japanese" : "Read this text aloud" })).toBeTruthy();
  await act(async () => { complete({ id: "old-reading", state: "preparing" }); });
  await waitFor(() => expect(request).toHaveBeenCalledWith("/api/mini-apps/instances/book/speech/old-reading", { method: "DELETE", keepalive: true }));
  expect(screen.queryByRole("button", { name: "Close reading" })).toBeNull();
});

test("editing text closes a loaded reading, releases its job, and revokes its audio URL", async () => {
  const create = vi.fn(() => "blob:reading");
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  });
  const job = { id: "reading", state: "completed", volume: 1, playback_rate: 1 };
  vi.mocked(request).mockResolvedValue(job);
  vi.mocked(fetchLocalService).mockResolvedValue({ ok: true, blob: async () => new Blob(["audio"]) } as Response);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = (text: string) => <QueryClientProvider client={cache}>
    <LocalReading path="/api/mini-apps/instances/book/speech" text={text} />
  </QueryClientProvider>;
  const { rerender } = render(view("Original passage"));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Read this text aloud" }));
  await screen.findByLabelText("Local reading");
  rerender(view("Original passage"));
  expect(revoke).not.toHaveBeenCalled();
  rerender(view("New passage"));
  expect(screen.queryByLabelText("Local reading")).toBeNull();
  expect(screen.getByRole("button", { name: "Read this text aloud" })).toBeTruthy();
  await waitFor(() => expect(request).toHaveBeenCalledWith("/api/mini-apps/instances/book/speech/reading", { method: "DELETE", keepalive: true }));
  expect(revoke).toHaveBeenCalledWith("blob:reading");
});
