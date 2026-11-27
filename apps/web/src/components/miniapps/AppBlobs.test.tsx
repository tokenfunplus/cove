// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { AppBlobs } from "./AppBlobs";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test("a failed attachment delivery retries with the same operation ID", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(miniApps, "attachments").mockResolvedValue({ attachments: [] });
  const upload = vi
    .spyOn(miniApps, "uploadAttachment")
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValue({});
  const file = new File(["contents"], "notes.txt", { type: "text/plain" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode("contents").buffer,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AppBlobs
        instance={{
          id: "book",
          release_id: "r",
          name: "Book",
          revision: 1,
          enabled: true,
          grants: ["blobs.import"],
        }}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Import a file (up to 4 MiB)"), {
    target: { files: [file] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Retry import" }));
  await screen.findByText("Attachment saved.");
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  expect(upload.mock.calls[0][1]).toBe(upload.mock.calls[1][1]);
});
