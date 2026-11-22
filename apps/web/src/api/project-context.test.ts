// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { renderHook, cleanup, act, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hydrateConversation } from "./conversations";
import { useGenerationCache, usePreviewGenerationContext } from "./hooks/useGenerations";
import { generationKeys, conversationKeys } from "./queryKeys";
import * as api from "@/api";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import type { ProjectContext } from "@cove/api-contract";

const project: ProjectContext = {
  project_id: "project",
  project_revision: 1,
  membership_revision: 0,
  project_name: "Saved project",
  rendering_version: 1,
  instructions: "Rule",
  background: "Facts",
  reference_prefix: "Saved prefix\n",
  sources: [],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("conversation hydration shares saved payloads across batches and rejects a missing reference", () => {
  const fixture = createWorkspaceFixture();
  const batches = [1, 2].map((n) => ({
    ...fixture.completedBatch,
    id: `batch-${n}`,
    project_context_id: "hash",
    project_context: undefined,
  }));
  const wire = {
    ...fixture.completedView,
    generation_batches: batches,
    active_generation_batch: batches[1],
    project_contexts: { hash: project },
  };
  const view = hydrateConversation(wire);
  expect(view.generation_batches?.[0]?.project_context).toBe(project);
  expect(view.generation_batches?.[1]?.project_context).toBe(project);
  expect(view.active_generation_batch?.project_context).toBe(project);
  expect(view).not.toHaveProperty("project_contexts");
  expect(() => hydrateConversation({ ...wire, project_contexts: {} })).toThrow(
    "saved project context",
  );
});
test("project-aware targets share one immutable query read independently of legacy context", async () => {
  const read = vi
    .spyOn(api, "getProjectBatchContext")
    .mockResolvedValue({ history: [], project_context: project });
  const legacy = vi
    .spyOn(api, "getGenerationBatchContext")
    .mockResolvedValue([]);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const { result } = renderHook(() => useGenerationCache(), {
    wrapper: ({ children }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  const [first, second] = await Promise.all([
    result.current.loadProjectContext("batch"),
    result.current.loadProjectContext("batch"),
  ]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(first).toBe(second);
  await result.current.loadProjectContext("batch");
  expect(read).toHaveBeenCalledTimes(1);
  await result.current.loadContext("batch");
  expect(legacy).toHaveBeenCalledTimes(1);
  client.removeQueries({ queryKey: generationKeys.all });
  await result.current.loadProjectContext("batch");
  expect(read).toHaveBeenCalledTimes(2);
  client.clear();
});

test.each(["membership", "project"])("a delayed preview cannot roll back a newer %s revision", async change => {
 const fixture = createWorkspaceFixture();
 let resolve!: (preview: import("@cove/api-contract").ProjectContextPreview) => void;
 vi.spyOn(api, "previewGenerationContext").mockReturnValue(new Promise(r => {resolve = r;}));
 const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view = {...fixture.completedView, project_id:"original", project_revision:1, membership_revision:1};
 client.setQueryData(conversationKeys.detail(view.id), view);
 const {result} = renderHook(() => usePreviewGenerationContext(), {wrapper:({children})=>createElement(QueryClientProvider,{client},children)});
 let pending!: Promise<unknown>;
 act(() => {pending = result.current.mutateAsync({conversationId:view.id,body:"Draft"});});
 await waitFor(()=>expect(api.previewGenerationContext).toHaveBeenCalled());
 const newer = {...view, project_id:change === "membership" ? "destination" : view.project_id,
   membership_revision:change === "membership" ? 2 : 1, project_revision:change === "project" ? 3 : 1};
 client.setQueryData(conversationKeys.detail(view.id),newer);
 await act(async()=>{resolve({messages:[],project_context:null,expected_project:{project_id:"original",project_revision:2,membership_revision:1},usage:{instructions:0,background:0,sources:0,history:0,question:0,total:0,limit:240000}});await pending;});
 expect(client.getQueryData(conversationKeys.detail(view.id))).toEqual(newer);
 client.clear();
});
