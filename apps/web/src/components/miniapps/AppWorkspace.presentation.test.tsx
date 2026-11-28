// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppPackage } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { AppView } from "./AppWorkspace";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pkg: MiniAppPackage = {
  format: 1, publisher: "author", app: "records", name: "Records",
  version: "1.0.0", min_host_version: "1.2.0", schema_version: 1,
  capabilities: ["records.query", "records.commit"],
  collections: { entries: {
    title_field: "company",
    fields: { company: "text", position: "text", appliedOn: "date", channel: "text" },
  } },
  pages: [{ id: "home", title: "Records", actions: ["list", "remove"] }],
  actions: {
    list: { title: "List", op: "query", collection: "entries", inputs: {}, surfaces: ["page"], order_by: "appliedOn" },
    remove: { title: "Delete selected", op: "delete", collection: "entries", inputs: {}, surfaces: ["page"] },
  },
};

test.each([1, 2])("deleting %s records reports deletion after confirmation and renders the authored title", async count => {
  const records = Array.from({ length: count }, (_, index) => ({
    id: String(index), revision: 1,
    // The API's record map order must not determine the card title.
    fields: { channel: "LinkedIn", appliedOn: "2030-01-04", company: "Example company " + index, position: "Engineer" },
  }));
  let deleted = false;
  vi.spyOn(miniApps, "invoke").mockImplementation(async (_, command) => {
    if (command.action === "list") return { records: deleted ? [] : records };
    if (!command.confirm) return { records, confirmation: "reviewed" };
    deleted = true;
    return { records };
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <AppView pkg={pkg} page={pkg.pages[0]} surface="page" attach={vi.fn()}
      instance={{ id: "book", name: "My records", release_id: "r", revision: 1, enabled: true, grants: pkg.capabilities }} />
  </QueryClientProvider>);
  await screen.findByLabelText("Select record 1");
  expect(screen.getByText("Example company 0").className).toContain("font-medium");
  const user = userEvent.setup();
  for (let index = 1; index <= count; index++) await user.click(screen.getByLabelText("Select record " + index));
  await user.click(screen.getByRole("button", { name: "Delete selected" }));
  await user.click(screen.getByRole("button", { name: "Preview changes" }));
  expect(deleted).toBe(false);
  await user.click(await screen.findByRole("button", { name: "Confirm permanent deletion" }));
  await screen.findByText(`Deleted ${count} ${count === 1 ? "record" : "records"} from My records.`);
  expect(screen.queryByText(/^Saved \d/)).toBeNull();
  expect(deleted).toBe(true);
});
