// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { workspaceEntry } from "@/lib/workspace-navigation";

const calls = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock("@/pages/QuickPanelPage", () => ({ QuickPanelPage: () => null }));
vi.mock("@/pages/MiniAppsPage", async () => {
  const { navigateWorkspace } = await import("@/lib/workspace-navigation");
  return {
    default: () => (
      <div>
        <h1>App workspace</h1>
        <button onClick={() => navigateWorkspace("/")}>Open Chat</button>
      </div>
    ),
  };
});
vi.mock("@/pages/ChatPage", async () => {
  const { useEffect, useState } = await import("react");
  const { navigateWorkspace } = await import("@/lib/workspace-navigation");
  return {
    ChatPage: () => {
      const [draft, setDraft] = useState("");
      const [active, setActive] = useState(false);
      const [proceed, setProceed] = useState<() => Promise<void>>();
      useEffect(() => {
        const protect = (event: Event) => {
          if (!draft && !active) return;
          event.preventDefault();
          setProceed(
            () =>
              (event as CustomEvent<{ proceed: () => Promise<void> }>).detail
                .proceed,
          );
        };
        window.addEventListener("cove-workspace-navigation", protect);
        return () =>
          window.removeEventListener("cove-workspace-navigation", protect);
      }, [draft, active]);
      return (
        <div>
          <h1>Chat workspace</h1>
          <input
            aria-label="Draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button onClick={() => setActive(true)}>Start response</button>
          {active && <p>Response remains active</p>}
          <button onClick={() => navigateWorkspace("/apps")}>Open Apps</button>
          {proceed && (
            <div role="dialog" aria-label="Protect Chat">
              <button onClick={() => setProceed(undefined)}>Stay</button>
              <button
                onClick={async () => {
                  if (active) calls.stop();
                  setDraft("");
                  setActive(false);
                  await proceed();
                  setProceed(undefined);
                }}
              >
                Leave
              </button>
            </div>
          )}
        </div>
      );
    },
  };
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  calls.stop.mockClear();
});

test.each([
  ["back", "draft"],
  ["back", "generation"],
  ["forward", "draft"],
  ["forward", "generation"],
] as const)(
  "%s then Stay preserves the original entry and %s until Leave",
  async (direction, protection) => {
    window.history.replaceState(
      { preserved: "target-state" },
      "",
      direction === "back" ? "/apps" : "/",
    );
    render(<App />);
    const user = userEvent.setup();
    if (direction === "back") {
      await user.click(
        await screen.findByRole("button", { name: "Open Chat" }),
      );
    } else {
      await user.click(screen.getByRole("button", { name: "Open Apps" }));
      await screen.findByRole("heading", { name: "App workspace" });
      act(() => window.history.back());
    }
    const draft = (await screen.findByRole("textbox", {
      name: "Draft",
    })) as HTMLInputElement;
    if (protection === "draft") await user.type(draft, "Keep this draft");
    else
      await user.click(screen.getByRole("button", { name: "Start response" }));
    const original = workspaceEntry()!;
    const historyLength = window.history.length;
    const traverse = () =>
      direction === "back" ? window.history.back() : window.history.forward();
    act(traverse);
    await screen.findByRole("dialog", { name: "Protect Chat" });
    await waitFor(() => expect(workspaceEntry()?.key).toBe(original.key));
    expect(window.location.pathname).toBe("/");
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(window.history.length).toBe(historyLength);
    expect(calls.stop).not.toHaveBeenCalled();
    if (protection === "draft") expect(draft.value).toBe("Keep this draft");
    else expect(screen.getByText("Response remains active")).toBeTruthy();
    act(traverse);
    await screen.findByRole("dialog", { name: "Protect Chat" });
    await waitFor(() => expect(workspaceEntry()?.key).toBe(original.key));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await screen.findByRole("heading", { name: "App workspace" });
    expect(window.location.pathname).toBe("/apps");
    expect(window.history.length).toBe(historyLength);
    expect(calls.stop).toHaveBeenCalledTimes(
      protection === "generation" ? 1 : 0,
    );
    if (direction === "back")
      expect(window.history.state.preserved).toBe("target-state");
  },
);

test("programmatic navigation waits for permission before adding an entry", async () => {
  render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Draft" }), "Unsent");
  const historyLength = window.history.length;
  const original = workspaceEntry()!;
  await user.click(screen.getByRole("button", { name: "Open Apps" }));
  await screen.findByRole("dialog");
  expect(window.history.length).toBe(historyLength);
  expect(workspaceEntry()?.key).toBe(original.key);
  expect(window.location.pathname).toBe("/");
  await user.click(screen.getByRole("button", { name: "Stay" }));
  await user.click(screen.getByRole("button", { name: "Open Apps" }));
  await user.click(await screen.findByRole("button", { name: "Leave" }));
  await screen.findByRole("heading", { name: "App workspace" });
  expect(window.history.length).toBe(historyLength + 1);
});

test("unmanaged entries never guess a traversal distance and preserve the full protected URL", async () => {
  window.history.replaceState(
    { preserved: "chat-state" },
    "",
    "/#keep-this-fragment",
  );
  render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Draft" }), "Unsent");
  const go = vi.spyOn(window.history, "go");
  act(() => {
    window.history.pushState({ external: true }, "", "/apps");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByRole("dialog");
  expect(go).not.toHaveBeenCalled();
  expect(window.location.pathname + window.location.hash).toBe(
    "/#keep-this-fragment",
  );
  expect(window.history.state.preserved).toBe("chat-state");
  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(
    (screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value,
  ).toBe("Unsent");
});

test("native hash-only entries reset the known history lineage without consuming the fragment", () => {
  render(<App />);
  const before = workspaceEntry()!;
  const oldURL = window.location.href;
  act(() => {
    window.history.pushState(window.history.state, "", "/#native-fragment");
    window.dispatchEvent(
      new HashChangeEvent("hashchange", {
        oldURL,
        newURL: window.location.href,
      }),
    );
  });
  expect(workspaceEntry()?.lineage).not.toBe(before.lineage);
  expect(window.location.hash).toBe("#native-fragment");
});

test("a native hash change invalidates a pending numeric traversal", async () => {
  window.history.replaceState(null, "", "/apps");
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Open Chat" }));
  await user.type(
    await screen.findByRole("textbox", { name: "Draft" }),
    "Protected",
  );
  const original = workspaceEntry()!;
  act(() => window.history.back());
  await screen.findByRole("dialog");
  await waitFor(() => expect(workspaceEntry()?.key).toBe(original.key));
  const go = vi.spyOn(window.history, "go");
  const oldURL = window.location.href;
  act(() => {
    window.history.pushState(window.history.state, "", "/#native-fragment");
    window.dispatchEvent(
      new HashChangeEvent("hashchange", {
        oldURL,
        newURL: window.location.href,
      }),
    );
  });
  await user.click(screen.getByRole("button", { name: "Leave" }));
  expect(go).not.toHaveBeenCalled();
  expect(window.location.pathname + window.location.hash).toBe(
    "/#native-fragment",
  );
});
