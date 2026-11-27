// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppPackage } from "@cove/api-contract";
import { LocalServiceError } from "@/api/client";
import { miniApps } from "@/api/mini-apps";
import { AppActionForm } from "./AppActionForm";

vi.mock("./AppProcessing", () => ({ AppProcessing: () => null }));
vi.mock("./AppFileInput", () => ({ AppFileInput: () => null }));
vi.mock("./AppModelTask", () => ({ AppModelTask: () => null }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pkg: MiniAppPackage = {
  format: 1,
  publisher: "author",
  app: "notes",
  name: "Notes",
  version: "1.0.0",
  schema_version: 1,
  capabilities: ["records.commit"],
  collections: { notes: { fields: { text: "text" } } },
  pages: [],
  actions: {
    add: {
      title: "Add note",
      op: "create",
      collection: "notes",
      inputs: { text: "text" },
      values: { text: "$input.text" },
      surfaces: ["chat"],
    },
  },
};
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AppActionForm
        instance={{
          id: "book",
          name: "Notes",
          release_id: "r",
          enabled: true,
          revision: 1,
          grants: ["records.commit"],
        }}
        pkg={pkg}
        proposalKey="generation-1"
        actionId="add"
        surface="chat"
        selected={[]}
        initial={{ text: "Proposed note" }}
        localRequired={false}
        query={vi.fn()}
        saved={vi.fn()}
        close={vi.fn()}
        candidate={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

test("reopening an accepted conversation proposal reuses its operation and cannot add another record", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const accepted = new Set<string>();
  const invoke = vi
    .spyOn(miniApps, "invoke")
    .mockImplementation(async (_, command) => {
      if (accepted.has(command.operation_id))
        throw new LocalServiceError({
          error: {
            code: "conflict",
            message: "Already applied",
            details: null,
            request_id: "local",
          },
        });
      if (command.confirm) {
        accepted.add(command.operation_id);
        return {
          records: [
            { id: "saved", revision: 1, fields: { text: "Proposed note" } },
          ],
        };
      }
      return {
        records: [
          { id: "saved", revision: 1, fields: { text: "Proposed note" } },
        ],
        confirmation: "reviewed",
      };
    });
  const user = userEvent.setup();
  const original = mount();
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  await user.click(
    await screen.findByRole("button", { name: "Confirm changes" }),
  );
  await waitFor(() => expect(accepted.size).toBe(1));
  const operation = invoke.mock.calls[0][1].operation_id;
  original.unmount();
  mount();
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  await screen.findByText(
    "This proposal has already been reviewed, or its target changed. Open the app to check its saved records.",
  );
  expect(invoke.mock.calls.at(-1)?.[1].operation_id).toBe(operation);
  expect(accepted.size).toBe(1);
});
