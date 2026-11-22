import { createLocalServiceQueryClient } from "@/api/queryClient";
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";

let client: QueryClient | undefined;

afterEach(async () => {
  await client?.cancelQueries();
  onlineManager.setOnline(true);
  await client?.resumePausedMutations();
  client?.clear();
});

test("Local Service reads start while the browser reports no internet", async () => {
  onlineManager.setOnline(false);
  client = createLocalServiceQueryClient();
  const read = vi.fn().mockResolvedValue({ ready: true });
  const result = client.fetchQuery({ queryKey: ["session"], queryFn: read });
  void result.catch(() => undefined);

  await expect.poll(() => read.mock.calls.length).toBe(1);
  await expect(result).resolves.toEqual({ ready: true });
  expect(onlineManager.isOnline()).toBe(false);
});

test("Local Service send and stop commands execute immediately without internet", async () => {
  onlineManager.setOnline(false);
  client = createLocalServiceQueryClient();
  for (const command of ["send", "stop"]) {
    const run = vi.fn().mockResolvedValue(command);
    const mutation = client.getMutationCache().build(client, { mutationFn: run });
    const result = mutation.execute(undefined);

    await expect.poll(() => run.mock.calls.length).toBe(1);
    await expect(result).resolves.toBe(command);
    expect(mutation.state.isPaused).toBe(false);
  }
  expect(onlineManager.isOnline()).toBe(false);
});
