// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { navigateWorkspace, workspaceEntry } from "@/lib/workspace-navigation";

const calls = vi.hoisted(() => ({ stop: vi.fn(), createConversation: vi.fn() }));
vi.mock("@/api/conversations", () => ({
  createConversation: calls.createConversation,
}));
vi.mock("@/pages/QuickPanelPage", () => ({ QuickPanelPage: () => null }));
vi.mock("@/pages/MiniAppsPage", async () => {
  const { navigateWorkspace } = await import("@/lib/workspace-navigation");
  return {
    default: ({ attach }: { attach: (body: string) => Promise<void> }) => (
      <div>
        <h1>App workspace</h1>
        <button onClick={() => navigateWorkspace("/")}>Open Chat</button>
        <button onClick={() => void attach("App snapshot")}>Attach to Chat</button>
      </div>
    ),
  };
});
vi.mock("@/pages/ChatPage", async () => {
  const { useEffect, useState } = await import("react");
  const { navigateWorkspace } = await import("@/lib/workspace-navigation");
  return {
    ChatPage: ({ incomingAppDraft }: { incomingAppDraft?: { body: string } }) => {
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
          {incomingAppDraft && <p>Incoming: {incomingAppDraft.body}</p>}
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
  calls.createConversation.mockReset();
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

test("native hash-only entries retain the known history lineage without consuming the fragment", () => {
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
  expect(workspaceEntry()?.lineage).toBe(before.lineage);
  expect(workspaceEntry()?.index).toBe(before.index + 1);
  expect(workspaceEntry()?.key).not.toBe(before.key);
  expect(window.location.hash).toBe("#native-fragment");
});

test("moving to a different entry with the same URL invalidates pending Leave", async () => {
  window.history.replaceState(null, "", "/apps?book=a");
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Open Chat" }));
  const firstChat = workspaceEntry()!;
  await user.click(screen.getByRole("button", { name: "Open Apps" }));
  await user.click(await screen.findByRole("button", { name: "Open Chat" }));
  const secondChat = workspaceEntry()!;
  await user.type(screen.getByRole("textbox", { name: "Draft" }), "Protected");
  act(() => window.history.back());
  await screen.findByRole("dialog");
  await waitFor(() => expect(workspaceEntry()?.key).toBe(secondChat.key));
  act(() => window.history.go(-2));
  await waitFor(() => expect(workspaceEntry()?.key).toBe(firstChat.key));
  const go = vi.spyOn(window.history, "go");
  await user.click(screen.getByRole("button", { name: "Leave" }));
  expect(go).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe("/");
  expect(workspaceEntry()?.key).toBe(firstChat.key);
});

test("Stay preserves the Apps destination after traversing a native fragment", async () => {
  window.history.replaceState({ preserved: "apps-state" }, "", "/apps");
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "App workspace" });
  const apps = workspaceEntry()!;
  await user.click(screen.getByRole("button", { name: "Open Chat" }));
  const chat = workspaceEntry()!;
  await user.type(screen.getByRole("textbox", { name: "Draft" }), "Protected");
  act(() => {
    window.location.hash = "#native-fragment";
  });
  await waitFor(() => {
    expect(workspaceEntry()?.key).not.toBe(chat.key);
    expect(workspaceEntry()?.lineage).toBe(chat.lineage);
    expect(workspaceEntry()?.index).toBe(chat.index + 1);
  });
  const fragment = workspaceEntry()!;
  const historyLength = window.history.length;
  act(() => window.history.back());
  await waitFor(() => expect(workspaceEntry()?.key).toBe(chat.key));
  expect(window.location.hash).toBe("");
  act(() => window.history.back());
  await screen.findByRole("dialog");
  await waitFor(() => expect(workspaceEntry()?.key).toBe(chat.key));
  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(
    (screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value,
  ).toBe("Protected");
  expect(window.history.length).toBe(historyLength);
  act(() => window.history.back());
  await screen.findByRole("dialog");
  await waitFor(() => expect(workspaceEntry()?.key).toBe(chat.key));
  await user.click(screen.getByRole("button", { name: "Leave" }));
  await screen.findByRole("heading", { name: "App workspace" });
  expect(workspaceEntry()?.key).toBe(apps.key);
  expect(window.history.state.preserved).toBe("apps-state");
  act(() => window.history.forward());
  await waitFor(() => expect(workspaceEntry()?.key).toBe(chat.key));
  act(() => window.history.forward());
  await waitFor(() => expect(workspaceEntry()?.key).toBe(fragment.key));
  expect(window.location.hash).toBe("#native-fragment");
  expect(window.history.length).toBe(historyLength);
});

test("consuming a native fragment preserves both original and new entry positions", async () => {
  const consume = () => window.history.replaceState(
    window.history.state, "", window.location.pathname + window.location.search,
  );
  // Launcher intents consume their fragment in a child listener before App's
  // listener runs. Entry identity must still distinguish the two Chat URLs.
  window.addEventListener("hashchange", consume);
  try {
    window.history.replaceState(null, "", "/apps");
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "App workspace" });
    const apps = workspaceEntry()!;
    await user.click(screen.getByRole("button", { name: "Open Chat" }));
    const chat = workspaceEntry()!;
    act(() => { window.location.hash = "#settings"; });
    await waitFor(() => {
      expect(workspaceEntry()?.key).not.toBe(chat.key);
      expect(workspaceEntry()?.index).toBe(chat.index + 1);
    });
    expect(window.location.hash).toBe("");
    act(() => window.history.back());
    await waitFor(() => expect(workspaceEntry()?.key).toBe(chat.key));
    await user.type(screen.getByRole("textbox", { name: "Draft" }), "Protected");
    act(() => window.history.back());
    await screen.findByRole("dialog");
    await waitFor(() => expect(workspaceEntry()?.key).toBe(chat.key));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await screen.findByRole("heading", { name: "App workspace" });
    expect(workspaceEntry()?.key).toBe(apps.key);
  } finally {
    window.removeEventListener("hashchange", consume);
  }
});

test("a completed App attachment cannot replace Chat after leaving Apps", async () => {
  window.history.replaceState(null, "", "/apps");
  let complete!: (chat: { id: string }) => void;
  calls.createConversation.mockReturnValue(new Promise((resolve) => {
    complete = resolve;
  }));
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Attach to Chat" }));
  expect(calls.createConversation).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Open Chat" }));
  await user.type(await screen.findByRole("textbox", { name: "Draft" }), "Protected");
  await user.click(screen.getByRole("button", { name: "Start response" }));
  const chat = workspaceEntry()!;
  await act(async () => {
    complete({ id: "created-chat" });
  });
  expect(workspaceEntry()?.key).toBe(chat.key);
  expect(window.location.pathname + window.location.hash).toBe("/");
  expect(
    (screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value,
  ).toBe("Protected");
  expect(screen.getByText("Response remains active")).toBeTruthy();
  expect(screen.queryByText("Incoming: App snapshot")).toBeNull();
  expect(calls.stop).not.toHaveBeenCalled();
});

test("returning to the initiating Apps entry does not revive a stale attachment", async () => {
  window.history.replaceState(null, "", "/apps");
  let complete!: (chat: { id: string }) => void;
  calls.createConversation.mockReturnValue(new Promise((resolve) => {
    complete = resolve;
  }));
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Attach to Chat" }));
  const origin = workspaceEntry()!;
  act(() => navigateWorkspace("/apps?section=catalog"));
  act(() => window.history.back());
  await waitFor(() => expect(workspaceEntry()?.key).toBe(origin.key));
  await act(async () => { complete({ id: "created-chat" }); });
  expect(window.location.pathname + window.location.hash).toBe("/apps");
  expect(workspaceEntry()?.key).toBe(origin.key);
  await user.click(screen.getByRole("button", { name: "Open Chat" }));
  expect(screen.queryByText("Incoming: App snapshot")).toBeNull();
});

test("a current App attachment opens its created conversation with the snapshot", async () => {
  window.history.replaceState(null, "", "/apps");
  calls.createConversation.mockResolvedValue({ id: "created-chat" });
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Attach to Chat" }));
  await screen.findByText("Incoming: App snapshot");
  expect(window.location.pathname + window.location.hash).toBe(
    "/#conversation=created-chat",
  );
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

test.each([
  { oldURL: "", newURL: "" },
  { oldURL: "not-an-absolute-url", newURL: "http://localhost/#fragment" },
  { oldURL: "http://localhost/", newURL: "invalid" },
])(
  "ignores incomplete or malformed synthetic hash events: $oldURL / $newURL",
  (urls) => {
    render(<App />);
    const entry = workspaceEntry()!;
    const error = vi.fn();
    window.addEventListener("error", error);
    try {
      act(() => window.dispatchEvent(new HashChangeEvent("hashchange", urls)));
      expect(workspaceEntry()).toEqual(entry);
      expect(
        screen.getByRole("heading", { name: "Chat workspace" }),
      ).toBeTruthy();
      expect(error).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", error);
    }
  },
);

test("synchronous native entry notifications preserve coalesced fragment history through Stay and Leave", async () => {
  const navigation = new EventTarget();
  vi.stubGlobal("navigation", navigation);
  try {
    window.history.replaceState(null, "", "/apps");
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "App workspace" });
    const apps = workspaceEntry()!;
    await user.click(screen.getByRole("button", { name: "Open Chat" }));
    const chat = workspaceEntry()!;
    await user.type(screen.getByRole("textbox", { name: "Draft" }), "Protected");
    const pushFragment = (fragment: string) => {
      const from = { url: window.location.href };
      window.location.hash = fragment;
      navigation.dispatchEvent(Object.assign(new Event("currententrychange"), {
        navigationType: "push", from,
      }));
      return workspaceEntry()!;
    };
    let first!: ReturnType<typeof workspaceEntry>;
    let second!: ReturnType<typeof workspaceEntry>;
    act(() => {
      first = pushFragment("#one");
      second = pushFragment("#two");
    });
    expect(first?.index).toBe(chat.index + 1);
    expect(second?.index).toBe(chat.index + 2);
    const length = window.history.length;
    act(() => window.history.go(-3));
    await screen.findByRole("dialog");
    await waitFor(() => expect(workspaceEntry()?.key).toBe(second?.key));
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect((screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe("Protected");
    act(() => window.history.go(-3));
    await screen.findByRole("dialog");
    await waitFor(() => expect(workspaceEntry()?.key).toBe(second?.key));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await screen.findByRole("heading", { name: "App workspace" });
    expect(workspaceEntry()?.key).toBe(apps.key);
    act(() => window.history.forward());
    await waitFor(() => expect(workspaceEntry()?.key).toBe(chat.key));
    act(() => window.history.forward());
    await waitFor(() => expect(workspaceEntry()?.key).toBe(first?.key));
    act(() => window.history.forward());
    await waitFor(() => expect(workspaceEntry()?.key).toBe(second?.key));
    expect(window.location.hash).toBe("#two");
    expect(window.history.length).toBe(length);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});

test("a second Back that supersedes restoration does not wedge later approved navigation", async () => {
  window.history.replaceState(null, "", "/apps");
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Open Chat" }));
  const firstChat = workspaceEntry()!;
  act(() => navigateWorkspace("/apps?section=catalog"));
  await screen.findByRole("heading", { name: "App workspace" });
  await user.click(screen.getByRole("button", { name: "Open Chat" }));
  await user.type(screen.getByRole("textbox", { name: "Draft" }), "Protected");
  // Hold the app's corrective Forward while a second user Back is already
  // queued. Its +1 then lands on Apps B, rather than the original Chat C2.
  const traverse = window.history.go.bind(window.history);
  const queued: number[] = [];
  vi.spyOn(window.history, "go").mockImplementation(delta => { queued.push(delta ?? 0); });
  act(() => traverse(-1));
  await screen.findByRole("dialog");
  await waitFor(() => expect(queued).toEqual([1]));
  act(() => traverse(-1));
  await waitFor(() => expect(workspaceEntry()?.key).toBe(firstChat.key));
  act(() => traverse(queued.shift()!));
  await waitFor(() => expect(window.location.search).toBe("?section=catalog"));
  await waitFor(() => expect(queued).toEqual([-1]));
  act(() => traverse(queued.shift()!));
  await waitFor(() => expect(workspaceEntry()?.key).toBe(firstChat.key));
  // Staying keeps the draft. A later explicitly approved navigation must still
  // update the surface, even though the old restoration never reached C2.
  await user.click(screen.getByRole("button", { name: "Stay" }));
  await user.click(screen.getByRole("button", { name: "Open Apps" }));
  await user.click(await screen.findByRole("button", { name: "Leave" }));
  await screen.findByRole("heading", { name: "App workspace" });
  expect(window.location.pathname).toBe("/apps");
});
