// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MiniAppPackage } from "@cove/api-contract";
import { miniApps, type CatalogEntry } from "@/api/mini-apps";
import { AppDirectory, type DirectorySection } from "./AppDirectory";

const review: MiniAppPackage = {
  format: 1,
  publisher: "studio",
  app: "review",
  name: "Review book",
  version: "1.10.0",
  schema_version: 1,
  description: "Practise a little every day.",
  capabilities: ["records.query"],
  collections: {},
  actions: {},
  pages: [],
};
const inbox = {
  ...review,
  app: "inbox",
  name: "Reading Inbox",
  version: "1.1.0",
};
const entries: CatalogEntry[] = [
  { ...review, version: "1.0.0", digest: "review-1", origin: "builtin" },
  { ...inbox, version: "1.0.0", digest: "inbox-1", origin: "builtin" },
  { ...review, version: "1.10.0", digest: "review-110", origin: "builtin" },
  { ...inbox, version: "1.1.0", digest: "inbox-11", origin: "builtin" },
  { ...review, version: "1.2.0", digest: "review-12", origin: "builtin" },
];

beforeEach(() => {
  window.history.replaceState(null, "", "/apps");
  vi.spyOn(miniApps, "instances").mockResolvedValue({ instances: [] });
  vi.spyOn(miniApps, "releases").mockResolvedValue({ packages: [] });
  vi.spyOn(miniApps, "catalog").mockResolvedValue({ packages: entries });
  vi.spyOn(miniApps, "catalogPreview").mockImplementation(async (item) => ({
    ...(item.app === "inbox" ? inbox : review),
    version: item.version,
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(
  section?: DirectorySection,
  navigate?: (path: string, replace?: boolean) => void,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const open = vi.fn();
  const view = (nextSection = section) => (
    <QueryClientProvider client={client}>
      <AppDirectory open={open} section={nextSection} navigate={navigate} />
    </QueryClientProvider>
  );
  const rendered = render(view());
  return { ...rendered, view, open };
}

test("the embedded app picker keeps administration hidden and loads Discover only on request", async () => {
  show();
  await screen.findByRole("heading", { name: "Start with something useful." });
  expect(miniApps.catalog).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "More app options" })).toBeNull();
  expect(screen.queryByText("Agent packages")).toBeNull();
  expect(screen.queryByText("Restore a backup")).toBeNull();
  expect(screen.queryByText("Catalog settings")).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Discover" }));
  await screen.findByRole("heading", { name: "App catalog" });
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  expect(screen.queryByRole("button", { name: "More app options" })).toBeNull();
});

test("version changes replace the detail entry instead of adding browser history", async () => {
  window.history.replaceState(
    null,
    "",
    "/apps?section=catalog&app=studio%2Freview&version=1.10.0",
  );
  const navigate = vi.fn();
  show("catalog", navigate);
  const version = await screen.findByRole("combobox", { name: "App version" });
  await userEvent.setup().selectOptions(version, "1.0.0");
  expect(navigate).toHaveBeenCalledWith(
    "/apps?section=catalog&app=studio%2Freview&version=1.0.0",
    true,
  );
});

test("an unavailable requested version is explicit and never silently replaced", async () => {
  window.history.replaceState(
    null,
    "",
    "/apps?section=catalog&app=studio%2Freview&version=0.9.0",
  );
  const navigate = vi.fn();
  show("catalog", navigate);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(
    "Version 0.9.0 of studio/review is not available in the current catalog.",
  );
  expect(screen.queryByRole("combobox", { name: "App version" })).toBeNull();
  expect(miniApps.catalogPreview).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "View available versions" }));
  expect(navigate).toHaveBeenCalledWith(
    "/apps?section=catalog&app=studio%2Freview&version=1.10.0",
    true,
  );
});

test.each(["key-a", "key-b"])(
  "downloaded packages retain authority when offering upgrades (%s)",
  async (authority) => {
    const book = {
      id: "saved-book",
      name: "My review book",
      release_id: "old",
      revision: 1,
      enabled: true,
      grants: ["records.query"],
    };
    vi.mocked(miniApps.instances).mockResolvedValue({ instances: [book] });
    vi.mocked(miniApps.releases).mockResolvedValue({
      packages: [
        {
          id: "old",
          digest: "old",
          origin: "catalog",
          catalog_authority: "key-a",
          package: { ...review, version: "1.0.0" },
        },
      ],
    });
    vi.spyOn(miniApps, "localPackage").mockResolvedValue({
      id: "new",
      digest: "new",
      origin: "catalog",
      catalog_authority: authority,
      official_catalog: false,
      package: review,
    });
    show("mine");
    await screen.findByText("My review book");
    await userEvent.setup().upload(
      screen.getByLabelText("Choose a Mini App package"),
      new File([JSON.stringify(review)], "review.coveapp", {
        type: "application/json",
      }),
    );
    await screen.findByRole("dialog", { name: "Review installation" });
    expect(
      screen.getByText("Custom signed catalog", { exact: false }),
    ).toBeTruthy();
    if (authority === "key-a") {
      expect(
        (
          screen.getByRole("combobox", {
            name: "Update an existing copy",
          }) as HTMLSelectElement
        ).value,
      ).toBe(book.id);
    } else {
      expect(
        screen.queryByRole("combobox", { name: "Update an existing copy" }),
      ).toBeNull();
      expect(screen.getByRole("textbox", { name: "App name" })).toBeTruthy();
    }
  },
);

test("Discover defaults to the newest release and keeps older versions in app details", async () => {
  const install = vi.spyOn(miniApps, "catalogInstall");
  const create = vi.spyOn(miniApps, "create");
  show("catalog");
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Review book", level: 3 });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "View Review book" }));
  const select = (await screen.findByRole("combobox", {
    name: "App version",
  })) as HTMLSelectElement;
  expect(select.value).toBe("1.10.0");
  expect(select.options).toHaveLength(3);
  expect(select.options[0].textContent).toBe("1.10.0 · Latest");
  await user.selectOptions(select, "1.0.0");
  const getApp = await screen.findByRole("button", { name: "Get app" });
  await waitFor(() => expect((getApp as HTMLButtonElement).disabled).toBe(false));
  await user.click(getApp);
  await screen.findByRole("button", { name: "Install app" });
  expect(screen.getByText(/Version 1\.0\.0/)).toBeTruthy();
  expect(install).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    (
      (await screen.findByRole("combobox", {
        name: "App version",
      })) as HTMLSelectElement
    ).value,
  ).toBe("1.0.0");
});

test("canceling an installation preview keeps the agent's source and section", async () => {
  const raw = JSON.stringify({ ...review, publisher: "my-studio" });
  vi.spyOn(miniApps, "localPackage").mockResolvedValue({
    id: "draft",
    digest: "draft",
    origin: "local",
    package: { ...review, publisher: "my-studio" },
  });
  const { rerender, view } = show("agent", vi.fn());
  const user = userEvent.setup();
  const editor = await screen.findByRole("textbox", {
    name: "App package JSON",
  });
  await user.click(editor);
  await user.paste(raw);
  rerender(view("mine"));
  await screen.findByRole("heading", { name: "Start with something useful." });
  rerender(view("agent"));
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "App package JSON",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe(raw);
  await user.click(
    screen.getByRole("button", { name: "Validate and preview package" }),
  );
  await screen.findByRole("button", { name: "Install app" });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "App package JSON",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe(raw);
  expect(miniApps.localPackage).toHaveBeenCalledWith(raw, "preview");
});

test("navigation from an installation preview follows the new section without losing the agent draft", async () => {
  const raw = JSON.stringify({ ...review, publisher: "my-studio" });
  vi.spyOn(miniApps, "localPackage").mockResolvedValue({
    id: "draft",
    digest: "draft",
    origin: "local",
    package: { ...review, publisher: "my-studio" },
  });
  const { rerender, view } = show("agent", vi.fn());
  const user = userEvent.setup();
  const editor = await screen.findByRole("textbox", {
    name: "App package JSON",
  });
  await user.click(editor);
  await user.paste(raw);
  await user.click(
    screen.getByRole("button", { name: "Validate and preview package" }),
  );
  await screen.findByRole("button", { name: "Install app" });
  window.history.pushState(null, "", "/apps");
  rerender(view("mine"));
  await screen.findByRole("heading", { name: "Start with something useful." });
  rerender(view("agent"));
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "App package JSON",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe(raw);
});


test("a catalog install retains the selected signer when another signer has identical installed bytes", async () => {
  const selected: CatalogEntry = { ...review, digest: "same-bytes", origin: "catalog", catalog_authority: "key-b", official_catalog: false };
  vi.mocked(miniApps.catalog).mockResolvedValue({ packages: [selected] });
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [{ id: "release-a", digest: selected.digest, origin: "catalog", catalog_authority: "key-a", official_catalog: false, package: review }] });
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: [{ id: "copy-a", name: "Signer A copy", release_id: "release-a", enabled: true, revision: 1, grants: [] }] });
  const install = vi.spyOn(miniApps, "catalogInstall").mockResolvedValue({ id: "release-b", digest: selected.digest, origin: "catalog", catalog_authority: "key-b", official_catalog: false, package: review });
  const create = vi.spyOn(miniApps, "create").mockResolvedValue({ id: "copy-b", name: review.name, release_id: "release-b", enabled: true, revision: 1, grants: [] });
  show("catalog");
  const user = userEvent.setup();
  const card = (await screen.findByRole("heading", { name: "Review book", level: 3 })).closest("article")!;
  expect(within(card).queryByText("Installed")).toBeNull();
  expect(within(card).getByRole("button", { name: "Install" })).toBeTruthy();
  await user.click(await screen.findByRole("button", { name: "View Review book" }));
  expect(screen.queryByRole("button", { name: "Open app" })).toBeNull();
  await user.click(await screen.findByRole("button", { name: "Get app" }));
  await user.click(await screen.findByRole("button", { name: "Install app" }));
  await waitFor(() => expect(install).toHaveBeenCalledExactlyOnceWith(selected));
  await waitFor(() => expect(create).toHaveBeenCalledWith("release-b", review.name, [], false));
});

test.each(["import", "developer"])("a late %s preview does not reopen review after leaving its entry", async (source) => {
  let complete!: (release: Awaited<ReturnType<typeof miniApps.localPackage>>) => void;
  vi.spyOn(miniApps, "localPackage").mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const { rerender, view } = show("agent", vi.fn());
  const user = userEvent.setup();
  const raw = JSON.stringify(review);
  if (source === "import") {
    await user.upload(screen.getByLabelText("Choose a Mini App package"), new File([raw], "review.coveapp", { type: "application/json" }));
  } else {
    const editor = await screen.findByRole("textbox", { name: "App package JSON" });
    await user.click(editor);
    await user.paste(raw);
    await user.click(screen.getByRole("button", { name: "Validate and preview package" }));
  }
  await waitFor(() => expect(miniApps.localPackage).toHaveBeenCalledTimes(1));
  rerender(view("mine"));
  await act(async () => { complete({ id: "late", digest: "late", origin: "local", package: review }); });
  expect(screen.queryByRole("dialog", { name: "Review installation" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Start with something useful." })).toBeTruthy();
});

test("catalog Install buttons are disabled while a selected release preview is pending", async () => {
  show("catalog");
  await waitFor(() => expect(miniApps.catalogPreview).toHaveBeenCalledTimes(2));
  let complete!: (pkg: MiniAppPackage) => void;
  vi.mocked(miniApps.catalogPreview).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const user = userEvent.setup();
  const reviewCard = screen.getByRole("heading", { name: "Review book", level: 3 }).closest("article")!;
  await user.click(within(reviewCard).getByRole("button", { name: "Install" }));
  expect(screen.getAllByRole("button", { name: "Install" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  await act(async () => { complete(review); });
  await screen.findByRole("dialog", { name: "Review installation" });
  expect(screen.getByText(/Version 1\.10\.0/)).toBeTruthy();
});

test("Discover and app details open only copies of the selected release", async () => {
  const copies = ["first", "second"].map((id) => ({ id, name: `${id} review copy`, release_id: "old", revision: 1, enabled: true, grants: [] }));
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: copies });
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [{ id: "old", digest: "review-1", origin: "builtin", package: { ...review, version: "1.0.0" } }] });
  const { open } = show("catalog");
  const user = userEvent.setup();
  const card = (await screen.findByRole("heading", { name: "Review book", level: 3 })).closest("article")!;
  expect(within(card).queryByText("Installed")).toBeNull();
  expect(within(card).getByRole("button", { name: "Install" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "View Review book" }));
  expect(await screen.findByRole("button", { name: "Get app" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Choose a copy" })).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "App version" }), "1.0.0");
  await user.click(await screen.findByRole("button", { name: "Choose a copy" }));
  await user.click(screen.getByRole("button", { name: "second review copy" }));
  expect(open).toHaveBeenCalledWith("second");
  expect(screen.queryByRole("button", { name: "Get app" })).toBeNull();
});

test("Create another copy starts fresh when a current and an older copy both exist", async () => {
  const current = { id: "current", digest: "review-110", origin: "builtin", package: review };
  const older = { id: "old", digest: "review-1", origin: "builtin", package: { ...review, version: "1.0.0" } };
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [current, older] });
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: [
    { id: "copy-a", name: "Current copy", release_id: current.id, revision: 1, enabled: true, grants: ["records.query"], cloud_enabled: true },
    { id: "copy-b", name: "Older copy", release_id: older.id, revision: 1, enabled: true, grants: ["records.query"], cloud_enabled: true },
  ] });
  vi.spyOn(miniApps, "catalogInstall").mockResolvedValue(current);
  const create = vi.spyOn(miniApps, "create").mockResolvedValue({ id: "new-copy", name: review.name, release_id: current.id, revision: 1, enabled: true, grants: [] });
  const upgrade = vi.spyOn(miniApps, "upgrade");
  const { open } = show("catalog");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "View Review book" }));
  await user.click(await screen.findByRole("button", { name: "Create another copy" }));
  const dialog = await screen.findByRole("dialog", { name: "Review installation" });
  expect((within(dialog).getByRole("combobox", { name: "Update an existing copy" }) as HTMLSelectElement).value).toBe("");
  expect((within(dialog).getByRole("textbox", { name: "App name" }) as HTMLInputElement).value).toBe(review.name);
  expect(within(dialog).getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  await user.click(within(dialog).getByRole("button", { name: "Install app" }));
  await waitFor(() => expect(create).toHaveBeenCalledExactlyOnceWith(current.id, review.name, [], false));
  expect(upgrade).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith("new-copy");
});

test.each([
  { scenario: "same catalog signer", selected: {}, saved: {}, canOpen: true },
  { scenario: "different package bytes", selected: { digest: "different-bytes" }, saved: {}, canOpen: false },
  { scenario: "bundled instead of catalog provenance", selected: {}, saved: { origin: "builtin", catalog_authority: undefined }, canOpen: false },
  { scenario: "different official authority status", selected: { official_catalog: true }, saved: {}, canOpen: false },
  { scenario: "legacy unbound catalog provenance", selected: {}, saved: { catalog_authority: undefined }, canOpen: false },
])("Discover preserves saved data while matching $scenario", async ({ selected: selectedChanges, saved, canOpen }) => {
  const selected: CatalogEntry = { ...review, digest: "same-bytes", origin: "catalog", catalog_authority: "key-a", official_catalog: false, ...selectedChanges };
  const release = { id: "saved-release", digest: "same-bytes", origin: "catalog", catalog_authority: "key-a", official_catalog: false, package: review, ...saved };
  vi.mocked(miniApps.catalog).mockResolvedValue({ packages: [selected] });
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [release] });
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: [{ id: "saved-copy", name: "Saved notebook", release_id: release.id, revision: 1, enabled: true, grants: [] }] });
  const { open } = show();
  const user = userEvent.setup();
  await screen.findByText("Saved notebook");
  await user.click(screen.getByRole("button", { name: "Discover" }));
  const card = (await screen.findByRole("heading", { name: "Review book", level: 3 })).closest("article")!;
  expect(Boolean(within(card).queryByText("Installed"))).toBe(canOpen);
  expect(within(card).getByRole("button", { name: canOpen ? "Open app" : "Install" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "View Review book" }));
  const action = await screen.findByRole("button", { name: canOpen ? "Open app" : "Get app" });
  if (canOpen) {
    await user.click(action);
    expect(open).toHaveBeenCalledWith("saved-copy");
  } else {
    expect(screen.queryByRole("button", { name: "Open app" })).toBeNull();
    expect(open).not.toHaveBeenCalled();
  }
});

test("a superseded developer preview cannot replace the most recently imported package", async () => {
  let complete!: (release: Awaited<ReturnType<typeof miniApps.localPackage>>) => void;
  const imported = { ...inbox, publisher: "personal" };
  vi.spyOn(miniApps, "localPackage")
    .mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }))
    .mockResolvedValueOnce({ id: "imported", digest: "imported", origin: "local", package: imported });
  show("agent", vi.fn());
  const user = userEvent.setup();
  const editor = await screen.findByRole("textbox", { name: "App package JSON" });
  await user.click(editor);
  await user.paste(JSON.stringify(review));
  await user.click(screen.getByRole("button", { name: "Validate and preview package" }));
  await user.upload(screen.getByLabelText("Choose a Mini App package"), new File([JSON.stringify(imported)], "inbox.coveapp", { type: "application/json" }));
  const dialog = await screen.findByRole("dialog", { name: "Review installation" });
  expect(within(dialog).getByRole("textbox", { name: "App name" }).getAttribute("value")).toBe("Reading Inbox");
  await act(async () => { complete({ id: "old", digest: "old", origin: "local", package: review }); });
  expect(within(screen.getByRole("dialog", { name: "Review installation" })).getByRole("textbox", { name: "App name" }).getAttribute("value")).toBe("Reading Inbox");
});
