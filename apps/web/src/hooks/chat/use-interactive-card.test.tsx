// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CardRun } from "@cove/api-contract";
import { useInteractiveCard } from "./use-interactive-card";
import * as api from "@/api/interactive";
vi.mock("@/api/interactive", () => ({
  loadInteractiveCard: vi.fn(),
  saveInteractiveCard: vi.fn(),
}));
afterEach(cleanup);
test("an older in-flight refetch must not overwrite an acknowledged card edit", async () => {
  const old = {
    generation_id: "review-probe",
    values: { choice: "" },
    checks: {},
    revision: 0,
    can_continue: true,
    definition: {} as CardRun["definition"],
  };
  const saved = { ...old, revision: 1, values: { choice: "edited" } };
  let resolveOld!: (run: CardRun) => void;
  vi.mocked(api.loadInteractiveCard)
    .mockResolvedValueOnce(old)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
  vi.mocked(api.saveInteractiveCard).mockResolvedValue(saved);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useInteractiveCard("review-probe"), {
    wrapper,
  });
  await waitFor(() => expect(result.current.draft?.values.choice).toBe(""));
  let refetch!: Promise<void>;
  act(() => {
    refetch = client.refetchQueries({
      queryKey: ["interactive-card", "review-probe"],
    });
  });
  await waitFor(() => expect(api.loadInteractiveCard).toHaveBeenCalledTimes(2));
  act(() => result.current.edit({ choice: "edited" }, {}));
  await waitFor(() => expect(result.current.run?.revision).toBe(1));
  await act(async () => {
    resolveOld(old);
    await refetch;
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(result.current.draft?.values.choice).toBe("edited");
  expect(result.current.run?.revision).toBe(1);
  vi.mocked(api.loadInteractiveCard).mockResolvedValueOnce(old);
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["interactive-card", "review-probe"],
    });
  });
  expect(
    client.getQueryData<CardRun>(["interactive-card", "review-probe"])
      ?.revision,
  ).toBe(1);
});
