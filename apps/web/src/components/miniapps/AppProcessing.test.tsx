// @vitest-environment jsdom

import {afterEach, expect, test, vi} from "vitest";
import {act, cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import type {LocalDocument, MiniAppInstance} from "@cove/api-contract";
import {getLocalDocuments} from "@/api/local-models";
import {request} from "@/api/client";
import {AppProcessing} from "./AppProcessing";

vi.mock("@/api/local-models",()=>({getLocalDocuments:vi.fn()}));
vi.mock("@/api/client",()=>({request:vi.fn()}));

afterEach(()=>{cleanup();vi.resetAllMocks();});
const base:MiniAppInstance={id:"book",name:"Book",enabled:true,release_id:"v1",revision:1,grants:[]};

function panel(grants:string[],select=vi.fn()) {
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  return render(<QueryClientProvider client={cache}>
    <AppProcessing instance={{...base,grants}} text="A passage." onSelect={select}/>
  </QueryClientProvider>);
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
