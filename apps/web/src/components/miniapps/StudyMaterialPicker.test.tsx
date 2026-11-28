// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type {
  MiniAppPackage,
  MiniAppAction,
  MiniAppFields,
} from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { StudyMaterialPicker } from "./StudyMaterialPicker";
const action: MiniAppAction = {
  title: "Generate",
  op: "generate",
  surfaces: ["page"],
  defaults: { source: "", passage: "" },
  selection_inputs: {
    collection: "materials",
    fields: { source: "$id", passage: "passage" },
  },
};
const pkg: MiniAppPackage = {
  format: 1,
  publisher: "author",
  app: "book",
  name: "Book",
  version: "1.0.0",
  schema_version: 1,
  capabilities: [],
  pages: [],
  collections: {
    materials: {
      fields: {
        title: "text",
        passage: "text",
        due: "date",
        score: "number",
        approved: "bool",
      },
    },
  },
  actions: {
    list: {
      title: "Materials",
      op: "query",
      surfaces: ["page"],
      collection: "materials",
      order_by: "title",
      inputs: {},
    },
  },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function ControlledPicker({
  action: configuredAction,
  choose,
}: {
  action: MiniAppAction;
  choose: (values: MiniAppFields) => void;
}) {
  const [inputs, setInputs] = useState<MiniAppFields>({});
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <StudyMaterialPicker
        instance={{
          id: "book",
          release_id: "release",
          name: "Book",
          revision: 1,
          enabled: true,
          grants: ["records.query"],
        }}
        pkg={pkg}
        action={configuredAction}
        surface="page"
        inputs={inputs}
        choose={(values) => {
          choose(values);
          setInputs(values);
        }}
      />
    </QueryClientProvider>
  );
}

test("keeps a chosen material selected without an id binding, including duplicate mapped values", async () => {
  vi.spyOn(miniApps, "invoke").mockResolvedValue({
    records: [
      {
        id: "first",
        revision: 1,
        fields: { title: "First lesson", passage: "Shared passage" },
      },
      {
        id: "second",
        revision: 1,
        fields: { title: "Second lesson", passage: "Shared passage" },
      },
    ],
  });
  const choose = vi.fn();
  render(
    <ControlledPicker
      action={{
        ...action,
        selection_inputs: {
          collection: "materials",
          fields: { passage: "passage" },
        },
      }}
      choose={choose}
    />,
  );
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Second lesson" });
  const select = screen.getByLabelText("Source material") as HTMLSelectElement;
  await user.selectOptions(select, "second");
  expect(select.value).toBe("second");
  expect(choose).toHaveBeenLastCalledWith({ passage: "Shared passage" });
  await user.selectOptions(select, "");
  expect(select.value).toBe("");
  expect(choose).toHaveBeenLastCalledWith({ passage: "" });
});

test("returning to pasted material resolves date defaults and preserves input types", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 28, 12));
  vi.spyOn(miniApps, "invoke").mockResolvedValue({
    records: [
      {
        id: "dated",
        revision: 1,
        fields: {
          title: "Dated lesson",
          passage: "Saved passage",
          due: "2027-01-01",
          score: 4,
          approved: true,
        },
      },
    ],
  });
  const choose = vi.fn();
  render(
    <ControlledPicker
      action={{
        ...action,
        inputs: {
          source: "text",
          passage: "text",
          due: "date",
          score: "number",
          approved: "bool",
        },
        defaults: { source: "", passage: "", due: "$today+2" },
        selection_inputs: {
          collection: "materials",
          fields: {
            source: "$id",
            passage: "passage",
            due: "due",
            score: "score",
            approved: "approved",
          },
        },
      }}
      choose={choose}
    />,
  );
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Dated lesson" });
  const select = screen.getByLabelText("Source material") as HTMLSelectElement;
  await user.selectOptions(select, "dated");
  expect(select.value).toBe("dated");
  await user.selectOptions(select, "");
  expect(select.value).toBe("");
  expect(choose).toHaveBeenLastCalledWith({
    source: "",
    passage: "",
    due: "2026-11-30",
    score: 0,
    approved: false,
  });
});
test("selects a source from a later page and passes its stable id and actual passage", async () => {
  vi.spyOn(miniApps, "invoke")
    .mockResolvedValueOnce({
      records: [
        {
          id: "first",
          revision: 1,
          fields: { title: "First lesson", passage: "First passage" },
        },
      ],
      next_cursor: "more",
    })
    .mockResolvedValueOnce({
      records: [
        {
          id: "second",
          revision: 3,
          fields: { title: "Second lesson", passage: "Second passage" },
        },
      ],
    });
  const choose = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <StudyMaterialPicker
        instance={{
          id: "book",
          release_id: "release",
          name: "Book",
          revision: 1,
          enabled: true,
          grants: ["records.query"],
        }}
        pkg={pkg}
        action={action}
        surface="page"
        inputs={{}}
        choose={choose}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Load more materials" }),
  );
  await screen.findByRole("option", { name: "Second lesson" });
  await user.selectOptions(screen.getByLabelText("Source material"), "second");
  expect(choose).toHaveBeenLastCalledWith({
    source: "second",
    passage: "Second passage",
  });
});
