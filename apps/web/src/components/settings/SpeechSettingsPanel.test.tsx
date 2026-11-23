// @vitest-environment jsdom
import { setupControlTests, chooseOption } from "@/test/control-helpers";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import type { LocalModelStatus, SpeechConfiguration } from "@cove/api-contract";
import { LocalModelsPanel } from "./LocalModelsPanel";
import { SpeechSettingsPanel } from "./SpeechSettingsPanel";
import { saveSpeechSettings } from "@/api/speech";
const mocks=vi.hoisted(()=>({preview:vi.fn(),stop:vi.fn(),installed:[] as LocalModelStatus[]}));
let configuration:SpeechConfiguration={settings:{mode:"auto",model_id:"",english_model_id:"",chinese_model_id:"",include_code:false,volume:.9,threads:2,profiles:{"english":{voice_id:"heart",speed:1,noise_scale:.667,temperature:.3},"chinese":{voice_id:"mandarin",speed:1,noise_scale:.667,temperature:.3}}},models:[{id:"english",name:"English voice",engine:"kokoro",languages:["en"],default_voice:"heart",installed:true,runtime_ready:true,voices:[{id:"heart",name:"Heart",speaker:0,language:"en"},{id:"bella",name:"Bella",speaker:1,language:"en"}]},{id:"chinese",name:"Chinese voice",engine:"melo",languages:["zh","en"],default_voice:"mandarin",installed:false,runtime_ready:true,voices:[{id:"mandarin",name:"Mandarin",speaker:0,language:"zh"}]}]};
vi.mock("@/api/hooks/useSpeech",()=>({useSpeechConfiguration:()=>({data:configuration,isLoading:false,isError:false})}));
vi.mock("@/api/speech",()=>({saveSpeechSettings:vi.fn()}));
vi.mock("@/components/chat/LocalSpeech",()=>({useLocalSpeech:()=>mocks,SpeechPlaybackControls:()=>null}));
vi.mock("@/api/hooks/useLocalModels",()=>({useLocalModels:()=>({data:mocks.installed,isLoading:false,isError:false}),useLocalModelAction:()=>({mutate:vi.fn(),isPending:false})}));
setupControlTests();
afterEach(()=>{cleanup();vi.clearAllMocks();mocks.installed=[];});
function renderSettings(onDiscover=vi.fn(),initialModelId?:string){render(<QueryClientProvider client={new QueryClient()}><SpeechSettingsPanel onDiscover={onDiscover} initialModelId={initialModelId}/></QueryClientProvider>);}
test("voice preview uses unsaved voice options and saving preserves the other model profile",async()=>{
 const user=userEvent.setup();vi.mocked(saveSpeechSettings).mockImplementation(async settings=>({...configuration,settings}));renderSettings();await chooseOption(user,screen.getByRole("combobox",{name:"Speech voice"}),"Bella");await user.click(screen.getByRole("button",{name:"Preview voice"}));expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({model_id:"english",profile:expect.objectContaining({voice_id:"bella"})}));
 await chooseOption(user,screen.getByRole("combobox",{name:"Chinese reading model"}),"Chinese voice · Not installed");await user.click(screen.getByRole("button",{name:"Save speech settings"}));await waitFor(()=>expect(saveSpeechSettings).toHaveBeenCalledOnce());expect(vi.mocked(saveSpeechSettings).mock.calls[0][0]).toEqual(expect.objectContaining({chinese_model_id:"chinese",profiles:{english:expect.objectContaining({voice_id:"bella"}),chinese:expect.objectContaining({voice_id:"mandarin"})}}));expect(mocks.stop).toHaveBeenCalled();
});
test("an uninstalled model opens discovery and disables synthesis",async()=>{
 const user=userEvent.setup(),onDiscover=vi.fn();renderSettings(onDiscover,"chinese");expect((screen.getByRole("button",{name:"Preview voice"}) as HTMLButtonElement).disabled).toBe(true);await user.click(screen.getByRole("button",{name:"Find this model in Discover"}));expect(onDiscover).toHaveBeenCalledOnce();expect(mocks.preview).not.toHaveBeenCalled();
});

test("a long voice list can be searched before previewing an unsaved choice",async()=>{
 const original=configuration.models[0].voices;
 configuration.models[0].voices=[...original,...Array.from({length:13},(_,index)=>({id:`voice-${index}`,name:`Voice ${index}`,speaker:index+2,language:"en"}))];
 try {
  const user=userEvent.setup();renderSettings();
  const field=screen.getByRole("combobox",{name:"Speech voice"});
  await user.click(field);await user.clear(field);await user.type(field,"Voice 9");
  await user.click(await screen.findByRole("option",{name:"Voice 9"}));
  await user.click(screen.getByRole("button",{name:"Preview voice"}));
  expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({profile:expect.objectContaining({voice_id:"voice-9"})}));
 } finally { configuration.models[0].voices=original; }
});

 test("a settings refresh updates an untouched cached draft",async()=>{
  const original=configuration;const cache=new QueryClient();const element=()=> <QueryClientProvider client={cache}><SpeechSettingsPanel onDiscover={()=>{}}/></QueryClientProvider>;
  try{const rendered=render(element());await screen.findByRole("combobox",{name:"Speech CPU usage"});
   configuration={...configuration,settings:{...configuration.settings,threads:4}};rendered.rerender(element());
   await waitFor(()=>expect(screen.getByRole("combobox",{name:"Speech CPU usage"}).textContent).toContain("Faster"));expect(screen.getByRole<HTMLButtonElement>("button",{name:"Save speech settings"}).disabled).toBe(true);
  }finally{configuration=original;cache.clear();}
 });
 test("edits made during an in-flight save remain dirty afterward",async()=>{
  let finish!:(value:SpeechConfiguration)=>void;vi.mocked(saveSpeechSettings).mockReturnValue(new Promise(resolve=>{finish=resolve;}));const user=userEvent.setup();renderSettings();
  await chooseOption(user,screen.getByRole("combobox",{name:"Speech voice"}),"Bella");await user.click(screen.getByRole("button",{name:"Save speech settings"}));
  const submitted=structuredClone(vi.mocked(saveSpeechSettings).mock.calls[0][0]);await chooseOption(user,screen.getByRole("combobox",{name:"Speech CPU usage"}),"Faster · 4 threads");
  await act(async()=>finish({...configuration,settings:submitted}));await screen.findByText("Speech settings saved. Your newer changes are not saved yet.");
  expect(screen.getByRole("combobox",{name:"Speech CPU usage"}).textContent).toContain("Faster");expect(screen.getByRole<HTMLButtonElement>("button",{name:"Save speech settings"}).disabled).toBe(false);
 });


test("preview honors draft volume and CPU settings without saving",async()=>{
 const user=userEvent.setup();renderSettings();
 const volume=await screen.findByRole("slider",{name:"Speech volume"});volume.focus();await user.keyboard("{Home}");
 await chooseOption(user,screen.getByRole("combobox",{name:"Speech CPU usage"}),"Low · 1 thread");
 await user.click(screen.getByRole("button",{name:"Preview voice"}));
 expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({volume:0,threads:1}));
 expect(saveSpeechSettings).not.toHaveBeenCalled();
});
test("preview text can be cleared and then replaced",async()=>{
 const user=userEvent.setup();renderSettings();const field=await screen.findByRole<HTMLTextAreaElement>("textbox",{name:"Voice preview text"});
 await user.clear(field);expect(field.value).toBe("");expect(screen.getByRole<HTMLButtonElement>("button",{name:"Preview voice"}).disabled).toBe(true);
 await user.type(field,"A new sample");await user.click(screen.getByRole("button",{name:"Preview voice"}));
 expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({text:"A new sample"}));
});


test("switching local capability views preserves unsaved speech choices",async()=>{
 const user=userEvent.setup();render(<QueryClientProvider client={new QueryClient()}><LocalModelsPanel manage entry={{tab:"speech"}}/></QueryClientProvider>);
 await chooseOption(user,await screen.findByRole("combobox",{name:"Speech voice"}),"Bella");
 await user.click(screen.getByRole("button",{name:"Installed"}));
 expect(screen.queryByRole("combobox",{name:"Speech voice"})).toBeNull();
 await user.click(screen.getByRole("button",{name:"Speech"}));
 expect(screen.getByRole("combobox",{name:"Speech voice"}).textContent).toContain("Bella");
 expect(screen.getByRole<HTMLButtonElement>("button",{name:"Save speech settings"}).disabled).toBe(false);
 expect(saveSpeechSettings).not.toHaveBeenCalled();
});


test("repeated explicit model selection overrides the retained voice view without discarding drafts",async()=>{
 mocks.installed=[{id:"english",name:"English voice",role:"tts",state:"installed",runtime_ready:true} as LocalModelStatus];
 const user=userEvent.setup();render(<QueryClientProvider client={new QueryClient()}><LocalModelsPanel manage entry={{tab:"installed"}}/></QueryClientProvider>);
 await user.click(screen.getByRole("button",{name:"Speech settings"}));
 await chooseOption(user,await screen.findByRole("combobox",{name:"Speech voice"}),"Bella");
 await chooseOption(user,screen.getByRole("combobox",{name:"Voice options for"}),"Chinese voice · Not installed");
 await user.click(screen.getByRole("button",{name:"Installed"}));
 await user.click(screen.getByRole("button",{name:"Speech settings"}));
 expect(screen.getByRole("combobox",{name:"Voice options for"}).textContent).toContain("English voice");
 expect(screen.getByRole("combobox",{name:"Speech voice"}).textContent).toContain("Bella");
 expect(screen.getByRole<HTMLButtonElement>("button",{name:"Save speech settings"}).disabled).toBe(false);
 expect(saveSpeechSettings).not.toHaveBeenCalled();
});
