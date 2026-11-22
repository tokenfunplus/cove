// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DebateTurn, DebateView, SpeechConfiguration, SpeechJob } from "@cove/api-contract";
import * as api from "@/api/speech";
import { getDebate } from "@/api/debates";
import { LocalServiceError } from "@/api/client";
import { LocalSpeechProvider, useLocalSpeech } from "@/components/chat/LocalSpeech";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { defaultDebateRules } from "./DebateSetupDialog";
import { DebateSpeechControl, pendingSpeechTurns } from "./DebateSpeechControl";

vi.mock("@/api/speech", () => ({ previewSpeech: vi.fn(), getSpeechConfiguration: vi.fn(), readDebateTurn: vi.fn(), getSpeechJob: vi.fn(), speechAudio: vi.fn(), stopSpeech: vi.fn() }));
vi.mock("@/api/debates", () => ({ getDebate: vi.fn() }));
const fixture = createWorkspaceFixture(2);
const job: SpeechJob = { id: "speech", state: "completed", model_id: "voice", model_name: "Local voice", voice_name: "Voice", language: "en", ready_chunks: 1, total_chunks: 1, characters: 24, playback_rate: 1, volume: .9 };
const configuration: SpeechConfiguration = { settings: { mode: "auto", model_id: "", english_model_id: "", chinese_model_id: "", profiles: {}, include_code: false, volume: .9, threads: 2 }, models: [{ id: "voice", name: "Local voice", engine: "kokoro", languages: ["en"], installed: true, runtime_ready: true, default_voice: "heart", voices: [] }] };
const players: FakeAudio[] = [];
class FakeAudio {
  volume = 1; playbackRate = 1; src = ""; onended: (() => void) | null = null; onerror: (() => void) | null = null;
  play = vi.fn().mockResolvedValue(undefined); pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
  constructor() { players.push(this); }
}
function turn(sequence: number, state: DebateTurn["state"] = "completed"): DebateTurn {
  return { id: `turn-${sequence}`, debate_id: "debate", sequence, round: 1, seat: sequence % 2, role: "Advocate", rule_version: 1, state, body: `Public position ${sequence}.`, snapshot: fixture.pendingBatch.targets[sequence % 2]!.generation.snapshot, configuration: fixture.pendingBatch.targets[0]!.generation.configuration_snapshot, context_ids: [], created_at: fixture.conversation.created_at, updated_at: fixture.conversation.updated_at };
}
function view(turns: DebateTurn[], has_more = false): DebateView {
  return { session: { id: "debate", client_request_id: "request", topic: "A synthetic question", seats: fixture.settings.active_model_set.map(seat => ({ ...seat, role: "Advocate" })), rules: defaultDebateRules, status: "running", round: 1, position: 0, opening_done: [false, false], total_turns: 0, created_at: fixture.conversation.created_at, updated_at: fixture.conversation.updated_at }, turns, interventions: [], has_more };
}
const onDiscover = vi.fn();
const onSettings = vi.fn();
function surface(data: DebateView, stopping = false) {
  return <LocalSpeechProvider conversationId="debate" onDiscover={onDiscover} onSettings={onSettings}><DebateSpeechControl view={data} stopping={stopping}/><textarea aria-label="Intervention" defaultValue="Keep my draft"/></LocalSpeechProvider>;
}
beforeEach(() => {
  vi.clearAllMocks(); players.length = 0;
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:wave"); static revokeObjectURL = vi.fn(); });
  vi.mocked(api.getSpeechConfiguration).mockResolvedValue(structuredClone(configuration));
  vi.mocked(api.readDebateTurn).mockResolvedValue(job);
  vi.mocked(api.getSpeechJob).mockResolvedValue(job);
  vi.mocked(api.speechAudio).mockResolvedValue(new Blob(["wave"]));
  vi.mocked(api.stopSpeech).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("defaults off, excludes history, and waits for earlier parallel turns before serial playback", async () => {
  const user = userEvent.setup();
  const rendered = render(surface(view([turn(1)])));
  expect(screen.getByRole("button", { name: "Turn on debate read aloud" }).getAttribute("aria-pressed")).toBe("false");
  expect(api.getSpeechConfiguration).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  await screen.findByText(/Waiting for the next turn/);
  expect(api.readDebateTurn).not.toHaveBeenCalled();
  rendered.rerender(surface(view([turn(1), turn(2, "streaming"), turn(3)])));
  await waitFor(() => expect(screen.getByText(/Waiting for the next turn/)).toBeTruthy());
  expect(api.readDebateTurn).not.toHaveBeenCalled();
  rendered.rerender(surface(view([turn(1), turn(2), turn(3)])));
  await screen.findByText("Reading on this Mac");
  expect(api.readDebateTurn).toHaveBeenCalledExactlyOnceWith({ debate_id: "debate", turn_id: "turn-2" });
  expect(screen.getByText(/Round 1 · model-one · Advocate/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Pause" }));
  expect(players[0].pause).toHaveBeenCalled();
  expect(api.readDebateTurn).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Resume" }));
  await act(async () => players[0].onended?.());
  await waitFor(() => expect(api.readDebateTurn).toHaveBeenCalledTimes(2), { timeout: 2500 });
  expect(vi.mocked(api.readDebateTurn).mock.calls[1][0].turn_id).toBe("turn-3");
  expect(players).toHaveLength(2);
  rendered.rerender(surface(view([turn(1), turn(2), turn(3)])));
  await act(async () => players[1].onended?.());
  await screen.findByText(/Waiting for the next turn/, {}, { timeout: 2500 });
  expect(api.readDebateTurn).toHaveBeenCalledTimes(2);
});

test.each(["off", "stop", "navigation"])("%s cancels an accepted reading and drops the queue", async action => {
  const user = userEvent.setup();
  const rendered = render(surface(view([])));
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  await screen.findByText(/Waiting for the next turn/);
  rendered.rerender(surface(view([turn(1), turn(2)])));
  await screen.findByText("Reading on this Mac");
  if (action === "off") await user.click(screen.getByRole("button", { name: "Turn off debate read aloud" }));
  else if (action === "stop") rendered.rerender(surface(view([turn(1), turn(2)]), true));
  else rendered.unmount();
  await waitFor(() => expect(api.stopSpeech).toHaveBeenCalledWith("speech"));
  expect(players[0].pause).toHaveBeenCalled();
  expect(api.readDebateTurn).toHaveBeenCalledTimes(1);
});

test("missing or selected uninstalled voices guide installation and keep automatic reading off", async () => {
  vi.mocked(api.getSpeechConfiguration).mockResolvedValue({ ...configuration, settings: { ...configuration.settings, mode: "manual", model_id: "missing" } });
  const user = userEvent.setup(); render(surface(view([turn(1)])));
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  await screen.findByRole("dialog");
  expect(screen.getByRole("button", { name: "Speech settings" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Open Discover" }));
  expect(onDiscover).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Turn on debate read aloud" }).getAttribute("aria-pressed")).toBe("false");
  expect((screen.getByRole("textbox", { name: "Intervention" }) as HTMLTextAreaElement).value).toBe("Keep my draft");
  expect(api.readDebateTurn).not.toHaveBeenCalled();
});

test("a language/model failure stops automatic admission instead of repeatedly opening setup", async () => {
  vi.mocked(api.readDebateTurn).mockRejectedValue(new LocalServiceError({ error: { code: "speech_model_required", message: "Install a voice for this language.", details: null, request_id: "fixture" } }));
  const user = userEvent.setup(); const rendered = render(surface(view([])));
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  await screen.findByText(/Waiting for the next turn/);
  rendered.rerender(surface(view([turn(1), turn(2)])));
  await screen.findByRole("dialog");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Turn on debate read aloud" }).getAttribute("aria-pressed")).toBe("false");
  expect(api.readDebateTurn).toHaveBeenCalledTimes(1);
});

test("pagination catches up every turn, while failed turns and structured summaries stay silent", async () => {
  const signal = new AbortController().signal;
  vi.mocked(getDebate).mockResolvedValue(view([turn(2), turn(3)], true));
  const result = await pendingSpeechTurns(view([turn(4), turn(5)], true), 1, signal);
  expect(result.map(item => item.sequence)).toEqual([2, 3, 4, 5]);
  expect(getDebate).toHaveBeenCalledWith("debate", 4, signal);
  const user = userEvent.setup(); const rendered = render(surface(view([])));
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  await screen.findByText(/Waiting for the next turn/);
  rendered.rerender(surface(view([turn(1, "failed"), { ...turn(2), kind: "summary" }, turn(3)])));
  await screen.findByText("Reading on this Mac");
  expect(api.readDebateTurn).toHaveBeenCalledExactlyOnceWith({ debate_id: "debate", turn_id: "turn-3" });
});

test("turning off before admission finishes cancels a late speech job", async () => {
  let resolve!: (job: SpeechJob) => void;
  vi.mocked(api.readDebateTurn).mockReturnValue(new Promise(done => { resolve = done; }));
  const user = userEvent.setup(); const rendered = render(surface(view([])));
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  await screen.findByText(/Waiting for the next turn/);
  rendered.rerender(surface(view([turn(1)])));
  await screen.findByText("Preparing audio on this Mac…");
  await user.click(screen.getByRole("button", { name: "Turn off debate read aloud" }));
  await act(async () => resolve(job));
  await waitFor(() => expect(api.stopSpeech).toHaveBeenCalledWith("speech"));
  expect(players).toHaveLength(0);
});

test("the shared player's Stop disables automatic reading for future turns", async () => {
  const user = userEvent.setup(); const rendered = render(surface(view([])));
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  await screen.findByText(/Waiting for the next turn/);
  rendered.rerender(surface(view([turn(1)])));
  await screen.findByText("Reading on this Mac");
  await user.click(screen.getByRole("button", { name: "Stop reading" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Turn on debate read aloud" })).toBeTruthy());
  rendered.rerender(surface(view([turn(1), turn(2)])));
  expect(api.readDebateTurn).toHaveBeenCalledTimes(1);
});

test("a late readiness check cannot enable audio or open setup after navigation", async () => {
  let resolve!: (configuration: SpeechConfiguration) => void;
  vi.mocked(api.getSpeechConfiguration).mockReturnValue(new Promise(done => { resolve = done; }));
  const user = userEvent.setup(); const rendered = render(surface(view([])));
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  rendered.rerender(<LocalSpeechProvider conversationId="other" onDiscover={onDiscover} onSettings={onSettings}><p>Another conversation</p></LocalSpeechProvider>);
  await act(async () => resolve({ ...configuration, models: [] }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(api.readDebateTurn).not.toHaveBeenCalled();
});

test("a queued streaming turn that settles during playback is read without another invalidation", async () => {
  const user = userEvent.setup(); const rendered = render(surface(view([])));
  await user.click(screen.getByRole("button", { name: "Turn on debate read aloud" }));
  await screen.findByText(/Waiting for the next turn/);
  rendered.rerender(surface(view([turn(1), turn(2, "streaming")])));
  await screen.findByText("Reading on this Mac");
  rendered.rerender(surface(view([turn(1), turn(2)])));
  await act(async () => players[0].onended?.());
  await waitFor(() => expect(api.readDebateTurn).toHaveBeenCalledTimes(2), { timeout: 2500 });
  expect(vi.mocked(api.readDebateTurn).mock.calls[1][0].turn_id).toBe("turn-2");
});

 test("a preview owns playback even before the first automatic debate turn",async()=>{
  vi.mocked(api.previewSpeech).mockResolvedValue(job);
  function Preview(){const speech=useLocalSpeech();return <button onClick={()=>speech?.preview({text:"Preview",model_id:"voice",profile:{voice_id:"heart",speed:1,noise_scale:.6,temperature:.3}})}>Preview fixture</button>;}
  function fixtureSurface(data:DebateView){return <LocalSpeechProvider conversationId="debate" onDiscover={onDiscover} onSettings={onSettings}><DebateSpeechControl view={data}/><Preview/></LocalSpeechProvider>;}
  const user=userEvent.setup();const rendered=render(fixtureSurface(view([])));
  await user.click(screen.getByRole("button",{name:"Turn on debate read aloud"}));await screen.findByText(/Waiting for the next turn/);
  await user.click(screen.getByRole("button",{name:"Preview fixture"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Turn on debate read aloud"})).toBeTruthy());
  rendered.rerender(fixtureSurface(view([turn(1)])));expect(api.readDebateTurn).not.toHaveBeenCalled();expect(api.stopSpeech).not.toHaveBeenCalled();
 });
