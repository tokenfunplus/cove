// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AttachmentSnapshot } from "@cove/api-contract";
import * as api from "@/api";
import { useAttachmentDraft } from "./use-attachment-draft";

const preview = vi.hoisted(() => vi.fn());
vi.mock("@/api/hooks/useGenerations", () => ({ usePreviewAttachment: () => ({ mutateAsync: preview }) }));
vi.mock("@/api", async importOriginal => ({ ...await importOriginal<typeof import("@/api")>(), prepareWebSource: vi.fn(), releaseWebSource: vi.fn() }));
const snapshot: AttachmentSnapshot = { id: "a".repeat(64), name: "Evidence", media_type: "text/plain", extraction_version: "v1", characters: 8, size: 8, sections: [{ id: "L1", text: "Evidence" }] };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

test("local-only preparation rejects retained webpage callbacks without a request",async()=>{
  const {result,rerender}=renderHook(({local})=>useAttachmentDraft("chat",local),{initialProps:{local:false}});
  const retained=result.current.addWebSource;
  rerender({local:true});
  await act(()=>retained("https://example.com"));
  expect(api.prepareWebSource).not.toHaveBeenCalled();
  expect(result.current.attachments).toEqual([]);
  expect(result.current.selectionError).toContain("Only on this Mac");
});

test("enabling local-only preparation aborts a pending webpage and rejects a late token",async()=>{
  let complete!:(source:{source_token:string;snapshot:AttachmentSnapshot})=>void;
  vi.mocked(api.prepareWebSource).mockReturnValue(new Promise(resolve=>{complete=resolve;}));
  vi.mocked(api.releaseWebSource).mockResolvedValue(undefined);
  const {result,rerender}=renderHook(({local})=>useAttachmentDraft("chat",local),{initialProps:{local:false}});
  let pending!:Promise<void>;
  act(()=>{pending=result.current.addWebSource("https://example.com");});
  rerender({local:true});
  expect(vi.mocked(api.prepareWebSource).mock.calls[0][1].aborted).toBe(true);
  await act(async()=>{complete({source_token:"late-web-token",snapshot});await pending;});
  expect(result.current.attachments[0].webSourceToken).toBeUndefined();
  expect(result.current.attachments[0].error).toContain("Only on this Mac");
  expect(api.releaseWebSource).toHaveBeenCalledWith("late-web-token");
});

test("a source callback retained by the previous conversation cannot modify the new draft", () => {
  vi.mocked(api.releaseWebSource).mockResolvedValue(undefined);
  const {result,rerender} = renderHook(({id}) => useAttachmentDraft(id), {initialProps:{id:"chat-one"}});
  const previousDraft = result.current.addRetrievedSources;
  rerender({id:"chat-two"});
  act(() => expect(previousDraft([{source_token:"old-chat-source",snapshot}])).toBe(false));
  expect(result.current.attachments).toEqual([]);
  expect(result.current.selectionError).toBeUndefined();
  expect(api.releaseWebSource).toHaveBeenCalledWith("old-chat-source");
});

test("retrieved sections retain their source token and reject a duplicate draft source",()=>{
  vi.mocked(api.releaseWebSource).mockResolvedValue(undefined);
  const {result}=renderHook(()=>useAttachmentDraft("chat-1"));
  const local={...snapshot,retrieval:{model_id:"bge-small-zh",model_sha256:"b".repeat(64),index_version:"fixture"}};
  act(()=>{expect(result.current.addRetrievedSources([{source_token:"local-source",snapshot:local}])).toBe(true);});
  expect(result.current.attachments[0].snapshot?.retrieval?.model_id).toBe("bge-small-zh");
  act(()=>{expect(result.current.addRetrievedSources([{source_token:"duplicate",snapshot:local}])).toBe(false);});
  expect(api.releaseWebSource).toHaveBeenCalledWith("duplicate");expect(result.current.attachments).toHaveLength(1);
});

test("prepared webpages expire visibly and restored submissions cannot reuse expired tokens", async () => {
  vi.useFakeTimers();
  vi.mocked(api.releaseWebSource).mockResolvedValue(undefined);
  vi.mocked(api.prepareWebSource).mockResolvedValue({ source_token: "synthetic-token", snapshot, expires_at: new Date(Date.now() + 60_000).toISOString() });
  const { result } = renderHook(() => useAttachmentDraft("chat-1"));
  await act(() => result.current.addWebSource("https://example.com"));
  expect(result.current.invalid).toBe(false);
  const original = result.current.attachments;
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current.invalid).toBe(true);
  expect(result.current.attachments[0].error).toContain("Remove it and read the webpage again");
  act(() => result.current.clearAttachments(false));
  act(() => result.current.restoreAttachments(original));
  expect(result.current.invalid).toBe(true);
  act(() => result.current.removeAttachment(original[0].key));
  expect(result.current.invalid).toBe(false);
  expect(result.current.attachments).toEqual([]);
});

test("submission rechecks expiry when background timers have not run, while file previews remain valid", async () => {
  vi.useFakeTimers();
  vi.mocked(api.releaseWebSource).mockResolvedValue(undefined);
  const { result } = renderHook(() => useAttachmentDraft("chat-1"));
  const expiresAt = Date.now() + 60_000;
  act(() => result.current.restoreAttachments([
    { key: "file", name: "notes.txt", snapshot, input: { name: "notes.txt", data: "RXZpZGVuY2U=" } },
    { key: "web", name: "Page", snapshot, webSourceToken: "synthetic-token", expiresAt },
  ]));
  vi.setSystemTime(expiresAt);
  act(() => { expect(result.current.validateAttachments()).toBe(false); });
  expect(result.current.attachments[0].error).toBeUndefined();
  expect(result.current.attachments[1].error).toContain("expired");
  act(() => result.current.removeAttachment("web"));
  expect(result.current.validateAttachments()).toBe(true);
  expect(result.current.attachments[0].input?.name).toBe("notes.txt");
});

 test("a retained retrieval callback checks the file snapshot that finished afterward",async()=>{
  let finish!:(value:AttachmentSnapshot)=>void;preview.mockReturnValue(new Promise(resolve=>{finish=resolve;}));vi.mocked(api.releaseWebSource).mockResolvedValue(undefined);
  const {result}=renderHook(()=>useAttachmentDraft("chat"));let pending!:Promise<void>;
  act(()=>{pending=result.current.addAttachments([new File(["Evidence"],"notes.txt")]);});
  await waitFor(()=>expect(preview).toHaveBeenCalled());const retained=result.current.addRetrievedSources;
  await act(async()=>{finish(snapshot);await pending;});
  act(()=>{expect(retained([{source_token:"retrieved-duplicate",snapshot}])).toBe(false);});
  expect(result.current.attachments).toHaveLength(1);expect(result.current.attachments[0].input).toBeTruthy();expect(api.releaseWebSource).toHaveBeenCalledWith("retrieved-duplicate");
 });
