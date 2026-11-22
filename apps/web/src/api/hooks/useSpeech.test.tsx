// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import type { LocalModelStatus, SpeechConfiguration } from "@cove/api-contract";
import { useSpeechConfiguration } from "./useSpeech";
const mocks=vi.hoisted(()=>({statuses:[] as LocalModelStatus[]}));
vi.mock("./useLocalModels",()=>({useLocalModels:()=>({data:mocks.statuses})}));
vi.mock("@/api/speech",()=>({getSpeechConfiguration:async()=>({settings:{mode:"auto"},models:[{id:"fixture",installed:false,runtime_ready:true}]} as SpeechConfiguration)}));
afterEach(cleanup);
test("an installation finishing in the background updates speech availability",async()=>{
 mocks.statuses=[{id:"fixture",state:"downloading",runtime_ready:true} as LocalModelStatus];
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const {result,rerender}=renderHook(()=>useSpeechConfiguration(),{wrapper:({children})=><QueryClientProvider client={cache}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(result.current.data?.models[0].installed).toBe(false));
 mocks.statuses=[{...mocks.statuses[0],state:"installed"}];rerender();
 expect(result.current.data?.models[0].installed).toBe(true);
 mocks.statuses=[{...mocks.statuses[0],state:"not_installed"}];rerender();
 expect(result.current.data?.models[0].installed).toBe(false);
});
