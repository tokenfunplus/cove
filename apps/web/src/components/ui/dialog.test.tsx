// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Dialog, DialogContent, DialogOverlay, DialogTitle } from "./dialog";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { StudyDialog } from "@/components/miniapps/StudyDialog";

afterEach(cleanup);

test.each(["app", "study", "legacy"] as const)(
  "a confirmation inside a %s dialog traps focus and restores its opener on Escape",
  async (layer) => {
    const parentClosed = vi.fn();
    function Fixture() {
      const [open, setOpen] = useState(false);
      const content = <>
        <button onClick={() => setOpen(true)}>Discard unsaved result</button>
        <ConfirmationDialog open={open} title="Discard this result?" description="Saved records stay in place." confirmLabel="Discard result" destructive onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} />
      </>;
      return layer === "study" ? (
        <StudyDialog title="Generate questions" close={parentClosed}>{content}</StudyDialog>
      ) : (
        <Dialog open onClose={parentClosed} layer={layer === "app" ? "app" : undefined} className="relative z-70">
          <DialogOverlay />
          <DialogContent><DialogTitle>App actions</DialogTitle>{content}</DialogContent>
        </Dialog>
      );
    }
    render(<Fixture />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Discard unsaved result" });
    await user.click(opener);
    const confirmation = await screen.findByRole("dialog", { name: "Discard this result?" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(confirmation.closest<HTMLElement>('[data-slot="dialog-portal"]')?.style.zIndex).toBe("130");
    for (let index = 0; index < 5; index++) {
      await user.tab();
      expect(confirmation.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Discard this result?" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(parentClosed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  },
);

test("outside interaction closes only the confirmation above a study dialog", async () => {
  const parentClosed = vi.fn();
  function Fixture() {
    const [open, setOpen] = useState(false);
    return <StudyDialog title="Generate questions" close={parentClosed}>
      <button onClick={() => setOpen(true)}>Review discard</button>
      <ConfirmationDialog open={open} title="Discard this result?" description="Saved records stay in place." confirmLabel="Discard result" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} />
    </StudyDialog>;
  }
  render(<Fixture />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Review discard" }));
  await screen.findByRole("dialog", { name: "Discard this result?" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Discard result" }));
  const overlays = document.querySelectorAll<HTMLElement>('[data-slot="dialog-overlay"]');
  await user.click(overlays[overlays.length - 1]!);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Discard this result?" })).toBeNull());
  expect(parentClosed).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Generate questions" })).toBeTruthy();
});
