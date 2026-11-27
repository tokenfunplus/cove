// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppInstance, MiniAppPackage } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { PackagePreview } from "./AppDirectory";

const pkg: MiniAppPackage = {
  publisher: "studio", app: "book", name: "Reading book", version: "1.1.0",
  format: 1, schema_version: 1, capabilities: ["records.query", "ai.generate"],
  actions: {}, pages: [], collections: {},
};
const first: MiniAppInstance = {
  id: "first", name: "First book", release_id: "old", revision: 3,
  enabled: true, grants: ["records.query"],
};
const second: MiniAppInstance = {
  ...first, id: "second", name: "Second book", grants: ["ai.generate"],
};

function show(previous: MiniAppInstance[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PackagePreview pkg={pkg} previous={previous} versions={{ old: "1.0.0" }}
        source={{ kind: "local", raw: "fixture", origin: "local" }} close={vi.fn()} open={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("a file import defaults to the existing instance and preserves its grant choices", async () => {
  const install = vi.spyOn(miniApps, "localPackage").mockResolvedValue({ id: "new", digest: "fixture", origin: "local", package: pkg });
  const update = vi.spyOn(miniApps, "upgrade").mockResolvedValue({ ...first, release_id: "new" });
  const create = vi.spyOn(miniApps, "create");
  show([first]);
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  expect(select.value).toBe("first");
  expect(select.selectedOptions[0].textContent).toContain("First book · 1.0.0 → 1.1.0");
  expect((screen.getByRole("checkbox", { name: "Request model generation" }) as HTMLInputElement).checked).toBe(false);
  expect(install).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Upgrade instance to 1.1.0" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(first, "new", ["records.query"], false));
  expect(create).not.toHaveBeenCalled();
});

test("multiple copies require a choice and changing target resets permission selection", async () => {
  show([first, second]);
  const user = userEvent.setup();
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  const model = screen.getByRole("checkbox", { name: "Request model generation" }) as HTMLInputElement;
  expect(select.selectedOptions[0].textContent).toContain("Choose an instance");
  await user.selectOptions(select, second.id);
  expect(model.checked).toBe(true);
  await user.selectOptions(select, first.id);
  expect(model.checked).toBe(false);
  await user.selectOptions(select, "");
  expect(screen.getByRole("textbox", { name: "Instance name" })).toBeTruthy();
  expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
});
