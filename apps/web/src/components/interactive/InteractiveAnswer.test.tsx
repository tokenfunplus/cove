// @vitest-environment jsdom
import { useInteractiveDraftWarning } from "@/lib/chat/interactive-drafts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseCard, type CardRun } from "@cove/api-contract";
import normalization from "../../../../../packages/api-contract/fixtures/interactive-normalization.json";
import fixtures from "../../../../../packages/api-contract/fixtures/interactive-cards.json";
import * as api from "@/api/interactive";
import { InteractiveAnswer } from "./InteractiveAnswer";
vi.mock("@/api/interactive", () => ({
  loadInteractiveCard: vi.fn(),
  saveInteractiveCard: vi.fn(),
}));
let backend: CardRun;
function mount(onContinue = vi.fn(), overrideContent?: string) {
  return {
    onContinue,
    ...render(
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
        <InteractiveAnswer
          generationId="gen"
          content={
            overrideContent ??
            "A scene.\n```" +
              backend.definition.version +
              "\n" +
              JSON.stringify(backend.definition) +
              "\n```"
          }
          busy={false}
          onContinue={onContinue}
          destination="Fixture / model"
        />
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  backend = {
    generation_id: "gen",
    definition: parseCard(fixtures.valid[1].source),
    values: { next_action: "" },
    checks: {},
    revision: 0,
    can_continue: true,
  };
  vi.mocked(api.loadInteractiveCard).mockImplementation(async () =>
    structuredClone(backend),
  );
  vi.mocked(api.saveInteractiveCard).mockImplementation(async (input) => {
    backend = {
      ...backend,
      values: input.values,
      checks: input.checks,
      revision: input.revision + 1,
    };
    return structuredClone(backend);
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
test("checks locally, clears stale feedback, and shares values with expanded view", async () => {
  const user = userEvent.setup();
  const { onContinue } = mount();
  await user.click(
    await screen.findByRole("radio", { name: "Examine the abandoned radio" }),
  );
  await user.click(screen.getByRole("button", { name: "Check answer" }));
  expect(await screen.findByText("The radio was recently used.")).toBeTruthy();
  expect(onContinue).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("radio", { name: "Follow the footprints" }),
  );
  expect(screen.queryByText("The radio was recently used.")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Expand" }));
  expect(
    screen
      .getByRole("radio", { name: "Follow the footprints" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(api.saveInteractiveCard).toHaveBeenCalled());
});
test("flushes the current revision before continuing and restores saved selections on remount", async () => {
  const user = userEvent.setup();
  const first = mount();
  await user.click(
    await screen.findByRole("radio", { name: "Examine the abandoned radio" }),
  );
  await user.click(screen.getByRole("button", { name: "Continue story" }));
  await waitFor(() => expect(first.onContinue).toHaveBeenCalled());
  expect(first.onContinue.mock.calls[0][0]).toMatchObject({
    generation_id: "gen",
    revision: 1,
    values: { next_action: "radio" },
  });
  first.unmount();
  mount();
  expect(
    (
      await screen.findByRole("radio", { name: "Examine the abandoned radio" })
    ).getAttribute("aria-checked"),
  ).toBe("true");
});
test("keeps a conflicting draft and prevents model continuation until save succeeds", async () => {
  vi.mocked(api.saveInteractiveCard).mockRejectedValue(
    new Error("Card changed in another window."),
  );
  const user = userEvent.setup();
  const { onContinue } = mount();
  await user.click(
    await screen.findByRole("radio", { name: "Examine the abandoned radio" }),
  );
  await user.click(screen.getByRole("button", { name: "Continue story" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Card changed in another window.",
  );
  expect(onContinue).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("radio", { name: "Examine the abandoned radio" })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

test("pending saves and optional questions participate in the leave-draft guard", async () => {
  const user = userEvent.setup();
  let resolveSave!: (run: CardRun) => void;
  vi.mocked(api.saveInteractiveCard).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  mount();
  render(<DirtyProbe />);
  await user.click(
    await screen.findByRole("radio", { name: "Examine the abandoned radio" }),
  );
  await waitFor(() => expect(api.saveInteractiveCard).toHaveBeenCalled());
  expect(screen.getByLabelText("Unsaved interaction").textContent).toBe(
    "unsaved",
  );
  backend = { ...backend, values: { next_action: "radio" }, revision: 1 };
  await act(async () => resolveSave(structuredClone(backend)));
  await waitFor(() =>
    expect(screen.getByLabelText("Unsaved interaction").textContent).toBe(
      "saved",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Ask about this" }));
  await user.type(
    screen.getByLabelText("Question about these choices"),
    "Explain this clue",
  );
  expect(screen.getByLabelText("Unsaved interaction").textContent).toBe(
    "unsaved",
  );
  await user.click(screen.getByRole("button", { name: "Remove question" }));
  expect(screen.getByLabelText("Unsaved interaction").textContent).toBe(
    "saved",
  );
});

function DirtyProbe() {
  const dirty = useInteractiveDraftWarning();
  return (
    <output aria-label="Unsaved interaction">
      {dirty ? "unsaved" : "saved"}
    </output>
  );
}

test("an empty required choice gives actionable feedback and focuses the choice without saving or generating", async () => {
  const user = userEvent.setup();
  const { onContinue } = mount();
  await user.click(
    await screen.findByRole("button", { name: "Continue story" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Choose an option before continuing.",
  );
  expect(
    screen.queryByText("Interactive card is invalid or unsupported."),
  ).toBeNull();
  expect(api.saveInteractiveCard).not.toHaveBeenCalled();
  expect(onContinue).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole("radio", { name: "Follow the footprints" }),
  );
  await user.click(
    screen.getByRole("radio", { name: "Examine the abandoned radio" }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Continue story" }));
  await waitFor(() => expect(onContinue).toHaveBeenCalled());
});

test("required-choice feedback focuses the active expanded view", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Expand" }));
  await user.click(screen.getByRole("button", { name: "Continue story" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Choose an option before continuing.",
  );
  expect(document.activeElement).toBe(
    screen.getByRole("radio", { name: "Follow the footprints" }),
  );
});

test("a multi-choice limit keeps the last valid selection instead of saving invalid state", async () => {
  backend.definition = parseCard(fixtures.valid[3].source);
  backend.definition.stateSchema.next_action.maxItems = 1;
  backend.values = { next_action: [] };
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole("checkbox", { name: "Follow the footprints" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Examine the abandoned radio" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Choose at most 1 option for this group.",
  );
  expect(
    screen
      .getByRole("checkbox", { name: "Examine the abandoned radio" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  for (const [request] of vi.mocked(api.saveInteractiveCard).mock.calls)
    expect(request.values.next_action).toEqual(["footprints"]);
});

function useRichFixture(name = "playground") {
  backend.definition = parseCard(
    fixtures.valid.find((f) => f.name === name)!.source,
  );
  backend.values = structuredClone(backend.definition.spec.state);
}
test("ranking buttons and drag/drop save the same complete order", async () => {
  useRichFixture("ranking");
  const user = userEvent.setup();
  const { onContinue } = mount();
  await user.click(
    await screen.findByRole("button", {
      name: "Move Explore a small gallery up",
    }),
  );
  expect(screen.getAllByRole("listitem").map((e) => e.textContent)).toEqual([
    expect.stringContaining("Walk by the river"),
    expect.stringContaining("Explore a small gallery"),
    expect.stringContaining("Lunch with a friend"),
  ]);
  const items = screen.getAllByRole("listitem");
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(items[1], { dataTransfer });
  fireEvent.dragOver(items[0], { dataTransfer });
  fireEvent.drop(items[0], { dataTransfer });
  await user.click(screen.getByRole("button", { name: "Use my changes" }));
  await waitFor(() => expect(onContinue).toHaveBeenCalled());
  expect(onContinue.mock.calls[0][0].values.order).toEqual([
    "gallery",
    "walk",
    "lunch",
  ]);
});
test("slider keyboard changes update the linked allocation immediately and persist zero", async () => {
  useRichFixture("allocation");
  const user = userEvent.setup();
  const { onContinue } = mount();
  const slider = await screen.findByRole("slider", { name: "Food" });
  slider.focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByLabelText("Food value").textContent).toContain("35");
  expect(screen.getByLabelText("Weekend budget balance").textContent).toContain(
    "45",
  );
  await user.keyboard("{Home}");
  expect(screen.getByLabelText("Weekend budget balance").textContent).toContain(
    "80",
  );
  expect(onContinue).not.toHaveBeenCalled();
  await waitFor(() => expect(backend.values.food).toBe(0));
  await user.keyboard("{End}");
  expect(screen.getByLabelText("Weekend budget balance").textContent).toContain(
    "Over by 20",
  );
  await user.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByLabelText("Weekend budget balance").textContent).toContain(
    "50",
  );
});
test("text preview is escaped, supports undo/redo across expansion, and restores on remount", async () => {
  useRichFixture("editor");
  const user = userEvent.setup();
  const first = mount();
  const editor = await screen.findByRole("textbox", {
    name: "Invitation text",
  });
  fireEvent.change(editor, { target: { value: "<script>sample</script>" } });
  const preview = screen.getByRole("region", { name: "Invitation preview" });
  expect(preview.textContent).toContain("<script>sample</script>");
  expect(preview.querySelector("script")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Expand" }));
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    (
      screen.getByRole("textbox", {
        name: "Invitation text",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Join me for a slow Saturday afternoon.");
  await user.click(screen.getByRole("button", { name: "Redo" }));
  await waitFor(() =>
    expect(backend.values.draft).toBe("<script>sample</script>"),
  );
  first.unmount();
  mount();
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "Invitation text",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe("<script>sample</script>");
});
test("required text blocks continuation and focuses its editor", async () => {
  useRichFixture("editor");
  const user = userEvent.setup();
  const { onContinue } = mount();
  const editor = await screen.findByRole("textbox", {
    name: "Invitation text",
  });
  fireEvent.change(editor, { target: { value: "   " } });
  await user.click(screen.getByRole("button", { name: "Use my changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Fill in the required text before continuing.",
  );
  expect(document.activeElement).toBe(editor);
  expect(onContinue).not.toHaveBeenCalled();
});
test("all rich controls lock after submission while previews remain readable", async () => {
  useRichFixture();
  backend.submitted_batch_id = "submitted";
  backend.can_continue = false;
  mount();
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "Invitation text",
      })) as HTMLTextAreaElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "Move Explore a small gallery up" }),
  ).toBeNull();
  expect(
    screen.getByRole("slider", { name: "Food" }).getAttribute("aria-disabled"),
  ).toBe("true");
  expect(
    screen.getByRole("region", { name: "Invitation preview" }).textContent,
  ).toContain("Join me");
  expect(
    (
      screen.getByRole("button", {
        name: "Use my changes",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
test("text edits honor code point limits without splitting Unicode", async () => {
  useRichFixture("editor");
  mount();
  const editor = await screen.findByRole("textbox", {
    name: "Invitation text",
  });
  fireEvent.change(editor, { target: { value: "\u{1f30d}".repeat(401) } });
  expect([...(editor as HTMLTextAreaElement).value].length).toBe(400);
});

test("discarding a failed text save also clears its local undo history", async () => {
  useRichFixture("editor");
  vi.mocked(api.saveInteractiveCard).mockRejectedValue(
    new Error("Could not save this card."),
  );
  const user = userEvent.setup();
  mount();
  const editor = await screen.findByRole("textbox", {
    name: "Invitation text",
  });
  fireEvent.change(editor, { target: { value: "An unsaved revision" } });
  await screen.findByRole("alert");
  await user.click(
    screen.getByRole("button", { name: "Reload and discard local changes" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "Invitation text",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Join me for a slow Saturday afternoon."),
  );
  expect(
    (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
});
test("mixed required fields give guidance matching the focused control", async () => {
  useRichFixture();
  backend.definition.stateSchema.next = {
    type: "string",
    enum: ["", "yes", "no"],
  };
  backend.values.next = "";
  backend.definition.spec.state.next = "";
  backend.definition.spec.elements.extra = {
    type: "Choice",
    props: {
      label: "Want company?",
      value: { $bindState: "/next" },
      mode: "single",
      required: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    children: [],
  };
  backend.definition.spec.elements.card.children.unshift("extra");
  (
    backend.definition.spec.elements.continue.on!.press.params.paths as string[]
  ).push("/next");
  const user = userEvent.setup();
  mount();
  const editor = await screen.findByRole("textbox", {
    name: "Invitation text",
  });
  fireEvent.change(editor, { target: { value: "" } });
  await user.click(screen.getByRole("button", { name: "Use my changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Complete the required fields before continuing.",
  );
  expect(document.activeElement?.getAttribute("role")).toBe("radio");
});

test("a question can discuss an incomplete card without claiming a completed choice", async () => {
  const user = userEvent.setup();
  const { onContinue } = mount();
  await user.click(
    await screen.findByRole("button", { name: "Ask about this" }),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Question about these choices" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Question about these choices" }),
    "Explain the options",
  );
  await user.click(screen.getByRole("button", { name: "Continue story" }));
  await waitFor(() => expect(onContinue).toHaveBeenCalled());
  expect(onContinue.mock.calls[0][0]).toMatchObject({
    intent: "discuss",
    values: { next_action: "" },
  });
  expect(onContinue.mock.calls[0][1]).toBe("Explain the options");
});
test("a failed card retains readable escaped fallback text", async () => {
  backend.definition.fallback = "<script>A readable fallback</script>";
  vi.mocked(api.loadInteractiveCard).mockRejectedValue(
    new Error("Unsupported card"),
  );
  const { container } = mount();
  expect(
    await screen.findByText("<script>A readable fallback</script>"),
  ).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryByRole("radio")).toBeNull();
});
test("a fenced code example is displayed without attempting card materialization", async () => {
  mount(
    vi.fn(),
    "````markdown\n```cove-card-v1\n" +
      fixtures.valid[0].source +
      "\n```\n````",
  );
  expect(api.loadInteractiveCard).not.toHaveBeenCalled();
  expect(screen.queryByRole("radio")).toBeNull();
});

test("local-only recall supports reveal without a Continue prerequisite", async () => {
  const f = normalization.find((f) => f.name === "local-only reveal")!;
  backend.definition = parseCard(JSON.stringify(f.canonical));
  backend.values = {};
  backend.can_continue = false;
  const user = userEvent.setup();
  const { onContinue } = mount();
  await user.click(
    await screen.findByRole("button", { name: "Reveal answer" }),
  );
  expect(await screen.findByText("A happy accident.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(screen.queryByText(/belongs to an earlier/)).toBeNull();
  expect(onContinue).not.toHaveBeenCalled();
});

test.each(["single", "multiple"] as const)(
  "missing %s choice labels use readable prompts rather than internal bindings",
  async (mode) => {
    if (mode === "multiple") {
      backend.definition = parseCard(fixtures.valid[3].source);
      backend.values = structuredClone(backend.definition.spec.state);
    }
    const choice = Object.values(backend.definition.spec.elements).find(
      (element) => element.type === "Choice",
    )!;
    delete choice.props.label;
    mount();
    const label =
      mode === "single" ? "Choose an option" : "Choose any that apply";
    expect(await screen.findByRole("group", { name: label })).toBeTruthy();
    if (mode === "single")
      expect(screen.getByRole("radiogroup", { name: label })).toBeTruthy();
    expect(screen.queryByText("next action")).toBeNull();
  },
);
