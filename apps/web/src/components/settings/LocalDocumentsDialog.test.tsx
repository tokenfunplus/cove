// @vitest-environment jsdom

import { setupControlTests } from "@/test/control-helpers";
setupControlTests();

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "@/api/local-models";
import { LocalDocumentsDialog } from "./LocalDocumentsDialog";
import type { AttachmentSnapshot } from "@cove/api-contract";
import { releaseWebSource } from "@/api";

vi.mock("@/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api")>(), releaseWebSource: vi.fn(),
}));

vi.mock("@/api/local-models",()=>({getLocalModels:vi.fn(),getLocalDocuments:vi.fn(),importLocalDocument:vi.fn(),removeLocalDocument:vi.fn(),reindexLocalDocument:vi.fn(),searchLocalDocuments:vi.fn(),prepareLocalSources:vi.fn()}));
const source:AttachmentSnapshot={id:"a".repeat(64),name:"guide.txt",media_type:"text/plain",size:50,characters:37,extraction_version:"cove-text-v1",sections:[{id:"L7",text:"The recovery copy lasts thirty days."}],retrieval:{model_id:"bge-small-zh",model_sha256:"c".repeat(64),index_version:"cove-rune320-v1"}};
afterEach(()=>{cleanup();vi.resetAllMocks();});

test("closing a pending source selection never writes into a later chat draft", async () => {
  vi.mocked(api.getLocalModels).mockResolvedValue([{id:"bge-small-zh",state:"installed",runtime_ready:true} as never]);
  vi.mocked(api.getLocalDocuments).mockResolvedValue([{id:source.id,name:source.name,characters:50,chunks:1}] as never);
  vi.mocked(api.searchLocalDocuments).mockResolvedValue({hits:[{document_id:source.id,ordinal:0,score:0.8,text:source.sections[0].text,source}],elapsed_ms:1,model_sha256:"c".repeat(64),index_version:"fixture"});
  let finish!: (value: {source_token:string;snapshot:AttachmentSnapshot}[]) => void;
  vi.mocked(api.prepareLocalSources).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  vi.mocked(releaseWebSource).mockResolvedValue(undefined);
  const onUseSources = vi.fn(() => true);
  const cache = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const view = render(<QueryClientProvider client={cache}><LocalDocumentsDialog onClose={()=>{}} onUseSources={onUseSources}/></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", {name:/guide.txt/}));
  await user.type(screen.getByRole("textbox", {name:"What are you looking for?"}), "recovery");
  await user.click(screen.getByRole("button", {name:"Search selected documents"}));
  await user.click(within(await screen.findByRole("article")).getByRole("checkbox"));
  await user.click(screen.getByRole("button", {name:"Use selected results in chat"}));
  expect(screen.getByRole<HTMLInputElement>("textbox", {name:"What are you looking for?"}).disabled).toBe(true);
  view.unmount();
  expect(vi.mocked(api.prepareLocalSources).mock.calls[0]?.[1]?.aborted).toBe(true);
  await act(async () => finish([{source_token:"late-source",snapshot:source}]));
  expect(onUseSources).not.toHaveBeenCalled();
  await waitFor(() => expect(releaseWebSource).toHaveBeenCalledWith("late-source"));
  cache.clear();
});

test("stopping a batch import does not start its remaining documents", async () => {
  vi.mocked(api.getLocalModels).mockResolvedValue([{id:"bge-small-zh",state:"installed",runtime_ready:true} as never]);
  vi.mocked(api.getLocalDocuments).mockResolvedValue([]);
  let finish!: () => void;
  vi.mocked(api.importLocalDocument).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const cache = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  render(<QueryClientProvider client={cache}><LocalDocumentsDialog onClose={()=>{}}/></QueryClientProvider>);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", {name:"Add documents"}).disabled).toBe(false));
  await user.upload(screen.getByLabelText("Choose local documents"), [new File(["First"], "first.txt"), new File(["Second"], "second.txt")]);
  await waitFor(() => expect(api.importLocalDocument).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", {name:"Stop"}));
  await act(async () => finish());
  expect(api.importLocalDocument).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.importLocalDocument).mock.calls[0]?.[1]?.aborted).toBe(true);
  cache.clear();
});

test("a multi-file library import does not silently discard the fifth document", async () => {
  vi.mocked(api.getLocalModels).mockResolvedValue([{id:"bge-small-zh",state:"installed",runtime_ready:true} as never]);
  vi.mocked(api.getLocalDocuments).mockResolvedValue([]);
  vi.mocked(api.importLocalDocument).mockResolvedValue(undefined);
  const cache = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  render(<QueryClientProvider client={cache}><LocalDocumentsDialog onClose={()=>{}}/></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", {name:"Add documents"}).disabled).toBe(false));
  const files = Array.from({length:5}, (_, index) => new File([`Document ${index}`], `file-${index}.txt`, {type:"text/plain"}));
  await userEvent.setup().upload(screen.getByLabelText("Choose local documents"), files);
  await waitFor(() => expect(api.importLocalDocument).toHaveBeenCalledTimes(5));
  cache.clear();
});

test("search sends only selected documents and prepares selected original source references",async()=>{
  vi.mocked(api.getLocalModels).mockResolvedValue([{id:"bge-small-zh",state:"installed",runtime_ready:true} as never]);
  vi.mocked(api.getLocalDocuments).mockResolvedValue([{id:source.id,name:"guide.txt",characters:50,chunks:2},{id:"b".repeat(64),name:"unselected.txt",characters:30,chunks:1}] as never);
  vi.mocked(api.searchLocalDocuments).mockResolvedValue({hits:[{document_id:source.id,ordinal:1,score:0.8,text:source.sections[0].text,source}],elapsed_ms:12,model_sha256:"c".repeat(64),index_version:"cove-rune320-v1"});
  const prepared={source_token:"fixture-local-source",snapshot:source};vi.mocked(api.prepareLocalSources).mockResolvedValue([prepared]);
  const useSources=vi.fn(()=>true);const close=vi.fn();const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});const user=userEvent.setup();
  render(<QueryClientProvider client={cache}><LocalDocumentsDialog onClose={close} onUseSources={useSources}/></QueryClientProvider>);
  await user.click(await screen.findByRole("checkbox",{name:/guide.txt/}));
  await user.type(screen.getByRole("textbox",{name:"What are you looking for?"}),"How long is the recovery copy kept?");
  await user.click(screen.getByRole("button",{name:"Search selected documents"}));
  const hit=await screen.findByRole("article");expect(api.searchLocalDocuments).toHaveBeenCalledWith([source.id],"How long is the recovery copy kept?",expect.any(AbortSignal),0);
  await user.click(within(hit).getByRole("checkbox"));await user.click(screen.getByRole("button",{name:"Use selected results in chat"}));
  expect(api.prepareLocalSources).toHaveBeenCalledWith([{document_id:source.id,ordinal:1}],expect.any(AbortSignal));
  expect(useSources).toHaveBeenCalledWith([prepared]);expect(close).toHaveBeenCalled();cache.clear();
});

test("library deletion asks for explicit confirmation before removing its local copy",async()=>{
  vi.mocked(api.getLocalModels).mockResolvedValue([]);vi.mocked(api.getLocalDocuments).mockResolvedValue([{id:source.id,name:"guide.txt",characters:50,chunks:2}] as never);vi.mocked(api.removeLocalDocument).mockResolvedValue(undefined);
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});const user=userEvent.setup();
  render(<QueryClientProvider client={cache}><LocalDocumentsDialog onClose={()=>{}}/></QueryClientProvider>);
  await user.click(await screen.findByRole("button",{name:"Delete document: guide.txt"}));expect(api.removeLocalDocument).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Delete library copy"}));expect(api.removeLocalDocument).toHaveBeenCalledWith(source.id,expect.any(AbortSignal));cache.clear();
});


test("a similarity cutoff is sent and empty results explain how to recover",async()=>{
 vi.mocked(api.getLocalModels).mockResolvedValue([{id:"bge-small-zh",state:"installed",runtime_ready:true} as never]);
 vi.mocked(api.getLocalDocuments).mockResolvedValue([{id:source.id,name:source.name,characters:50,chunks:1}] as never);
 vi.mocked(api.searchLocalDocuments).mockResolvedValue({hits:[],elapsed_ms:1,model_sha256:"fixture",index_version:"fixture"});
 const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 render(<QueryClientProvider client={cache}><LocalDocumentsDialog onClose={()=>{}}/></QueryClientProvider>);
 const user=userEvent.setup();await user.click(await screen.findByRole("checkbox",{name:/guide.txt/}));
 await user.type(screen.getByRole("textbox",{name:"What are you looking for?"}),"unrelated question");
 const slider=screen.getByRole("slider",{name:"Minimum similarity"});slider.focus();await user.keyboard("{End}");
 await user.click(screen.getByRole("button",{name:"Search selected documents"}));
 await screen.findByText(/No passages meet the current similarity filter/);
 expect(api.searchLocalDocuments).toHaveBeenCalledWith([source.id],"unrelated question",expect.any(AbortSignal),1);
});
