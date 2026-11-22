// @vitest-environment jsdom

import { clearChatData } from "@/api";
import { useClearChatData } from "@/api/hooks/useConversations";
import { localDocumentsKey, localModelKey } from "@/api/hooks/useLocalModels";
import { createLocalServiceQueryClient } from "@/api/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api")>(), clearChatData: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

test("clearing chat data also removes cached library names and cancels an older library read", async () => {
  const client = createLocalServiceQueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const oldLibrary = [{id:"fixture",name:"removed-private-document.txt"}];
  client.setQueryData(localDocumentsKey, oldLibrary);
  client.setQueryData(localModelKey, [{id:"qwen-small-chat",state:"installed"}]);
  let finish!: (value: typeof oldLibrary) => void;
  const staleRead = client.fetchQuery({queryKey:localDocumentsKey,queryFn:()=>new Promise(resolve=>{finish=resolve;})});
  void staleRead.catch(() => undefined);
  vi.mocked(clearChatData).mockResolvedValue(undefined);
  const hook = renderHook(() => useClearChatData(), {
    wrapper: ({children}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await act(async () => { await hook.result.current.mutateAsync(); });
  await act(async () => finish(oldLibrary));
  expect(client.getQueryData(localDocumentsKey)).toEqual([]);
  expect(client.getQueryData(localModelKey)).toEqual([{id:"qwen-small-chat",state:"installed"}]);
  client.clear();
});
