import { expect, test } from "vitest";
import { projectSystemPrompt, projectUserInput } from "./project-context";
import type { ProjectContext } from "@cove/api-contract";

test("project input composes one user turn without changing the replayable question", () => {
  const question = "Current question";
  const saved: ProjectContext = {
    project_id: "project",
    project_revision: 2,
    membership_revision: 1,
    project_name: "Research",
    rendering_version: 1,
    instructions: "Original project instruction",
    background: "Reference only",
    reference_prefix:
      'Project reference data: {"background":"Reference only"}\nCurrent user question:\n',
    sources: [],
  };
  const serialized = JSON.stringify(saved);
  expect(projectSystemPrompt("New base instruction", saved)).toBe(
    "New base instruction\n\nProject instructions:\nOriginal project instruction",
  );
  expect(projectUserInput(question, saved)).toContain("Reference only");
  expect(projectUserInput(question, saved).endsWith(question)).toBe(true);
  expect(question).toBe("Current question");
  expect(JSON.stringify(saved)).toBe(serialized);
  expect(projectUserInput(question)).toBe(question);
  expect(projectSystemPrompt("Base")).toBe("Base");
});
