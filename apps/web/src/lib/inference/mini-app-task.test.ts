import { afterEach, expect, test, vi } from "vitest";
import type { SecureInferenceTransport } from "./secure-inference";
import { request } from "@/api/client";
import { runVerifiedAppTask } from "./mini-app-task";

vi.mock("@/api/client",()=>({request:vi.fn()}));
afterEach(()=>vi.resetAllMocks());

function claim() {
  return {snapshot:{provider_id:"nearai",provider_kind:"nearai",privacy_mode:"private_tee",model_id:"fixture-model"},prompt:"Frozen example passage"};
}
test("app verification claims the authorized prompt, exposes no interim answer and settles the SDK receipt",async()=>{
  vi.mocked(request).mockImplementation(async path=>path.endsWith("/claim") ? claim() : undefined);
  const generate=vi.fn<SecureInferenceTransport["generate"]>(async function*(){
    yield {type:"streaming"};
    yield {type:"delta",delta:"Candidate output"};
    yield {type:"response_ready",completionId:"fixture"};
    yield {type:"completed",verification:{status:"verified_model",completionId:"fixture",signingKind:"provider_tee",signingAddress:"signer",signingAlgorithm:"ed25519",signature:"example"}};
  });
  await runVerifiedAppTask("book","task",new AbortController().signal,async()=>({generate}));
  expect(generate).toHaveBeenCalledOnce();
  expect(generate.mock.calls[0]?.[0]).toMatchObject({context:[],message:claim().prompt,mode:"private_tee",target:{model_id:"fixture-model"}});
  const steps=vi.mocked(request).mock.calls.map(([path,init])=>({path,data:JSON.parse(init!.body as string)}));
  expect(steps.every(step=>step.path.startsWith("/api/mini-apps/instances/book/tasks/task/browser/"))).toBe(true);
  expect(new Set(steps.map(step=>step.data.claim_id)).size).toBe(1);
  for(const step of steps.filter(step=>step.path.endsWith("/progress")))expect(step.data).not.toHaveProperty("body");
  expect(steps.at(-1)?.data).toMatchObject({body:"Candidate output",verification:{status:"verified_model",completion_id:"fixture"}});
});
test("a rejected app claim never opens model transport",async()=>{
  vi.mocked(request).mockRejectedValueOnce(new Error("Already claimed"));
  const load=vi.fn();
  await expect(runVerifiedAppTask("book","task",new AbortController().signal,load)).rejects.toThrow("Already claimed");
  expect(load).not.toHaveBeenCalled();
});
