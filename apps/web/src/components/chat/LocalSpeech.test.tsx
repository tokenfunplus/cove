// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocalSpeechProvider, ReadAloudButton } from "./LocalSpeech";
import { LocalServiceError } from "@/api/client";
import * as api from "@/api/speech";
import type { SpeechJob } from "@cove/api-contract";
vi.mock("@/api/speech",()=>({readAnswer:vi.fn(),previewSpeech:vi.fn(),getSpeechJob:vi.fn(),stopSpeech:vi.fn(),speechAudio:vi.fn()}));
const job:SpeechJob={id:"fixture",state:"completed",model_id:"kokoro-en",model_name:"Kokoro English",voice_name:"Heart",language:"en",ready_chunks:1,total_chunks:1,characters:20,playback_rate:1,volume:.9};
const players:FakeAudio[]=[];
class FakeAudio {
 volume=1;playbackRate=1;defaultPlaybackRate=1;private source="";get src(){return this.source;}set src(value:string){this.source=value;this.playbackRate=this.defaultPlaybackRate;}onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
 play=vi.fn().mockResolvedValue(undefined);pause=vi.fn();load=vi.fn();removeAttribute=vi.fn();
 constructor(){players.push(this);}
}
beforeEach(()=>{vi.clearAllMocks();players.length=0;vi.stubGlobal("Audio",FakeAudio);vi.stubGlobal("URL",class extends URL{static createObjectURL=vi.fn(()=>"blob:fixture");static revokeObjectURL=vi.fn();});vi.mocked(api.stopSpeech).mockResolvedValue(undefined);vi.mocked(api.speechAudio).mockResolvedValue(new Blob(["wave"]));vi.mocked(api.getSpeechJob).mockResolvedValue(job);vi.mocked(api.readAnswer).mockResolvedValue({...job,state:"preparing",ready_chunks:0});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const source={messageId:"answer",conversationId:"chat",body:"A saved answer."};
function view(conversationId="chat",onDiscover=vi.fn()){return <LocalSpeechProvider conversationId={conversationId} onDiscover={onDiscover} onSettings={vi.fn()}><input aria-label="Unsent draft" defaultValue="Keep this draft"/><ReadAloudButton source={source}/></LocalSpeechProvider>;}
test("missing voice leads to Discover and preserves the draft",async()=>{
 const onDiscover=vi.fn();vi.mocked(api.readAnswer).mockRejectedValue(new LocalServiceError({error:{code:"speech_model_required",message:"Install a local voice.",details:null,request_id:"fixture"}}));
 const user=userEvent.setup();render(view("chat",onDiscover));await user.click(screen.getByRole("button",{name:"Read aloud on this Mac"}));await user.click(await screen.findByRole("button",{name:"Open Discover"}));
 expect(onDiscover).toHaveBeenCalledOnce();expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Keep this draft");expect(players).toHaveLength(0);
});
test("read aloud pauses, resumes, and stops local playback and releases audio",async()=>{
 const user=userEvent.setup();render(view());await user.click(screen.getByRole("button",{name:"Read aloud on this Mac"}));await screen.findByText("Reading on this Mac");
 expect(api.readAnswer).toHaveBeenCalledWith("chat","answer",undefined);expect(players[0].play).toHaveBeenCalledOnce();
 await user.click(screen.getByRole("button",{name:"Pause"}));expect(players[0].pause).toHaveBeenCalled();await user.click(screen.getByRole("button",{name:"Resume"}));await screen.findByText("Reading on this Mac");
 await user.click(screen.getByRole("button",{name:"Stop reading"}));expect(api.stopSpeech).toHaveBeenCalledWith("fixture");expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture");expect(screen.queryByRole("region",{name:"Local read aloud"})).toBeNull();
});
test("changing conversation cancels a late accepted job",async()=>{
 let resolve!:(job:SpeechJob)=>void;vi.mocked(api.readAnswer).mockReturnValue(new Promise(value=>{resolve=value;}));const user=userEvent.setup();const rendered=render(view());await user.click(screen.getByRole("button",{name:"Read aloud on this Mac"}));rendered.rerender(view("other-chat"));
 await act(async()=>resolve(job));await waitFor(()=>expect(api.stopSpeech).toHaveBeenCalledWith("fixture"));expect(players).toHaveLength(0);
});

 test("Pocket speed survives media loads across multiple passages",async()=>{
  vi.mocked(api.readAnswer).mockResolvedValue({...job,playback_rate:1.5});
  vi.mocked(api.getSpeechJob).mockResolvedValue({...job,ready_chunks:2,total_chunks:2,playback_rate:1.5});
  const user=userEvent.setup();render(view());await user.click(screen.getByRole("button",{name:"Read aloud on this Mac"}));await screen.findByText("Reading on this Mac");
  expect(players[0].defaultPlaybackRate).toBe(1.5);expect(players[0].playbackRate).toBe(1.5);
  await act(async()=>players[0].onended?.());expect(players[0].play).toHaveBeenCalledTimes(2);expect(players[0].playbackRate).toBe(1.5);
 });
 test("selected reading replaces a whole-answer reading and bounds the selected action",async()=>{
  const user=userEvent.setup();render(<LocalSpeechProvider conversationId="chat" onDiscover={vi.fn()} onSettings={vi.fn()}><ReadAloudButton source={source}/><ReadAloudButton source={source} selection="New selection"/><ReadAloudButton source={source} selection={"x".repeat(6001)}/></LocalSpeechProvider>);
  expect(screen.getByRole<HTMLButtonElement>("button",{name:"Select up to 6,000 characters to read aloud"}).disabled).toBe(true);
  await user.click(screen.getByRole("button",{name:"Read aloud on this Mac"}));await screen.findByText("Reading on this Mac");
  await user.click(screen.getByRole("button",{name:"Read selected text aloud"}));
  expect(api.readAnswer).toHaveBeenLastCalledWith("chat","answer","New selection");expect(players).toHaveLength(2);
 });
