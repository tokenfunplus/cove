// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import { afterEach, test, expect, vi } from "vitest";
import { miniApps, type AppTask } from "@/api/mini-apps";
import {
  startVerifiedAppTask,
  stopVerifiedAppTask,
} from "@/lib/inference/mini-app-task";
import { AppModelTask } from "./AppModelTask";

vi.mock("@/lib/inference/mini-app-task", () => ({
  startVerifiedAppTask: vi.fn(async () => {}),
  stopVerifiedAppTask: vi.fn(),
}));
vi.mock("./AppModelTarget", () => ({
  AppModelTarget: () => null,
  useAppModelTarget: () => ({
    profile: {
      id: "nearai",
      name: "Test provider",
      endpoint: "https://fixture.example",
    },
    model: "fixture",
    policyLocal: false,
    profiles: {},
    catalog: {},
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const running: AppTask = {
  id: "task",
  action: "study",
  modelId: "fixture",
  state: "running",
  browser: true,
};
function form() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <AppModelTask
        instance={{
          id: "book",
          name: "My book",
          enabled: true,
          revision: 1,
          release_id: "v1",
          grants: ["ai.generate"],
        }}
        actionId="study"
        action={{
          title: "Create cards",
          op: "generate",
          inputs: { passage: "text" },
          surfaces: ["page"],
        }}
        inputs={{ passage: "New text" }}
        surface="page"
        localRequired={false}
        previewCandidates={() => {}}
        choose={() => {}}
      />
    </QueryClientProvider>,
  );
}
test("starts the authorized browser job if the form closes before admission returns", async () => {
  vi.spyOn(miniApps, "tasks").mockResolvedValue({ tasks: [] });
  let resolveAdmission!: (value: AppTask) => void;
  const admission = new Promise<AppTask>((resolve) => {
    resolveAdmission = resolve;
  });
  vi.spyOn(miniApps, "startTask").mockReturnValue(admission);
  const cancel = vi.spyOn(miniApps, "cancel");
  const page = form();
  fireEvent.click(screen.getByRole("button", { name: "Start model task" }));
  await waitFor(() => expect(miniApps.startTask).toHaveBeenCalledOnce());
  page.unmount();
  await act(async () => {
    resolveAdmission(running);
    await admission;
  });
  expect(startVerifiedAppTask).toHaveBeenCalledWith("book", "task");
  expect(stopVerifiedAppTask).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});
test("transient polling failures preserve the running task and display its frozen input", async () => {
  vi.spyOn(miniApps, "tasks").mockResolvedValue({ tasks: [running] });
  vi.spyOn(miniApps, "task")
    .mockRejectedValueOnce(new Error("Brief disconnect"))
    .mockResolvedValue({ ...running, inputs: { passage: "Submitted text" } });
  form();
  await screen.findByText("Submitted text", {}, { timeout: 4000 });
  expect(stopVerifiedAppTask).not.toHaveBeenCalled();
  expect(screen.queryByText("New text")).toBeNull();
});
test("a newly opened form does not show candidates from a completed task", async () => {
  vi.spyOn(miniApps, "tasks").mockResolvedValue({
    tasks: [{ ...running, state: "completed", result: "Old answer" }],
  });
  form();
  await screen.findByText("Recent tasks");
  expect(screen.queryByText("Old answer")).toBeNull();
  expect(screen.queryByRole("region", { name: "Model result" })).toBeNull();
});

test("historical candidates wait for their frozen inputs before saving", async () => {
  const old: AppTask = {
    ...running,
    state: "completed",
    result: '[{"question":"One","answer":"Answer"}]',
  };
  vi.spyOn(miniApps, "tasks").mockResolvedValue({ tasks: [old] });
  let complete!: (value: AppTask) => void;
  const details = new Promise<AppTask>((resolve) => {
    complete = resolve;
  });
  vi.spyOn(miniApps, "task").mockReturnValue(details);
  const choose = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AppModelTask
        instance={{
          id: "book",
          name: "Book",
          release_id: "r",
          enabled: true,
          revision: 1,
          grants: ["records.commit"],
        }}
        actionId="study"
        action={{
          title: "Create cards",
          op: "generate",
          inputs: { passage: "text", source: "text" },
          candidate_bindings: { source: "source" },
          defaults: { source: "" },
          surfaces: ["page"],
        }}
        inputs={{ passage: "Current text", source: "" }}
        surface="page"
        localRequired={false}
        candidate={{
          title: "Save",
          op: "create",
          inputs: { question: "text", answer: "text", source: "text" },
          surfaces: ["page"],
        }}
        previewCandidates={vi.fn()}
        choose={choose}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText("Recent tasks"), {
    target: { value: "task" },
  });
  expect(screen.queryByRole("button", { name: "Use candidate 1" })).toBeNull();
  await act(async () => {
    complete({
      ...old,
      inputs: { passage: "Saved text", source: "material-id" },
    });
    await details;
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Use candidate 1" }),
  );
  expect(choose).toHaveBeenCalledWith({
    question: "One",
    answer: "Answer",
    source: "material-id",
  });
});
