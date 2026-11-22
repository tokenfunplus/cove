// @vitest-environment jsdom
import { setupControlTests } from "@/test/control-helpers";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "@/api/debates";
import { DebateWorkspace } from "./DebateWorkspace";
import { DebateSetupDialog, defaultDebateRules } from "./DebateSetupDialog";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import type { DebateSession, DebateTurn, DebateView } from "@cove/api-contract";

vi.mock("@/api/debates", () => ({ getDebate: vi.fn(), getDebateTurn: vi.fn(), createDebate: vi.fn(), controlDebate: vi.fn(), updateDebateRules: vi.fn(), updateDebateControls: vi.fn(), addDebateIntervention: vi.fn(), watchDebate: vi.fn(async () => {}), getDebateExport: vi.fn() }));

let view: DebateView;
let cache: QueryClient;
const fixture = createWorkspaceFixture(2);
beforeEach(() => {
  vi.clearAllMocks();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const session: DebateSession = { id: "debate-one", client_request_id: "request-one", topic: "Should a team stay small?", seats: fixture.settings.active_model_set.map((seat, index) => ({ ...seat, role: index ? "Challenger" : "Advocate" })), rules: { ...defaultDebateRules }, status: "running", round: 2, position: 0, opening_done: [true, true], total_turns: 2, created_at: fixture.conversation.created_at, updated_at: fixture.conversation.updated_at };
  view = { session, turns: [{ id: "turn-one", debate_id: session.id, sequence: 1, round: 1, seat: 0, role: "Advocate", rule_version: 1, state: "completed", body: "A source-attributed public position.", snapshot: fixture.pendingBatch.targets[0]!.generation.snapshot, configuration: fixture.pendingBatch.targets[0]!.generation.configuration_snapshot, context_ids: [], created_at: session.created_at, updated_at: session.updated_at }], interventions: [], has_more: false };
  vi.mocked(api.getDebate).mockImplementation(async () => structuredClone(view));
  vi.mocked(api.controlDebate).mockImplementation(async (_id, action) => { view.session.status = action === "stop" ? "stopped" : action === "pause" || action === "step" ? "paused" : "running"; return structuredClone(view.session); });
  vi.mocked(api.updateDebateRules).mockImplementation(async (_id, rules) => { view.session.pending_rules = { ...rules, version: 2 }; return structuredClone(view.session); });
  vi.mocked(api.updateDebateControls).mockImplementation(async (_id, controls) => { view.session.controls = { ...controls, version: controls.version + 1 }; return structuredClone(view.session); });
  vi.mocked(api.addDebateIntervention).mockImplementation(async (_id, input) => { const note = { ...input, id: "note-one", applied_round: 0, created_at: view.session.created_at }; view.interventions.push(note); return note; });
  vi.mocked(api.createDebate).mockResolvedValue(session);
});
setupControlTests();

afterEach(() => { cleanup(); cache.clear(); vi.unstubAllGlobals(); });
function mount(element: React.ReactNode) { return render(<QueryClientProvider client={cache}>{element}</QueryClientProvider>); }

test("intervention sizing follows container width, ignores height-only notifications, and disconnects", async () => {
  let notify: ResizeObserverCallback = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const { unmount } = mount(<DebateWorkspace id="debate-one" onNewDebate={() => {}} />);
  const input = await screen.findByRole("textbox", { name: "Your intervention" });
  expect(observe).toHaveBeenCalledWith(input);
  let contentHeight = 38;
  Object.defineProperty(input, "scrollHeight", { get: () => contentHeight });
  const resize = (width: number) => act(() => notify([
    { target: input, contentRect: new DOMRectReadOnly(0, 0, width, 40), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] },
  ], {} as ResizeObserver));
  resize(600);
  expect(input.style.height).toBe("40px");
  contentHeight = 78;
  resize(600);
  expect(input.style.height).toBe("40px");
  resize(300);
  expect(input.style.height).toBe("80px");
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(input.style.height).toBe("");
});

test.each(["running", "paused", "stopped"] as const)("Focus offers one New debate action while %s and respects its disabled state", async (status) => {
  view.session.status = status;
  const onNewDebate = vi.fn();
  const { rerender } = mount(<DebateWorkspace id="debate-one" focusMode onNewDebate={onNewDebate} />);
  const button = await screen.findByRole("button", { name: "New debate" });
  expect(screen.getAllByRole("button", { name: "New debate" })).toHaveLength(1);
  await userEvent.setup().click(button);
  expect(onNewDebate).toHaveBeenCalledOnce();
  rerender(<QueryClientProvider client={cache}><DebateWorkspace id="debate-one" focusMode newDebateDisabled onNewDebate={onNewDebate} /></QueryClientProvider>);
  expect(button.hasAttribute("disabled")).toBe(true);
  await userEvent.setup().click(button);
  expect(onNewDebate).toHaveBeenCalledOnce();
});

test("workspace controls pause, step, resume, and stop through commands", async () => {
  const user = userEvent.setup(); const newDebate = vi.fn();
  mount(<DebateWorkspace id="debate-one" onNewDebate={newDebate} />);
  expect(await screen.findByText(view.session.topic)).toBeTruthy();
  expect(within(screen.getByLabelText("Debate transcript")).getByText("A source-attributed public position.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Pause" }));
  await screen.findByRole("button", { name: "Resume" });
  await user.click(screen.getByRole("button", { name: "Step" }));
  await waitFor(() => expect(api.controlDebate).toHaveBeenCalledWith("debate-one", "step"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Resume" }).hasAttribute("disabled")).toBe(false));
  await user.click(screen.getByRole("button", { name: "Resume" }));
  await screen.findByRole("button", { name: "Pause" });
  await user.click(screen.getByRole("button", { name: "Stop" }));
  await screen.findByText("Debate stopped");
  expect(screen.getByLabelText("Your intervention").hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "New debate" })); expect(newDebate).toHaveBeenCalledOnce();
});

test("interventions queue with a stable command identity and rules stay pending", async () => {
  const user = userEvent.setup(); mount(<DebateWorkspace id="debate-one" onNewDebate={() => {}} />);
  await screen.findByText(view.session.topic);
  await user.type(screen.getByLabelText("Your intervention"), "Consider the review bottleneck.");
  await user.click(screen.getByRole("button", { name: "Add to debate" }));
  await screen.findByText("Queued for the next round");
  expect(api.addDebateIntervention).toHaveBeenCalledWith("debate-one", expect.objectContaining({ body: "Consider the review bottleneck.", client_request_id: expect.any(String) }));
  expect((screen.getByLabelText("Your intervention") as HTMLTextAreaElement).value).toBe("");
  await user.click(screen.getByRole("button", { name: "Rules" }));
  const dialog = screen.getByRole("dialog"); const rules = within(dialog).getByLabelText("Ground rules");
  await user.clear(rules); await user.type(rules, "Use a concrete counterexample.");
  await user.click(within(dialog).getByRole("button", { name: "Apply next round" }));
  await screen.findByText("Rules v1 · v2 queued");
  expect(api.updateDebateRules).toHaveBeenCalledWith("debate-one", expect.objectContaining({ text: "Use a concrete counterexample." }));
});

test("details retain Provider identity, original rules, and context references", async () => {
  const user = userEvent.setup(); mount(<DebateWorkspace id="debate-one" onNewDebate={() => {}} />);
  await screen.findByText(view.session.topic); await user.click(screen.getByRole("button", { name: "Details" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Test Provider · model-one")).toBeTruthy();
  expect(within(dialog).getByText(/Independent opening; no other participant/)).toBeTruthy();
  await user.keyboard("{Escape}"); expect(screen.queryByRole("dialog")).toBeNull();
});

test("a rejected summary keeps its original response in Details without presenting parsed points", async () => {
  const body = '{"new_ideas":[{"text":"Unsupported statement","sources":[999]}]}';
  view.turns[0] = { ...view.turns[0]!, kind: "summary", state: "failed", body, error_message: "Invalid source citations." };
  mount(<DebateWorkspace id="debate-one" onNewDebate={() => {}} />);
  await screen.findByText("Invalid source citations.");
  expect(screen.queryByText(body)).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Details" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Original summary response")).toBeTruthy();
  expect(within(dialog).getByText(body)).toBeTruthy();
});

test("stage summaries link interpretations to original participant turns", async () => {
  const user = userEvent.setup();
  const source = view.turns[0]!;
  const summary = { turn_id: "summary-one", from_round: 1, through_round: 1, seat: 0, new_ideas: [{ text: "Participants introduced a team-size boundary.", sources: [{ turn_id: source.id, sequence: source.sequence, seat: source.seat }] }], position_changes: [], open_questions: [], created_at: source.created_at };
  view.session.summary = summary;
  view.turns.push({ ...source, id: summary.turn_id, sequence: 2, kind: "summary", summary, body: '{"new_ideas":[]}' });
  mount(<DebateWorkspace id="debate-one" onNewDebate={() => {}} />);
  const transcript = await screen.findByLabelText("Debate transcript");
  expect(within(transcript).getByText("Participants introduced a team-size boundary.")).toBeTruthy();
  expect(within(transcript).getAllByRole("button", { name: "Challenge" })).toHaveLength(1);
  await user.click(within(transcript).getByRole("button", { name: "Turn 1" }));
  expect(within(screen.getByRole("dialog")).getByText(source.body)).toBeTruthy();
});

test("summary streaming keeps incomplete JSON out of the reading view", async () => {
  const source = view.turns[0]!;
  view.turns.push({ ...source, id: "summary-stream", sequence: 2, kind: "summary", state: "streaming", body: '{"new_ideas":[' });
  mount(<DebateWorkspace id="debate-one" focusMode onNewDebate={() => {}} />);
  expect(await screen.findByText("Preparing a stage summary with source citations…")).toBeTruthy();
  expect(screen.queryByText('{"new_ideas":[')).toBeNull();
});

test("budget settings require rates for all seats and save one versioned command", async () => {
  const user = userEvent.setup();
  view.session.status = "paused";
  view.session.controls = { version: 4, summary_every: 0, summary_seat: 0, auto_pause: true, token_budget: 100, rates: [{}, {}] };
  view.usage = { calls: 2, summary_calls: 0, active_calls: 0, input_tokens: 80, output_tokens: 40, missing_usage_calls: 0, unpriced_calls: 2, estimated_cost_usd: 0, cost_complete: false, budget_status: "token_budget" };
  mount(<DebateWorkspace id="debate-one" focusMode onNewDebate={() => {}} />);
  await user.click(await screen.findByRole("button", { name: "Budget & pace" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/Reported input: 80 tokens/)).toBeTruthy();
  await user.type(within(dialog).getByLabelText("Estimated cost budget (USD)"), "0.5");
  expect(within(dialog).getByText("Add input and output rates for every seat to use a cost budget.")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(true);
  for (let seat = 1; seat <= 2; seat++) {
    await user.type(within(dialog).getByLabelText(`Seat ${seat} input rate`), "2");
    await user.type(within(dialog).getByLabelText(`Seat ${seat} output rate`), "4");
  }
  await user.click(within(dialog).getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(api.updateDebateControls).toHaveBeenCalledExactlyOnceWith("debate-one", expect.objectContaining({ version: 4, token_budget: 100, cost_budget_usd: 0.5, auto_pause: true, rates: [{ input_per_million: 2, output_per_million: 4 }, { input_per_million: 2, output_per_million: 4 }] })));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("checkpoint browser details fetch evidence and stale requests cannot replace or reopen a dialog", async () => {
  const user = userEvent.setup();
  const first = { ...view.turns[0]!, execution: "browser" as const };
  const second: DebateTurn = { ...view.turns[0]!, id: "turn-two", sequence: 2, seat: 1, role: "Challenger", body: "Another public position." };
  view.turns = [first, second];
  let resolve!: (turn: DebateTurn) => void;
  vi.mocked(api.getDebateTurn).mockImplementation(() => new Promise(done => { resolve = done; }));
  mount(<DebateWorkspace id="debate-one" onNewDebate={() => {}} />);
  await user.click(await screen.findByRole("button", { name: /Seat 1 · Turn 1/ }));
  expect(api.getDebateTurn).toHaveBeenCalledExactlyOnceWith("debate-one", first.id);
  await act(async () => resolve({ ...first, body: "Full browser evidence response." }));
  expect(within(screen.getByRole("dialog")).getByText("Full browser evidence response.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Close turn details" }));
  await user.click(screen.getByRole("button", { name: /Seat 1 · Turn 1/ }));
  const stale = resolve;
  await user.click(screen.getByRole("button", { name: "Close turn details" }));
  await user.click(screen.getByRole("button", { name: /Seat 2 · Turn 2/ }));
  await act(async () => stale({ ...first, body: "Stale evidence response." }));
  expect(within(screen.getByRole("dialog")).getByText("Another public position.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Close turn details" }));
  await user.click(screen.getByRole("button", { name: /Seat 1 · Turn 1/ }));
  await user.keyboard("{Escape}");
  await act(async () => resolve(first));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Challenge cannot replace an intervention while its submission is pending", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  vi.mocked(api.addDebateIntervention).mockImplementation(async (_id, input) => {
    await new Promise<void>(resolve => { finish = resolve; });
    return { ...input, id: "note-one", applied_round: 0, created_at: view.session.created_at };
  });
  mount(<DebateWorkspace id="debate-one" onNewDebate={() => {}} />);
  await screen.findByText(view.session.topic);
  await user.type(screen.getByLabelText("Your intervention"), "Submitted draft.");
  await user.click(screen.getByRole("button", { name: "Add to debate" }));
  const challenge = screen.getByRole("button", { name: "Challenge" });
  expect(challenge.hasAttribute("disabled")).toBe(true);
  await user.click(challenge);
  expect((screen.getByLabelText("Your intervention") as HTMLTextAreaElement).value).toBe("Submitted draft.");
  await act(async () => finish());
  await waitFor(() => expect(challenge.hasAttribute("disabled")).toBe(false));
  await user.click(challenge);
  expect((screen.getByLabelText("Your intervention") as HTMLTextAreaElement).value).toContain("My challenge:");
});

test("setup uses supported catalogs, keeps roles separate, and starts a real session", async () => {
  const user = userEvent.setup(); const started = vi.fn(); const close = vi.fn();
  mount(<DebateSetupDialog open onClose={close} onStarted={started} onOpenSettings={() => {}} profiles={[fixture.profile]} catalogs={{ [fixture.profile.id]: { status: "ready", models: fixture.models, metadata: {} } }} activeModelSet={fixture.settings.active_model_set.map(seat => ({ providerId: seat.provider_id, modelId: seat.model_id }))} />);
  await user.type(screen.getByLabelText("The question"), "Which architecture should a team choose?");
  await user.click(screen.getByRole("button", { name: "Start debate" }));
  await waitFor(() => expect(started).toHaveBeenCalledWith("debate-one"));
  expect(api.createDebate).toHaveBeenCalledWith(expect.objectContaining({ topic: "Which architecture should a team choose?", seats: [{ provider_id: fixture.profile.id, model_id: "model-one", role: "Advocate" }, { provider_id: fixture.profile.id, model_id: "model-two", role: "Challenger" }] }));
  expect(close).toHaveBeenCalledOnce();
});

test("a configured NearAI Provider exposes model seats and explains browser verification", async () => {
  const user = userEvent.setup();
  mount(<DebateSetupDialog open onClose={() => {}} onStarted={() => {}} onOpenSettings={() => {}} profiles={[{ ...fixture.profile, kind: "nearai" }]} catalogs={{ [fixture.profile.id]: { status: "ready", models: fixture.models } }} activeModelSet={[]} />);
  expect(screen.getByRole("combobox", { name: "Model for seat 1" }).textContent).toContain("model-one");
  expect(screen.getByRole("combobox", { name: "Model for seat 2" }).textContent).toContain("model-two");
  expect(screen.getByText(/Keep this debate open for NearAI encryption/)).toBeTruthy();
  await user.type(screen.getByLabelText("The question"), "Should a CTO write code?");
  await user.click(screen.getByRole("button", { name: "Start debate" }));
  await waitFor(() => expect(api.createDebate).toHaveBeenCalledWith(expect.objectContaining({ seats: expect.arrayContaining([expect.objectContaining({ provider_id: fixture.profile.id, model_id: "model-two" })]) })));
});

test("unconfigured Providers remain unavailable for debate inference", () => {
  mount(<DebateSetupDialog open onClose={() => {}} onStarted={() => {}} onOpenSettings={() => {}} profiles={[{ ...fixture.profile, configured: false }]} catalogs={{ [fixture.profile.id]: { status: "ready", models: fixture.models } }} activeModelSet={[]} />);
  expect(screen.queryByRole("combobox", { name: "Model for seat 1" })).toBeNull();
  fireEvent.submit(screen.getByRole("button", { name: "Start debate" }).closest("form")!);
  expect(api.createDebate).not.toHaveBeenCalled();
});
