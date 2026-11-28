// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { LocalServiceError } from "@/api/client";
import { miniApps } from "@/api/mini-apps";
import { AppFileInput } from "./AppFileInput";

vi.mock("@/api/mini-apps", () => ({
  miniApps: { startFile: vi.fn(), file: vi.fn() },
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function renderField() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Form() {
    const [text, setText] = useState("Existing material");
    return <>
      <textarea aria-label="Passage" value={text} onChange={(e) => setText(e.target.value)} />
      <AppFileInput instance="book" onChoose={setText} />
    </>;
  }
  render(<QueryClientProvider client={client}><Form /></QueryClientProvider>);
  return userEvent.setup();
}

test("an expired pending file can be replaced without reopening the form", async () => {
  vi.mocked(miniApps.startFile)
    .mockResolvedValueOnce({ id: "expired", url: "cove://pick/expired" })
    .mockResolvedValueOnce({ id: "new", url: "cove://pick/new" });
  vi.mocked(miniApps.file)
    .mockResolvedValueOnce({ state: "pending" })
    .mockRejectedValueOnce(new LocalServiceError({
      error: { code: "not_found", message: "Not found", request_id: "local", details: null },
    }))
    .mockResolvedValue({ state: "completed", text: "New selection" });

  const user = renderField();
  await user.click(screen.getByRole("button", { name: "Import text file" }));
  await screen.findByRole("link", { name: "Open Mac file picker" });
  await screen.findByText("File selection expired. Choose a file again.", {}, { timeout: 3000 });
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Existing material");
  await user.click(screen.getByRole("button", { name: "Import text file" }));
  await screen.findByDisplayValue("New selection");
  expect(miniApps.file).toHaveBeenCalledWith("book", "new");
});

test("retrying a transient status error resumes the original selection", async () => {
  vi.mocked(miniApps.startFile).mockResolvedValue({ id: "one", url: "cove://pick/one" });
  vi.mocked(miniApps.file)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ state: "completed", text: "Picked text" });
  const user = renderField();
  await user.click(screen.getByRole("button", { name: "Import text file" }));
  await user.click(await screen.findByRole("button", { name: "Retry file status" }));
  await waitFor(() => expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Picked text"));
  expect(miniApps.startFile).toHaveBeenCalledTimes(1);
});
