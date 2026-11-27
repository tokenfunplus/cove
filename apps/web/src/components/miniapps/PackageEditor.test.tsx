// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppPackage } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { PackageEditor } from "./PackageEditor";

const draft: MiniAppPackage = {
  format: 1,
  publisher: "cove",
  app: "review",
  name: "Unpublished draft",
  description: "A new version under an existing publisher.",
  version: "99.0.0",
  schema_version: 1,
  capabilities: ["records.query"],
  collections: { notes: { fields: { text: "text" } } },
  actions: {
    list: {
      title: "Read notes",
      op: "query",
      collection: "notes",
      inputs: {},
      surfaces: ["page"],
    },
  },
  pages: [{ id: "home", title: "Notebook", actions: ["list"] }],
  seed: { notes: [{ text: "Example draft content" }] },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function show() {
  vi.spyOn(miniApps, "catalog").mockResolvedValue({ packages: [] });
  const validate = vi.spyOn(miniApps, "validateDraft").mockResolvedValue(draft);
  const preview = vi.fn();
  function Editor() {
    const [source, change] = useState(JSON.stringify(draft));
    return (
      <PackageEditor
        source={source}
        onChange={change}
        examples={[]}
        preview={preview}
        expanded
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Editor />
    </QueryClientProvider>,
  );
  return { validate, preview };
}
test("draft validation renders only public examples without attesting or installing a publisher", async () => {
  const { validate, preview } = show();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Validate draft" }));
  await screen.findByText("Draft is valid");
  expect(screen.getByText("Example draft content")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  expect(validate).toHaveBeenCalledWith(JSON.stringify(draft));
  expect(preview).not.toHaveBeenCalled();
});
test("editing a validated draft retires its prior preview", async () => {
  show();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Validate draft" }));
  await screen.findByText("Draft is valid");
  await user.type(
    screen.getByRole("textbox", { name: "App package JSON" }),
    " ",
  );
  expect(screen.queryByText("Draft is valid")).toBeNull();
});
