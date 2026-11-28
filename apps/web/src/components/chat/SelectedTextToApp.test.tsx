// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { appKeys, miniApps } from "@/api/mini-apps";
import { SelectedTextToApp } from "./SelectedTextToApp";
const picker = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn() }));
vi.mock("./ComposerAppPicker", async () => {
  const { useEffect } = await import("react");
  return {
    default: ({
      selectedText,
      close,
    }: {
      selectedText: string;
      close: () => void;
    }) => {
      useEffect(() => {
        picker.mounted();
        return () => {
          picker.unmounted();
        };
      }, []);
      return (
        <div role="dialog" aria-label="Selection picker">
          <p>{selectedText}</p>
          <button onClick={close}>Done</button>
        </div>
      );
    },
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
test.each([false, true])(
  "text selection offers an app only when an instance can receive it (%s)",
  async (installed) => {
    const list = vi.spyOn(miniApps, "instances").mockResolvedValue({
      instances: installed
        ? [
            {
              id: "i",
              release_id: "r",
              name: "Notes",
              enabled: true,
              revision: 1,
              grants: ["mac.selection.receive"],
            },
          ]
        : [],
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
          })
        }
      >
        <div data-app-selection-source="chat">Selected passage</div>
        <SelectedTextToApp
          conversation="chat"
          draft=""
          change={vi.fn()}
          localRequired={false}
          surface="chat"
        />
      </QueryClientProvider>,
    );
    const text = screen.getByText("Selected passage").firstChild!;
    const selection = {
      anchorNode: text,
      focusNode: text,
      toString: () => "Selected passage",
    } as unknown as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(selection);
    act(() => document.dispatchEvent(new Event("selectionchange")));
    await waitFor(() => expect(list).toHaveBeenCalled());
    if (installed)
      expect(
        await screen.findByRole("button", {
          name: "Use selected text in an app",
        }),
      ).toBeDefined();
    else {
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Use selected text in an app" }),
        ).toBeNull(),
      );
    }
  },
);

const enabledInstance = {
  id: "i",
  release_id: "r",
  name: "Notes",
  enabled: true,
  revision: 1,
  grants: ["mac.selection.receive"],
};

function selectionFixture() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={cache}>
      <div data-app-selection-source="chat">Source passage</div>
      <SelectedTextToApp
        conversation="chat"
        draft="Draft"
        change={vi.fn()}
        localRequired={false}
        surface="chat"
      />
    </QueryClientProvider>,
  );
  const text = screen.getByText("Source passage").firstChild!;
  let selected = "";
  vi.spyOn(window, "getSelection").mockImplementation(
    () =>
      ({
        anchorNode: text,
        focusNode: text,
        toString: () => selected,
      }) as unknown as Selection,
  );
  return {
    cache,
    select(value: string) {
      selected = value;
      act(() => document.dispatchEvent(new Event("selectionchange")));
    },
  };
}

test("selection changes reuse recent inventory and actual invalidation still refreshes grants", async () => {
  const list = vi
    .spyOn(miniApps, "instances")
    .mockResolvedValue({ instances: [enabledInstance] });
  const { cache, select } = selectionFixture();
  expect(list).not.toHaveBeenCalled();
  select("First selection");
  await screen.findByRole("button", { name: "Use selected text in an app" });
  expect(list).toHaveBeenCalledOnce();
  select("");
  expect(
    screen.queryByRole("button", { name: "Use selected text in an app" }),
  ).toBeNull();
  select("Next selection");
  await screen.findByRole("button", { name: "Use selected text in an app" });
  expect(list).toHaveBeenCalledOnce();
  list.mockResolvedValue({ instances: [] });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: appKeys.instances });
  });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByRole("button", { name: "Use selected text in an app" }),
  ).toBeNull();
});

test("grant refresh keeps an open picker and its frozen text until the user closes it", async () => {
  const list = vi
    .spyOn(miniApps, "instances")
    .mockResolvedValue({ instances: [enabledInstance] });
  const { cache, select } = selectionFixture();
  select("Frozen selection");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Use selected text in an app" }),
  );
  await screen.findByRole("dialog", { name: "Selection picker" });
  expect(picker.mounted).toHaveBeenCalledOnce();
  list.mockResolvedValue({ instances: [] });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: appKeys.instances });
  });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("dialog", { name: "Selection picker" })).toBeTruthy();
  expect(screen.getByText("Frozen selection")).toBeTruthy();
  expect(picker.mounted).toHaveBeenCalledOnce();
  expect(picker.unmounted).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    screen.queryByRole("button", { name: "Use selected text in an app" }),
  ).toBeNull();
});
