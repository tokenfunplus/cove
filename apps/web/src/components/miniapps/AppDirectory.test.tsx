// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MiniAppPackage } from "@cove/api-contract";
import { miniApps, type CatalogEntry } from "@/api/mini-apps";
import { AppDirectory, type DirectorySection, type InstallTarget } from "./AppDirectory";

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
  target?: InstallTarget,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const open = vi.fn();
  const view = (nextSection = section) => (
    <QueryClientProvider client={client}>
      <AppDirectory open={open} section={nextSection} navigate={navigate} target={target} />
    </QueryClientProvider>
  );
  const rendered = render(view());
  return { ...rendered, view, open };
}

test("the embedded picker lists local copies and links to CoveWeb without loading a market", async () => {
  show();
  await screen.findByRole("heading", { name: "Start with something useful." });
  expect(miniApps.catalog).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "More app options" })).toBeNull();
  expect(screen.queryByText("Agent packages")).toBeNull();
  expect(screen.queryByText("Restore a backup")).toBeNull();
  expect(screen.queryByText("Release source")).toBeNull();
  expect(screen.queryByRole("button", { name: "Discover" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "App catalog" })).toBeNull();
  for (const link of screen.getAllByRole("link", { name: "Browse apps on CoveWeb" })) {
    expect(link.getAttribute("href")).toBe("https://www.hicove.io/apps");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  }
});

test("a legacy catalog bookmark stays in My apps and never browses remote releases", async () => {
  window.history.replaceState(null, "", "/apps?section=catalog&app=studio%2Freview&version=1.0.0");
  show("catalog", vi.fn());
  await screen.findByRole("heading", { name: "Your apps, your space." });
  expect(screen.getByRole("button", { name: "My apps" }).getAttribute("aria-current")).toBe("page");
  expect(miniApps.catalog).not.toHaveBeenCalled();
  expect(miniApps.catalogPreview).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox", { name: "App version" })).toBeNull();
});

test("a CoveWeb install intent reviews only the requested exact release", async () => {
  const install = vi.spyOn(miniApps, "catalogInstall");
  const create = vi.spyOn(miniApps, "create");
  show("mine", vi.fn(), { publisher: "studio", app: "review", version: "1.0.0" });
  const preview = await screen.findByRole("button", { name: "Preview release" });
  expect(screen.getByRole("link", { name: "View app on CoveWeb" }).getAttribute("href")).toBe("https://www.hicove.io/apps/studio/review?version=1.0.0");
  await userEvent.setup().click(preview);
  const dialog = await screen.findByRole("dialog", { name: "Review installation" });
  expect(within(dialog).getByText(/Version 1\.0\.0/)).toBeTruthy();
  expect(miniApps.catalogPreview).toHaveBeenCalledExactlyOnceWith(entries[0]);
  expect(screen.queryByText("Reading Inbox")).toBeNull();
  expect(install).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

test("an unavailable exact install release is never replaced by the newest version", async () => {
  show("mine", vi.fn(), { publisher: "studio", app: "review", version: "0.9.0" });
  await screen.findByText("No matching release in the catalog.");
  expect(screen.queryByRole("button", { name: "Preview release" })).toBeNull();
  expect(miniApps.catalogPreview).not.toHaveBeenCalled();
});

test("an unversioned install intent resolves only the newest release of that app", async () => {
  show("mine", vi.fn(), { publisher: "studio", app: "review" });
  await userEvent.setup().click(await screen.findByRole("button", { name: "Preview release" }));
  await screen.findByRole("dialog", { name: "Review installation" });
  expect(miniApps.catalogPreview).toHaveBeenCalledExactlyOnceWith(entries[2]);
  expect(screen.queryByText("Reading Inbox")).toBeNull();
});

test.each(["builtin", "catalog"])("one exact installed %s copy opens without a catalog request", async (origin) => {
  const release = { id: "saved-release", digest: "saved", origin, package: { ...review, version: "1.0.0" } };
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [release] });
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: [{ id: "saved-copy", name: "Saved notebook", release_id: release.id, revision: 1, enabled: true, grants: [] }] });
  vi.mocked(miniApps.catalog).mockRejectedValue(new Error("Offline"));
  const { open } = show("mine", vi.fn(), { publisher: "studio", app: "review", version: "1.0.0" });
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith("saved-copy", undefined, true));
  expect(miniApps.catalog).not.toHaveBeenCalled();
  expect(miniApps.catalogPreview).not.toHaveBeenCalled();
});

test("multiple exact copies can be chosen offline without touching data or installing", async () => {
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [{ id: "saved", digest: "saved", origin: "builtin", package: review }] });
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: ["First", "Second"].map(name => ({ id: name.toLowerCase(), name, release_id: "saved", revision: 1, enabled: true, grants: [] })) });
  const create = vi.spyOn(miniApps, "create");
  const install = vi.spyOn(miniApps, "catalogInstall");
  const { open } = show("mine", vi.fn(), { publisher: "studio", app: "review", version: review.version });
  await userEvent.setup().click(await screen.findByRole("button", { name: /Second/ }));
  expect(open).toHaveBeenCalledExactlyOnceWith("second");
  expect(miniApps.catalog).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(install).not.toHaveBeenCalled();
});

test("a personal copy with a matching name is not mistaken for a trusted install", async () => {
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [{ id: "personal", digest: "personal", origin: "local", package: review }] });
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: [{ id: "personal-copy", name: "Personal copy", release_id: "personal", revision: 1, enabled: true, grants: [] }] });
  const { open } = show("mine", vi.fn(), { publisher: "studio", app: "review", version: review.version });
  await screen.findByRole("button", { name: "Preview release" });
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByText("Personal copy")).toBeNull();
});

test("creating another copy from installed files never upgrades an older copy", async () => {
  const current = { id: "current", digest: "current", origin: "builtin", package: review };
  const older = { id: "old", digest: "old", origin: "builtin", package: { ...review, version: "1.0.0" } };
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [current, older] });
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: [
    { id: "current-copy", name: "Current copy", release_id: current.id, revision: 1, enabled: true, grants: ["records.query"], cloud_enabled: true },
    { id: "older-copy", name: "Older copy", release_id: older.id, revision: 1, enabled: true, grants: ["records.query"], cloud_enabled: true },
  ] });
  const create = vi.spyOn(miniApps, "create").mockResolvedValue({ id: "new-copy", name: review.name, release_id: current.id, revision: 1, enabled: true, grants: [] });
  const upgrade = vi.spyOn(miniApps, "upgrade");
  const { open } = show("packages", vi.fn());
  const user = userEvent.setup();
  await screen.findAllByRole("button", { name: "New instance" });
  await user.click(within(document.querySelector('[data-release="current"]') as HTMLElement).getByRole("button", { name: "New instance" }));
  const dialog = await screen.findByRole("dialog", { name: "Review installation" });
  expect((within(dialog).getByRole("combobox", { name: "Update an existing copy" }) as HTMLSelectElement).value).toBe("");
  expect(within(dialog).getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
  await user.click(within(dialog).getByRole("button", { name: "Create copy" }));
  await waitFor(() => expect(create).toHaveBeenCalledExactlyOnceWith(current.id, review.name, [], false));
  expect(upgrade).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith("new-copy");
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

test.each([
  { scenario: "bundled lineage", previous: { origin: "builtin" }, selected: { origin: "builtin" }, update: true },
  { scenario: "same custom signer", previous: { origin: "catalog", catalog_authority: "key-a" }, selected: { origin: "catalog", catalog_authority: "key-a" }, update: true },
  { scenario: "different custom signer", previous: { origin: "catalog", catalog_authority: "key-a" }, selected: { origin: "catalog", catalog_authority: "key-b" }, update: false },
  { scenario: "unbound catalog lineage", previous: { origin: "catalog" }, selected: { origin: "catalog", catalog_authority: "key-a" }, update: false },
  { scenario: "official successor to bundled", previous: { origin: "builtin" }, selected: { origin: "catalog", catalog_authority: "official", official_catalog: true }, update: true },
  { scenario: "custom successor to bundled", previous: { origin: "builtin" }, selected: { origin: "catalog", catalog_authority: "custom" }, update: false },
  { scenario: "personal package with matching publisher", previous: { origin: "local" }, selected: { origin: "builtin" }, update: false },
  { scenario: "verified legacy package", previous: { origin: "local", legacy_verified: true }, selected: { origin: "builtin" }, update: true },
  { scenario: "incompatible collection schema", previous: { origin: "builtin", schema_version: 2 }, selected: { origin: "builtin" }, update: false },
])("a CoveWeb handoff offers a reviewed update only for $scenario", async ({ previous, selected: changes, update }) => {
  const { schema_version, ...provenance } = previous;
  const old = {
    id: "older-release",
    digest: "older-bytes",
    ...provenance,
    package: { ...review, version: "1.0.0", schema_version: schema_version ?? 1 },
  };
  const selected: CatalogEntry = { ...review, digest: "latest-bytes", ...changes };
  vi.mocked(miniApps.catalog).mockResolvedValue({ packages: [selected] });
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [old] });
  vi.mocked(miniApps.instances).mockResolvedValue({ instances: [
    { id: "older-copy", name: "My existing book", release_id: old.id, revision: 1, enabled: true, grants: [] },
  ] });
  const upgrade = vi.spyOn(miniApps, "upgrade");
  show("mine", vi.fn(), { publisher: review.publisher, app: review.app, version: review.version });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Preview release" }));
  const dialog = await screen.findByRole("dialog", { name: "Review installation" });
  const copies = within(dialog).queryByRole("combobox", { name: "Update an existing copy" }) as HTMLSelectElement | null;
  if (update) expect(copies?.value).toBe("older-copy");
  else expect(copies).toBeNull();
  expect(upgrade).not.toHaveBeenCalled();
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

test("an installed package selection supersedes an earlier pending file import", async () => {
  let complete!: (release: Awaited<ReturnType<typeof miniApps.localPackage>>) => void;
  vi.mocked(miniApps.releases).mockResolvedValue({ packages: [{ id: "installed", digest: "installed", origin: "local", package: review }] });
  vi.spyOn(miniApps, "localPackage").mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  show("packages", vi.fn());
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "New instance" });
  await user.upload(screen.getByLabelText("Choose a Mini App package"), new File([JSON.stringify(inbox)], "inbox.coveapp", { type: "application/json" }));
  await waitFor(() => expect(miniApps.localPackage).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "New instance" }));
  const dialog = await screen.findByRole("dialog", { name: "Review installation" });
  expect(within(dialog).getByRole("textbox", { name: "App name" })).toHaveProperty("value", "Review book");
  await act(async () => { complete({ id: "late-import", digest: "late-import", origin: "local", package: inbox }); });
  expect(within(screen.getByRole("dialog", { name: "Review installation" })).getByRole("textbox", { name: "App name" })).toHaveProperty("value", "Review book");
});
