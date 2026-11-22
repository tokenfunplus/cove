// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import type { SpeechConfiguration } from "@cove/api-contract";
import { SpeechSettingsPanel } from "./SpeechSettingsPanel";
import { saveSpeechSettings } from "@/api/speech";
const mocks=vi.hoisted(()=>({preview:vi.fn(),stop:vi.fn()}));
const configuration:SpeechConfiguration={settings:{mode:"auto",model_id:"",english_model_id:"",chinese_model_id:"",include_code:false,volume:.9,threads:2,profiles:{"english":{voice_id:"heart",speed:1,noise_scale:.667,temperature:.3},"chinese":{voice_id:"mandarin",speed:1,noise_scale:.667,temperature:.3}}},models:[{id:"english",name:"English voice",engine:"kokoro",languages:["en"],default_voice:"heart",installed:true,runtime_ready:true,voices:[{id:"heart",name:"Heart",speaker:0,language:"en"},{id:"bella",name:"Bella",speaker:1,language:"en"}]},{id:"chinese",name:"Chinese voice",engine:"melo",languages:["zh","en"],default_voice:"mandarin",installed:false,runtime_ready:true,voices:[{id:"mandarin",name:"Mandarin",speaker:0,language:"zh"}]}]};
vi.mock("@/api/hooks/useSpeech",()=>({useSpeechConfiguration:()=>({data:configuration,isLoading:false,isError:false})}));
vi.mock("@/api/speech",()=>({saveSpeechSettings:vi.fn()}));
vi.mock("@/components/chat/LocalSpeech",()=>({useLocalSpeech:()=>mocks,SpeechPlaybackControls:()=>null}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function renderSettings(onDiscover=vi.fn(),initialModelId?:string){render(<QueryClientProvider client={new QueryClient()}><SpeechSettingsPanel onDiscover={onDiscover} initialModelId={initialModelId}/></QueryClientProvider>);}
test("voice preview uses unsaved voice options and saving preserves the other model profile",async()=>{
 const user=userEvent.setup();vi.mocked(saveSpeechSettings).mockImplementation(async settings=>({...configuration,settings}));renderSettings();await user.selectOptions(screen.getByRole("combobox",{name:"Speech voice"}),"bella");await user.click(screen.getByRole("button",{name:"Preview voice"}));expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({model_id:"english",profile:expect.objectContaining({voice_id:"bella"})}));
 await user.selectOptions(screen.getByRole("combobox",{name:"Chinese reading model"}),"chinese");await user.click(screen.getByRole("button",{name:"Save speech settings"}));await waitFor(()=>expect(saveSpeechSettings).toHaveBeenCalledOnce());expect(vi.mocked(saveSpeechSettings).mock.calls[0][0]).toEqual(expect.objectContaining({chinese_model_id:"chinese",profiles:{english:expect.objectContaining({voice_id:"bella"}),chinese:expect.objectContaining({voice_id:"mandarin"})}}));expect(mocks.stop).toHaveBeenCalled();
});
test("an uninstalled model opens discovery and disables synthesis",async()=>{
 const user=userEvent.setup(),onDiscover=vi.fn();renderSettings(onDiscover,"chinese");expect((screen.getByRole("button",{name:"Preview voice"}) as HTMLButtonElement).disabled).toBe(true);await user.click(screen.getByRole("button",{name:"Find this model in Discover"}));expect(onDiscover).toHaveBeenCalledOnce();expect(mocks.preview).not.toHaveBeenCalled();
});
