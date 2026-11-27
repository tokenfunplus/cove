// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  await user.click(await screen.findByRole("button", { name: "Get app" }));
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
