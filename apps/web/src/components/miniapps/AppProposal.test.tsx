// @vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MiniAppPackage } from "@cove/api-contract";
import { request } from "@/api/client";
import { AppProposal } from "./AppProposal";

vi.mock("@/api/client", () => ({ request: vi.fn() }));
vi.mock("@/api/hooks/useProviders", () => ({
  useProviders: () => ({
    data: [
      {
        id: "local",
        name: "Local",
        kind: "local",
        endpoint: "http://worker",
        configured: true,
      },
      {
        id: "remote",
        name: "Cloud",
        kind: "compatible",
        endpoint: "https://model.example/v1",
        configured: true,
        runtime_location: "remote",
      },
      {
        id: "loopback",
        name: "Loopback",
        kind: "compatible",
        endpoint: "http://127.0.0.1:11434/v1",
        configured: true,
        runtime_location: "local",
      },
    ],
    isSuccess: true,
  }),
  providerCatalogQueryOptions: (id: string) => ({
    queryKey: ["models", id],
    enabled: !!id,
    queryFn: async () => ({ models: ["model-1"] }),
  }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test("proposal model choices follow the instance cloud grant while retaining loopback access", async () => {
  const pkg: MiniAppPackage = {
    format: 1,
    publisher: "author",
    app: "notes",
    name: "Notes",
    description: "Notes",
    schema_version: 1,
    version: "1.0.0",
    capabilities: ["records.commit"],
    collections: {},
    pages: [],
    actions: {
      add: {
        title: "Add note",
        op: "create",
        inputs: { text: "text" },
        surfaces: ["panel"],
      },
    },
  };
  const client = new QueryClient();
  const instance = {
    id: "book",
    release_id: "r",
    enabled: true,
    revision: 1,
    grants: ["records.commit"],
    name: "Notes",
    cloud_enabled: true,
  };
  vi.mocked(request).mockResolvedValue(null);
  const view = (cloudEnabled: boolean) => (
    <QueryClientProvider client={client}>
      <AppProposal
        instance={{ ...instance, cloud_enabled: cloudEnabled }}
        pkg={pkg}
        actions={["add"]}
        surface="panel"
        localRequired={false}
        choose={vi.fn()}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view(true));
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Ask a model to propose an action" }),
  );
  expect(screen.queryByRole("option", { name: "Cloud · remote" })).toBeNull();
  await user.click(screen.getByLabelText("Only on this Mac"));
  expect(screen.getByRole("option", { name: "Cloud · remote" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Loopback · local" })).toBeTruthy();
  rerender(view(false));
  expect(screen.queryByRole("option", { name: "Cloud · remote" })).toBeNull();
  expect(screen.getByRole("option", { name: "Loopback · local" })).toBeTruthy();
});

test("sends only chosen action names and opens a suggestion for editing on request", async () => {
  const pkg: MiniAppPackage = {
    format: 1,
    publisher: "author",
    app: "notes",
    name: "Notes",
    description: "Notes",
    schema_version: 1,
    version: "1.0.0",
    capabilities: ["records.commit"],
    collections: {},
    pages: [],
    actions: {
      add: {
        title: "Add note",
        op: "create",
        inputs: { text: "text" },
        surfaces: ["panel"],
      },
      save: {
        title: "Save bookmark",
        op: "create",
        inputs: { url: "text" },
        surfaces: ["panel"],
      },
    },
  };
  const choose = vi.fn();
  const user = userEvent.setup();
  const endpoint = "/api/mini-apps/instances/book/proposals";
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path === endpoint + "?surface=panel") return null;
    if (path === endpoint && options?.method === "POST") {
      expect(JSON.parse(options.body as string)).toMatchObject({
        actions: ["add"],
        question: "Save tea",
        surface: "panel",
        modelId: "model-1",
        localOnly: true,
      });
      return { id: "job", state: "running" };
    }
    if (path === endpoint + "/job")
      return {
        id: "job",
        state: "completed",
        result: JSON.stringify({ action: "add", inputs: { text: "tea" } }),
      };
    throw new Error("unexpected request: " + path);
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppProposal
        instance={{
          id: "book",
          release_id: "r",
          enabled: true,
          revision: 1,
          grants: ["records.commit"],
          name: "Notes",
        }}
        pkg={pkg}
        actions={["add", "save"]}
        surface="panel"
        localRequired={true}
        choose={choose}
      />
    </QueryClientProvider>,
  );
  await user.click(
    screen.getByRole("button", { name: "Ask a model to propose an action" }),
  );
  await user.click(screen.getByLabelText("Add note"));
  await user.type(
    screen.getByLabelText("What would you like to do?"),
    "Save tea",
  );
  await user.selectOptions(screen.getByLabelText("Model provider"), "local");
  await screen.findByRole("option", { name: "model-1" });
  await user.selectOptions(
    screen.getByLabelText("Model", { exact: true }),
    "model-1",
  );
  await user.click(screen.getByRole("button", { name: "Request suggestion" }));
  const edit = await screen.findByRole("button", {
    name: "Review suggested action",
  });
  expect(choose).not.toHaveBeenCalled();
  await user.click(edit);
  expect(choose).toHaveBeenCalledWith("add", { text: "tea" });
});

test("a suggestion waiting for storage is saved through the task endpoint without a new proposal", async () => {
  const pkg: MiniAppPackage = {
    format: 1,
    publisher: "author",
    app: "notes",
    name: "Notes",
    schema_version: 1,
    version: "1.0.0",
    capabilities: ["records.commit"],
    collections: {},
    pages: [],
    actions: {
      add: {
        title: "Add note",
        op: "create",
        inputs: { text: "text" },
        surfaces: ["panel"],
      },
    },
  };
  let saved = false;
  const endpoint = "/api/mini-apps/instances/book/proposals";
  const task = () => ({
    id: "waiting",
    state: saved ? "completed" : "save_failed",
    pending_save: !saved,
    result: JSON.stringify({ action: "add", inputs: { text: "Frozen note" } }),
  });
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path === endpoint + "?surface=panel" || path === endpoint + "/waiting")
      return task();
    if (
      path === "/api/mini-apps/instances/book/tasks/waiting/retry-save" &&
      options?.method === "POST"
    ) {
      saved = true;
      return undefined;
    }
    throw new Error("Unexpected request: " + path);
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AppProposal
        instance={{
          id: "book",
          release_id: "r",
          enabled: true,
          revision: 1,
          grants: ["records.commit"],
          name: "Notes",
        }}
        pkg={pkg}
        actions={["add"]}
        surface="panel"
        localRequired={false}
        choose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Ask a model to propose an action" }),
  );
  const retry = await screen.findByRole("button", {
    name: "Retry saving result",
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Request suggestion",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "Review suggested action" }),
  ).toBeNull();
  await user.click(retry);
  await screen.findByRole("button", { name: "Review suggested action" });
  const posts = vi
    .mocked(request)
    .mock.calls.filter(([, options]) => options?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toBe(
    "/api/mini-apps/instances/book/tasks/waiting/retry-save",
  );
  expect(screen.getByText("Frozen note")).toBeTruthy();
});


test("a live activity refresh clears an obsolete proposal admission error", async () => {
  const pkg: MiniAppPackage = { format: 1, publisher: "author", app: "notes", name: "Notes", schema_version: 1, version: "1.0.0", capabilities: ["records.commit"], collections: {}, pages: [], actions: { add: { title: "Add note", op: "create", inputs: { text: "text" }, surfaces: ["panel"] } } };
  const endpoint = "/api/mini-apps/instances/book/proposals";
  let submissions = 0;
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path === endpoint + "?surface=panel") return null;
    if (path === endpoint && options?.method === "POST") {
      submissions++;
      throw { envelope: { error: { code: "task_save_pending" } } };
    }
    if (path === "/api/mini-apps/activity?limit=100") return { activity: [{ instance_name: "Other app", status: "save_failed" }] };
    throw new Error("Unexpected request: " + path);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><AppProposal instance={{ id: "book", release_id: "r", enabled: true, revision: 1, grants: ["records.commit"], name: "Notes" }} pkg={pkg} actions={["add"]} surface="panel" localRequired choose={vi.fn()} /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Ask a model to propose an action" }));
  await user.click(screen.getByLabelText("Add note"));
  await user.type(screen.getByLabelText("What would you like to do?"), "Keep this question");
  await user.selectOptions(screen.getByLabelText("Model provider"), "local");
  await screen.findByRole("option", { name: "model-1" });
  await user.selectOptions(screen.getByLabelText("Model", { exact: true }), "model-1");
  await user.click(screen.getByRole("button", { name: "Request suggestion" }));
  await screen.findByText(/A result from Other app is waiting/);
  act(() => client.setQueryData(["mini-app-host-activity"], { activity: [] }));
  await waitFor(() => expect(screen.queryByRole("link", { name: "Open Activity" })).toBeNull());
  expect(submissions).toBe(1);
  expect((screen.getByLabelText("What would you like to do?") as HTMLTextAreaElement).value).toBe("Keep this question");
});
