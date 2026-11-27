// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { SelectedTextToApp } from "./SelectedTextToApp";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test.each([false, true])(
  "text selection offers an app only when an instance can receive it (%s)",
  async (installed) => {
    const list = vi
      .spyOn(miniApps, "instances")
      .mockResolvedValue({
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
