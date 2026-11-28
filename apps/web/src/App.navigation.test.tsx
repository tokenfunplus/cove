// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { isWorkspaceNavigation, navigateWorkspace } from "@/lib/workspace-navigation";

const calls = vi.hoisted(() => ({ unmount: vi.fn(), createConversation: vi.fn() }));
vi.mock("@/api/conversations", () => ({ createConversation: calls.createConversation }));
vi.mock("@/pages/QuickPanelPage", () => ({ QuickPanelPage: () => <p>Quick Panel</p> }));
vi.mock("@/pages/MiniAppsPage", () => ({
  default: ({ attach }: { attach: (body: string) => Promise<void> }) => (
    <div><h1>Apps</h1><button onClick={() => navigateWorkspace("/")}>Open Chat</button>
      <button onClick={() => void attach("App snapshot")}>Attach</button></div>
  ),
}));
vi.mock("@/pages/ChatPage", async () => {
  const { useEffect, useState } = await import("react");
  const { useWorkspaceActive } = await import("@/lib/workspace-active");
  return { ChatPage: ({ incomingAppDraft }: { incomingAppDraft?: { body: string } }) => {
    const [draft, setDraft] = useState("");
    const [running, setRunning] = useState(false);
    const active = useWorkspaceActive();
    useEffect(() => () => calls.unmount(), []);
    return <div><h1>Chat</h1><input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
      <button onClick={() => setRunning(true)}>Start response</button>
      {running && <p>Response running</p>}{active && <p>Chat input active</p>}
      {incomingAppDraft && <p>{incomingAppDraft.body}</p>}
      <button onClick={() => navigateWorkspace("/apps")}>Open Apps</button></div>;
  } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, "", "/"); });

test("Chat draft and generation survive workspace switching and native Back/Forward", async () => {
  window.history.replaceState({ foreign: true }, "", "/");
  render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Draft" }), "Keep my draft");
  await user.click(screen.getByRole("button", { name: "Start response" }));
  await user.click(screen.getByRole("button", { name: "Open Apps" }));
  await screen.findByRole("heading", { name: "Apps" });
  expect(screen.queryByRole("heading", { name: "Chat" })).toBeNull();
  expect(calls.unmount).not.toHaveBeenCalled();
  act(() => window.history.back());
  await screen.findByRole("heading", { name: "Chat" });
  expect((screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe("Keep my draft");
  expect(screen.getByText("Response running")).toBeDefined();
  expect(window.history.state).toEqual({ foreign: true });
  act(() => window.history.forward());
  await screen.findByRole("heading", { name: "Apps" });
  expect(screen.queryByText("Chat input active")).toBeNull();
  expect(calls.unmount).not.toHaveBeenCalled();
});

test("direct App URLs defer Chat bootstrap until first visit, then retain it", async () => {
  window.history.replaceState(null, "", "/apps?section=catalog");
  render(<App />);
  await screen.findByRole("heading", { name: "Apps" });
  expect(screen.queryByText("Chat", { selector: "h1" })).toBeNull();
  act(() => navigateWorkspace("/"));
  await screen.findByRole("heading", { name: "Chat" });
  act(() => navigateWorkspace("/apps"));
  await screen.findByRole("heading", { name: "Apps" });
  expect(calls.unmount).not.toHaveBeenCalled();
});

test.each(["complete", "navigate", "unmount"])("App handoff owns its asynchronous navigation: %s", async outcome => {
  window.history.replaceState(null, "", "/apps");
  let finish!: (value: { id: string }) => void;
  calls.createConversation.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Attach" }));
  if (outcome === "navigate") act(() => navigateWorkspace("/apps?section=activity"));
  if (outcome === "unmount") view.unmount();
  await act(async () => finish({ id: "created" }));
  if (outcome === "complete") {
    await screen.findByText("App snapshot");
    expect(window.location.hash).toBe("#conversation=created");
  } else expect(window.location.pathname).toBe("/apps");
});

test("navigation preserves replace-state metadata and does not duplicate the current URL", () => {
  window.history.replaceState({ foreign: true }, "", "/apps");
  const length = window.history.length;
  const listener = vi.fn((event: Event) => expect(isWorkspaceNavigation(event)).toBe(true));
  window.addEventListener("popstate", listener);
  try {
    navigateWorkspace("/apps");
    expect(window.history.length).toBe(length);
    navigateWorkspace("/apps?section=catalog", true);
    expect(window.history.state).toEqual({ foreign: true });
    expect(window.history.length).toBe(length);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => navigateWorkspace("https://example.com/")).toThrow("Invalid workspace destination");
  } finally { window.removeEventListener("popstate", listener); }
});

test("Quick Panel stays separate from the retained full Chat surface", () => {
  window.history.replaceState(null, "", "/?surface=quick-panel");
  render(<App />);
  expect(screen.getByText("Quick Panel")).toBeDefined();
  expect(screen.queryByRole("heading", { name: "Chat" })).toBeNull();
});

test("App routes retain priority over a Quick Panel query parameter", async () => {
  window.history.replaceState(null, "", "/apps?surface=quick-panel");
  render(<App />);
  await screen.findByRole("heading", { name: "Apps" });
  expect(screen.queryByText("Quick Panel")).toBeNull();
});
