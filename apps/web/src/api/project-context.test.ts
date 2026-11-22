// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hydrateConversation } from "./conversations";
import { useGenerationCache } from "./hooks/useGenerations";
import { generationKeys } from "./queryKeys";
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
