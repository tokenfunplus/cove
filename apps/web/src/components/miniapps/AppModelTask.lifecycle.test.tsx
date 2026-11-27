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
import { LocalServiceError } from "@/api/client";
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
test("an unsaved result blocks new generation and retries only the retained save", async () => {
  let saved = false;
  const waiting: AppTask = {
    ...running,
    browser: false,
    state: "save_failed",
    pending_save: true,
    result: "Frozen model result",
    inputs: { passage: "Paid input" },
  };
  const current = () =>
    saved
      ? { ...waiting, state: "completed" as const, pending_save: false }
      : waiting;
  vi.spyOn(miniApps, "tasks").mockImplementation(async () => ({
    tasks: [current()],
  }));
  vi.spyOn(miniApps, "task").mockImplementation(async () => current());
  const retry = vi
    .spyOn(miniApps, "retryTaskSave")
    .mockImplementation(async () => {
      saved = true;
    });
  const start = vi.spyOn(miniApps, "startTask");
  form();
  const button = await screen.findByRole("button", {
    name: "Retry saving result",
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Start model task",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(button);
  await screen.findByText("Task completed");
  await screen.findByText("Frozen model result");
  expect(retry).toHaveBeenCalledExactlyOnceWith("book", "task");
  expect(start).not.toHaveBeenCalled();
  expect(startVerifiedAppTask).not.toHaveBeenCalled();
});
test("a pending save in another app directs recovery to Activity without retrying admission", async () => {
  vi.spyOn(miniApps, "tasks").mockResolvedValue({ tasks: [] });
  const start = vi
    .spyOn(miniApps, "startTask")
    .mockRejectedValue(
      new LocalServiceError({
        error: {
          code: "task_save_pending",
          message: "Another app has a pending save.",
          details: null,
          request_id: "fixture",
        },
      }),
    );
  form();
  fireEvent.click(screen.getByRole("button", { name: "Start model task" }));
  const recovery = await screen.findByRole("link", { name: "Open Mini Apps" });
  expect(recovery.getAttribute("href")).toBe("cove://apps");
  expect(screen.getByText(/choose Activity and retry saving/)).toBeTruthy();
  expect(start).toHaveBeenCalledOnce();
  expect(startVerifiedAppTask).not.toHaveBeenCalled();
});
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

test("candidate checks isolate invalid and duplicate rows while valid candidates remain selectable", async () => {
  const job: AppTask = {
    ...running,
    state: "completed",
    result:
      '[{"question":"One","answer":"A"},{"question":"Two","answer":"B"},{"question":"Needs editing","answer":"Bad value"}]',
  };
  vi.spyOn(miniApps, "tasks").mockResolvedValue({ tasks: [job] });
  vi.spyOn(miniApps, "task").mockResolvedValue({
    ...job,
    inputs: { passage: "Saved input" },
  });
  const check = vi.spyOn(miniApps, "checkCandidates").mockResolvedValue({
    duplicates: [1],
    invalid: [{ index: 2, message: "Review this candidate before saving it." }],
  });
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
          grants: ["records.query", "records.commit"],
        }}
        actionId="study"
        action={{
          title: "Create cards",
          op: "generate",
          inputs: { passage: "text" },
          surfaces: ["page"],
        }}
        inputs={{ passage: "Current text" }}
        surface="page"
        localRequired={false}
        candidate={{
          title: "Save",
          op: "create",
          inputs: { question: "text", answer: "text" },
          surfaces: ["page"],
        }}
        previewCandidates={vi.fn()}
        choose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText("Recent tasks"), {
    target: { value: "task" },
  });
  await waitFor(() => expect(check).toHaveBeenCalled());
  await screen.findByText(
    "1 candidate is already saved or repeated in this result.",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Use candidate 1",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(
    (
      screen.getByRole("button", {
        name: "Use candidate 2",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Select candidate 2") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Select candidate 1") as HTMLInputElement).disabled,
  ).toBe(false);
  expect(
    (screen.getByLabelText("Select candidate 3") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Use candidate 3",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(
    screen.getByText("Review this candidate before saving it."),
  ).toBeDefined();
  fireEvent.click(screen.getByLabelText("Select candidate 1"));
  expect(
    (
      screen.getByRole("button", {
        name: "Preview selected (1)",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(
    screen.getByText("Select up to 50 candidates for one save."),
  ).toBeDefined();
});

test("a candidate save can select fifty rows and explains the limit", async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    question: "Question " + index,
    answer: "Answer " + index,
  }));
  const job: AppTask = {
    ...running,
    state: "completed",
    result: JSON.stringify(rows),
  };
  vi.spyOn(miniApps, "tasks").mockResolvedValue({ tasks: [job] });
  vi.spyOn(miniApps, "task").mockResolvedValue({
    ...job,
    inputs: { passage: "Saved input" },
  });
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
          inputs: { passage: "text" },
          surfaces: ["page"],
        }}
        inputs={{ passage: "Current text" }}
        surface="page"
        localRequired={false}
        candidate={{
          title: "Save",
          op: "create",
          inputs: { question: "text", answer: "text" },
          surfaces: ["page"],
        }}
        previewCandidates={vi.fn()}
        choose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText("Recent tasks"), {
    target: { value: "task" },
  });
  await screen.findByLabelText("Select candidate 51");
  for (let index = 1; index <= 50; index++)
    fireEvent.click(screen.getByLabelText("Select candidate " + index));
  expect(
    (screen.getByLabelText("Select candidate 51") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Preview selected (50)",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(
    screen.getByText("Select up to 50 candidates for one save."),
  ).toBeDefined();
});
