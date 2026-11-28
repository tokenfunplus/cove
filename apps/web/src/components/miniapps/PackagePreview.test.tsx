// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppInstance, MiniAppPackage } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { PackagePreview } from "./AppInstallPreview";

const pkg: MiniAppPackage = {
  publisher: "studio",
  app: "book",
  name: "Reading book",
  version: "1.1.0",
  format: 1,
  schema_version: 1,
  capabilities: ["records.query", "ai.generate"],
  actions: {},
  pages: [],
  collections: {},
};
const first: MiniAppInstance = {
  id: "first",
  name: "First book",
  release_id: "old",
  revision: 3,
  enabled: true,
  grants: ["records.query"],
};
const second: MiniAppInstance = {
  ...first,
  id: "second",
  name: "Second book",
  grants: ["ai.generate"],
};

function show(previous: MiniAppInstance[], targetInstance?: MiniAppInstance) {
  const cache = new QueryClient();
  const content = (copies: MiniAppInstance[], target?: MiniAppInstance) => (
    <QueryClientProvider client={cache}>
      <PackagePreview
        pkg={pkg}
        previous={copies}
        targetInstance={target}
        versions={{ old: "1.0.0" }}
        source={{
          kind: "local",
          raw: "fixture",
          origin: "local",
          release_id: "fixture-preview",
          digest: "fixture",
        }}
        close={vi.fn()}
        open={vi.fn()}
      />
    </QueryClientProvider>
  );
  const view = render(content(previous, targetInstance));
  return (copies: MiniAppInstance[], target?: MiniAppInstance) =>
    view.rerender(content(copies, target));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a file import defaults to the existing instance and preserves its grant choices", async () => {
  const install = vi.spyOn(miniApps, "localPackage").mockResolvedValue({
    id: "new",
    digest: "fixture",
    origin: "local",
    package: pkg,
  });
  const update = vi
    .spyOn(miniApps, "upgrade")
    .mockResolvedValue({ ...first, release_id: "new" });
  const create = vi.spyOn(miniApps, "create");
  show([first]);
  await userEvent.setup().click(screen.getByText("More access"));
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  expect(select.value).toBe("first");
  expect(select.selectedOptions[0].textContent).toContain(
    "First book · 1.0.0 → 1.1.0",
  );
  expect(
    (screen.getByRole("checkbox", { name: "Use AI tools" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(install).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Update to 1.1.0" }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(first, "new", ["records.query"], false),
  );
  expect(install).toHaveBeenCalledWith("fixture", "install", {
    id: "fixture-preview",
    digest: "fixture",
  });
  expect(create).not.toHaveBeenCalled();
});

test("multiple copies require a choice and changing target resets permission selection", async () => {
  show([first, second]);
  const user = userEvent.setup();
  await user.click(screen.getByText("More access"));
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  const model = screen.getByRole("checkbox", {
    name: "Use AI tools",
  }) as HTMLInputElement;
  expect(select.selectedOptions[0].textContent).toContain("Choose a copy");
  await user.selectOptions(select, second.id);
  expect(model.checked).toBe(true);
  await user.selectOptions(select, first.id);
  expect(model.checked).toBe(false);
  await user.selectOptions(select, "");
  expect(screen.getByRole("textbox", { name: "App name" })).toBeTruthy();
  expect(
    screen
      .getAllByRole("checkbox")
      .every((box) => !(box as HTMLInputElement).checked),
  ).toBe(true);
});

test("new installs make core access clear and keep optional access off until selected", async () => {
  vi.spyOn(miniApps, "localPackage").mockResolvedValue({
    id: "new",
    digest: "fixture",
    origin: "local",
    package: pkg,
  });
  const create = vi
    .spyOn(miniApps, "create")
    .mockResolvedValue({ ...first, release_id: "new" });
  show([]);
  const user = userEvent.setup();
  expect(screen.getByRole("textbox", { name: "App name" })).toBeTruthy();
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Read saved items",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(
    screen.getByRole("checkbox", { name: "Use AI tools" }).closest("details")
      ?.open,
  ).toBe(false);
  expect(
    screen
      .getByRole("button", { name: "Install package only" })
      .closest("details")?.open,
  ).toBe(false);
  await user.click(screen.getByText("More access"));
  expect(
    (screen.getByRole("checkbox", { name: "Use AI tools" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  const cloud = screen.getByRole("checkbox", {
    name: "Allow cloud models",
  }) as HTMLInputElement;
  expect(cloud.checked).toBe(false);
  await user.click(screen.getByRole("checkbox", { name: "Use AI tools" }));
  expect(cloud.checked).toBe(false);
  await user.click(screen.getByRole("button", { name: "Install app" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      "new",
      pkg.name,
      ["ai.generate"],
      false,
    ),
  );
});

test("switching from an updated copy to a new copy resets cloud permission", async () => {
  show([{ ...first, cloud_enabled: true }]);
  const user = userEvent.setup();
  await user.click(screen.getByText("More access"));
  const cloud = screen.getByRole("checkbox", {
    name: "Allow cloud models",
  }) as HTMLInputElement;
  expect(cloud.checked).toBe(true);
  await user.selectOptions(screen.getByRole("combobox"), "");
  expect(cloud.checked).toBe(false);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Read saved items",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
});

test.each(["directory", "settings"])(
  "%s updates require a new review after permissions change",
  async (surface) => {
    const allowed = {
      ...first,
      grants: [...pkg.capabilities],
      cloud_enabled: true,
    };
    const revoked = {
      ...allowed,
      revision: allowed.revision + 1,
      grants: [],
      cloud_enabled: false,
    };
    const install = vi.spyOn(miniApps, "localPackage").mockResolvedValue({
      id: "new",
      digest: "fixture",
      origin: "local",
      package: pkg,
    });
    const update = vi.spyOn(miniApps, "upgrade").mockResolvedValue(revoked);
    const refresh = surface === "settings" ? show([], allowed) : show([allowed]);
    const user = userEvent.setup();
    await user.click(screen.getByText("More access"));
    const model = screen.getByRole("checkbox", {
      name: "Use AI tools",
    }) as HTMLInputElement;
    const cloud = screen.getByRole("checkbox", {
      name: "Allow cloud models",
    }) as HTMLInputElement;
    expect(model.checked).toBe(true);
    expect(cloud.checked).toBe(true);

    if (surface === "settings") refresh([], revoked);
    else refresh([revoked]);
    const apply = screen.getByRole("button", { name: "Update to 1.1.0" });
    expect(apply.matches(":disabled")).toBe(true);
    await user.click(apply);
    expect(install).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Review current copy" }),
    );
    expect(model.checked).toBe(false);
    expect(cloud.checked).toBe(false);
    expect(apply.matches(":disabled")).toBe(false);
    await user.click(apply);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(revoked, "new", [], false),
    );
  },
);

test("removing the reviewed target blocks an update and a separate copy resets access", async () => {
  const install = vi.spyOn(miniApps, "localPackage").mockResolvedValue({
    id: "new",
    digest: "fixture",
    origin: "local",
    package: pkg,
  });
  const update = vi.spyOn(miniApps, "upgrade");
  const create = vi.spyOn(miniApps, "create").mockResolvedValue(first);
  const refresh = show([{ ...first, cloud_enabled: true }]);
  const user = userEvent.setup();
  refresh([]);
  const apply = screen.getByRole("button", { name: "Update to 1.1.0" });
  expect(apply.matches(":disabled")).toBe(true);
  await user.click(apply);
  expect(install).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Review current copy" })).toBeNull();
  await user.selectOptions(screen.getByRole("combobox"), "");
  await user.click(screen.getByRole("button", { name: "Install app" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith("new", pkg.name, [], false),
  );
  expect(update).not.toHaveBeenCalled();
});

test("a manual target switch reviews the latest copy instead of reusing previous choices", async () => {
  const latest = { ...second, revision: 9, grants: [], cloud_enabled: false };
  vi.spyOn(miniApps, "localPackage").mockResolvedValue({
    id: "new",
    digest: "fixture",
    origin: "local",
    package: pkg,
  });
  const update = vi.spyOn(miniApps, "upgrade").mockResolvedValue(latest);
  const refresh = show([first, { ...second, cloud_enabled: true }]);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox"), second.id);
  refresh([first, latest]);
  expect(
    screen.getByRole("button", { name: "Update to 1.1.0" }).matches(":disabled"),
  ).toBe(true);
  await user.selectOptions(screen.getByRole("combobox"), first.id);
  await user.selectOptions(screen.getByRole("combobox"), second.id);
  await user.click(screen.getByRole("button", { name: "Update to 1.1.0" }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(latest, "new", [], false),
  );
});

test("an in-flight package install keeps the approved revision and access together", async () => {
  let finishInstall!: (
    value: Awaited<ReturnType<typeof miniApps.localPackage>>,
  ) => void;
  vi.spyOn(miniApps, "localPackage").mockImplementation(
    () =>
      new Promise((resolve) => {
        finishInstall = resolve;
      }),
  );
  const update = vi
    .spyOn(miniApps, "upgrade")
    .mockRejectedValue(
      new Error("The reviewed copy changed. Review the installation again."),
    );
  const allowed = { ...first, cloud_enabled: true };
  const refresh = show([allowed]);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Update to 1.1.0" }));
  await waitFor(() => expect(finishInstall).toBeDefined());
  refresh([{ ...first, revision: 4, grants: [], cloud_enabled: false }]);
  await act(async () =>
    finishInstall({
      id: "new",
      digest: "fixture",
      origin: "local",
      package: pkg,
    }),
  );
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(allowed, "new", ["records.query"], true),
  );
  await screen.findByText(
    "The reviewed copy changed. Review the installation again.",
  );
});

test("an installation dialog locks all close controls until settlement, then restores close and focus", async () => {
  let rejectInstall!: (error: Error) => void;
  vi.spyOn(miniApps, "localPackage").mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectInstall = reject;
      }),
  );
  const create = vi.spyOn(miniApps, "create");
  const closed = vi.fn();
  function Preview() {
    const [visible, setVisible] = useState(false);
    return (
      <>
        <button onClick={() => setVisible(true)}>Review app</button>
        {visible && (
          <PackagePreview
            dialog
            pkg={pkg}
            previous={[]}
            source={{
              kind: "local",
              raw: "fixture",
              origin: "local",
              release_id: "fixture-preview",
              digest: "fixture",
            }}
            close={() => {
              closed();
              setVisible(false);
            }}
            open={vi.fn()}
          />
        )}
      </>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Preview />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Review app" });
  await user.click(trigger);
  await screen.findByRole("dialog", { name: "Review installation" });
  await user.click(screen.getByRole("button", { name: "Install app" }));
  const close = screen.getByRole("button", {
    name: "Close dialog",
  }) as HTMLButtonElement;
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(close.disabled).toBe(true);
  expect(cancel.matches(":disabled")).toBe(true);
  await user.click(close);
  await user.click(cancel);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(closed).not.toHaveBeenCalled();
  await act(async () =>
    rejectInstall(new Error("Package storage unavailable")),
  );
  await screen.findByText("Package storage unavailable");
  expect(close.disabled).toBe(false);
  expect(cancel.matches(":disabled")).toBe(false);
  expect(create).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(closed).toHaveBeenCalledOnce();
  await user.click(trigger);
  await screen.findByRole("dialog");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
