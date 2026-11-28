// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import type { MiniAppPackage } from "@cove/api-contract";
import {
  AppRecordFields,
  fieldLabel,
  recordPrimaryField,
} from "./AppRecordFields";

afterEach(cleanup);

test("shows content and a concealed answer while keeping all metadata inspectable", async () => {
  render(
    <AppRecordFields
      primary="front"
      reveal="back"
      fields={{
        back: "Hidden answer",
        front: "Study this sentence",
        due: "2030-01-04",
        archived: false,
        attempts: 2,
      }}
    />,
  );
  expect(screen.getByText("Study this sentence").tagName).toBe("P");
  const reveal = screen.getByText("Show back").closest("details")!;
  const metadata = screen.getByText("Record details").closest("details")!;
  expect(reveal.open).toBe(false);
  expect(metadata.open).toBe(false);
  expect(screen.queryByText("false")).toBeNull();
  await userEvent.click(screen.getByText("Show back"));
  expect(reveal.open).toBe(true);
  await userEvent.click(screen.getByText("Record details"));
  expect(metadata.open).toBe(true);
  expect(screen.getByText("No")).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
});

test("write review expands proposed metadata and preserves every value", () => {
  render(
    <AppRecordFields
      expanded
      fields={{ text: "A saved note", count: 0, active: false, empty: "" }}
    />,
  );
  expect(screen.getByText("Record details").closest("details")!.open).toBe(
    true,
  );
  expect(screen.getByText("A saved note")).toBeTruthy();
  expect(screen.getByText("0")).toBeTruthy();
  expect(screen.getByText("No")).toBeTruthy();
  expect(screen.getByText("—")).toBeTruthy();
});

test("the concealed field never becomes the visible heading", () => {
  render(
    <AppRecordFields
      fields={{ answer: "Do not reveal yet" }}
      primary="answer"
      reveal="answer"
    />,
  );
  const answer = screen.getByText("Do not reveal yet");
  expect(answer.closest("details")!.open).toBe(false);
  expect(screen.getAllByText("Do not reveal yet")).toHaveLength(1);
});

test("derives primary content from package declarations without matching an app identity", () => {
  const pkg: MiniAppPackage = {
    format: 1,
    publisher: "third-party",
    app: "sessions",
    name: "Sessions",
    version: "1.0.0",
    schema_version: 1,
    capabilities: [],
    collections: {
      items: { fields: { prompt: "text", response: "text", label: "text" } },
    },
    pages: [
      {
        id: "practice",
        title: "Practice",
        actions: ["due"],
        practice: {
          query: "due",
          front: "prompt",
          back: "response",
          outcomes: ["score"],
        },
      },
    ],
    actions: {
      due: {
        title: "Due",
        op: "query",
        collection: "items",
        surfaces: ["page"],
      },
      score: {
        title: "Score",
        op: "update",
        collection: "items",
        surfaces: ["page"],
      },
    },
  };
  expect(recordPrimaryField(pkg, "items")).toBe("prompt");
  pkg.collections.items.title_field = "response";
  expect(recordPrimaryField(pkg, "items")).toBe("prompt");
  delete pkg.collections.items.title_field;
  pkg.pages = [];
  pkg.actions.due.order_by = "label";
  expect(recordPrimaryField(pkg, "items")).toBe("prompt");
  pkg.collections.items.title_field = "label";
  expect(recordPrimaryField(pkg, "items")).toBe("label");
  expect(fieldLabel("nextReviewDate")).toBe("Next Review Date");
});
