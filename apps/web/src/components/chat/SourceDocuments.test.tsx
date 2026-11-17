// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SourceDocuments } from "@/components/chat/SourceDocuments";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { createWorkspaceFixture } from "@/test/workspace-fixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("only citations with an existing document and section open saved source text", async () => {
  const batch = createWorkspaceFixture().completedBatch;
  const id = "a".repeat(64);
  batch.attachments = [
    {
      id,
      name: "notes.md",
      media_type: "text/plain",
      size: 15,
      characters: 15,
      extraction_version: "cove-text-v1",
      sections: [
        { id: "L1", text: "First line" },
        { id: "L2", text: "Quoted line" },
      ],
    },
  ];
  render(
    <SourceDocuments batches={[batch]}>
      <MarkdownMessage
        content={`[Notes, line 2](cove:${id}:L2) and [Missing page](cove:${id}:P9). Code: \`[Code](cove:${id}:L1)\`.`}
      />
    </SourceDocuments>,
  );
  expect(screen.queryByRole("button", { name: "Missing page" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Code" })).toBeNull();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Notes, line 2" }));
  const dialog = screen.getByRole("dialog", { name: "notes.md" });
  expect(within(dialog).getByText("Quoted line")).toBeTruthy();
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  await user.click(within(dialog).getByRole("button", { name: "Download original file" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    `/api/generation-batches/${batch.id}/attachments/${id}`,
    expect.objectContaining({ redirect: "error" }),
  ));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});
