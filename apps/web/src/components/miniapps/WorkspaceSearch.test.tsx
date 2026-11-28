// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { WorkspaceSearch } from "./WorkspaceSearch";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(layer?: "study" | "confirmation") {
  const instances = vi.spyOn(miniApps, "instances").mockResolvedValue({ instances: [] });
  vi.spyOn(miniApps, "releases").mockResolvedValue({ packages: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}>
    <WorkspaceSearch navigate={vi.fn()} />
    {layer && <Dialog open onClose={() => {}} layer={layer}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Review changes</DialogTitle>
        <button>Keep reviewing</button>
      </DialogContent>
    </Dialog>}
  </QueryClientProvider>);
  return instances;
}

test.each(["study", "confirmation"] as const)("workspace shortcut preserves the active %s dialog", async (layer) => {
  const instances = setup(layer);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep reviewing" })));
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    fireEvent.keyDown(window, { key: "k", ...modifier });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("searchbox", { name: "App or page" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep reviewing" }));
  }
  expect(instances).not.toHaveBeenCalled();
});

test("workspace shortcut opens and closes search while inactive Chat is inert", async () => {
  setup();
  const inactive = document.createElement("div");
  inactive.setAttribute("inert", "");
  inactive.innerHTML = '<div role="dialog">Retained inactive Chat dialog</div>';
  document.body.append(inactive);
  try {
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await screen.findByRole("searchbox", { name: "App or page" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole("searchbox", { name: "App or page" })).toBeNull());
  } finally { inactive.remove(); }
});
