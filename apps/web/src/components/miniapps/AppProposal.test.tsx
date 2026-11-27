// @vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MiniAppPackage } from "@cove/api-contract";
import { request } from "@/api/client";
import { AppProposal } from "./AppProposal";

vi.mock("@/api/client", () => ({ request: vi.fn() }));
vi.mock("@/api/hooks/useProviders", () => ({
  useProviders: () => ({ data: [{id:"local", name:"Local", kind:"local", endpoint:"http://worker", configured:true}], isSuccess:true }),
  providerCatalogQueryOptions: (id:string) => ({queryKey:["models",id], enabled:!!id, queryFn:async()=>({models:["model-1"]})}),
}));
afterEach(()=>{cleanup();vi.resetAllMocks();});

test("sends only chosen action names and opens a suggestion for editing on request",async()=>{
  const pkg:MiniAppPackage={format:1,publisher:"author",app:"notes",name:"Notes",description:"Notes",schema_version:1,version:"1.0.0",capabilities:["records.commit"],collections:{},pages:[],actions:{
    add:{title:"Add note",op:"create",inputs:{text:"text"},surfaces:["panel"]},
    save:{title:"Save bookmark",op:"create",inputs:{url:"text"},surfaces:["panel"]},
  }};
  const choose=vi.fn();
  const user=userEvent.setup();
  const endpoint="/api/mini-apps/instances/book/proposals";
  vi.mocked(request).mockImplementation(async(path,options)=>{
    if(path===endpoint+"?surface=panel") return null;
    if(path===endpoint && options?.method==="POST"){
      expect(JSON.parse(options.body as string)).toMatchObject({actions:["add"],question:"Save tea",surface:"panel",modelId:"model-1",localOnly:true});
      return {id:"job",state:"running"};
    }
    if(path===endpoint+"/job") return {id:"job",state:"completed",result:JSON.stringify({action:"add",inputs:{text:"tea"}})};
    throw new Error("unexpected request: "+path);
  });
  render(<QueryClientProvider client={new QueryClient()}><AppProposal instance={{id:"book",release_id:"r",enabled:true,revision:1,grants:["records.commit"],name:"Notes"}} pkg={pkg} actions={["add","save"]} surface="panel" localRequired={true} choose={choose}/></QueryClientProvider>);
  await user.click(screen.getByRole("button",{name:"Ask a model to propose an action"}));
  await user.click(screen.getByLabelText("Add note"));
  await user.type(screen.getByLabelText("What would you like to do?"),"Save tea");
  await user.selectOptions(screen.getByLabelText("Model provider"),"local");
  await screen.findByRole("option",{name:"model-1"});
  await user.selectOptions(screen.getByLabelText("Model",{exact:true}),"model-1");
  await user.click(screen.getByRole("button",{name:"Request suggestion"}));
  const edit=await screen.findByRole("button",{name:"Review suggested action"});
  expect(choose).not.toHaveBeenCalled();
  await user.click(edit);
  expect(choose).toHaveBeenCalledWith("add",{text:"tea"});
});
