// @vitest-environment jsdom

import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MiniAppPackage } from "@cove/api-contract";
import { PublicAppPreview } from "./AppPackagePreview";

afterEach(cleanup);

test("the package preview illustrates declared sample content instead of rendering raw fields", () => {
  const pkg: MiniAppPackage = {
    format: 1,
    publisher: "studio",
    app: "review",
    name: "Review book",
    version: "1.0.0",
    schema_version: 1,
    capabilities: ["records.query"],
    collections: {
      cards: {
        fields: {
          prompt: "text",
          answer: "text",
          due: "date",
          archived: "bool",
        },
      },
    },
    actions: {
      due: {
        title: "Due cards",
        op: "query",
        collection: "cards",
        surfaces: ["page"],
        reveal_field: "answer",
      },
    },
    pages: [{ id: "daily", title: "Daily practice", actions: ["due"] }],
    seed: {
      cards: [
        {
          prompt: "A sample question",
          answer: "A sample answer",
          due: "2026-11-27",
          archived: false,
        },
      ],
    },
  };
  render(<PublicAppPreview pkg={pkg} name={pkg.name} />);
  expect(screen.getByText("A sample question")).toBeTruthy();
  expect(screen.getByText("Example")).toBeTruthy();
  expect(screen.getByText("Reveal answer")).toBeTruthy();
  expect(screen.queryByText("A sample answer")).toBeNull();
  expect(screen.queryByText("archived")).toBeNull();
  expect(screen.queryByText("false")).toBeNull();
  expect(screen.queryByText("2026-11-27")).toBeNull();
});
