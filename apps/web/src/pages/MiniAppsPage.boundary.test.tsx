// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { miniApps } from "@/api/mini-apps";
import MiniAppsPage from "./MiniAppsPage";

vi.mock("@/api/hooks/useSession", () => ({
  useLocalSession: () => ({ isSuccess: true }),
}));
vi.mock("@/hooks/use-mini-app-scroll", () => ({
  useMiniAppScroll: () => ({}),
}));

beforeEach(() => {
  vi.spyOn(miniApps, "instances").mockResolvedValue({ instances: [] });
  vi.spyOn(miniApps, "releases").mockResolvedValue({ packages: [] });
  vi.spyOn(miniApps, "catalog").mockResolvedValue({ packages: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(path = "/apps") {
  window.history.replaceState(null, "", path);
  return render(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })}>
      <MiniAppsPage attach={vi.fn()} />
    </QueryClientProvider>,
  );
}

test.each(["/apps", "/apps?section=catalog&app=cove%2Freview&version=1.0.0"])(
  "the local workspace at %s links to CoveWeb without a market or directory read",
  async (path) => {
    show(path);
    await screen.findByRole("heading", { name: "Your apps, your space." });
    expect(screen.queryByRole("link", { name: "App catalog" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discover" })).toBeNull();
    const links = screen.getAllByRole("link", { name: "Browse apps on CoveWeb" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("https://www.hicove.io/apps");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer");
    }
    expect(miniApps.catalog).not.toHaveBeenCalled();
  },
);

test("workspace search opens local tools without offering a local market", async () => {
  show();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Search workspace" }));
  await screen.findByRole("dialog");
  expect(screen.getByRole("button", { name: /^My apps/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Discover apps/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Close search" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(miniApps.catalog).not.toHaveBeenCalled();
});

test("the public install deep link remains available without exposing a market", async () => {
  show("/apps/install/cove/review?version=1.0.0");
  await screen.findByRole("region", { name: "Install from CoveWeb" });
  expect(miniApps.catalog).toHaveBeenCalledOnce();
  expect(screen.queryByRole("heading", { name: "App catalog" })).toBeNull();
  expect(screen.queryByRole("link", { name: "App catalog" })).toBeNull();
  expect(screen.getByRole("link", { name: "View app on CoveWeb" }).getAttribute("href"))
    .toBe("https://www.hicove.io/apps/cove/review?version=1.0.0");
});
