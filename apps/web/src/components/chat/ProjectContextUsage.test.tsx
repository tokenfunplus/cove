// @vitest-environment jsdom
import { expect, test } from "vitest";
import { render, within, cleanup } from "@testing-library/react";
import { ProjectContextUsage } from "./ProjectContextUsage";

test("raw background and reference framing partition the assembled Unicode input", () => {
  const background = 'A line\n"quoted"\\path \u{1f680}';
  const reference_prefix =
    "Reference data:\n" +
    JSON.stringify({ background, sources: [] }) +
    "\nQuestion:\n";
  const project = {
    project_id: "project",
    project_revision: 1,
    membership_revision: 0,
    project_name: "Saved",
    rendering_version: 1,
    instructions: "Rule",
    background,
    reference_prefix,
    sources: [],
    background_characters: 999999,
  };
  const { container } = render(
    <ProjectContextUsage
      project={project}
      base="Base"
      body="Question"
      history={[{ content: "History" }]}
    />,
  );
  const backgroundItem =
    within(container).getByText("Background").parentElement!;
  expect(backgroundItem.querySelector("dd")?.textContent).toBe(
    String(Array.from(background).length),
  );
  const sum = [...container.querySelectorAll("dd")].reduce(
    (n, item) => n + Number(item.textContent?.replaceAll(",", "")),
    0,
  );
  const expected = Array.from(
    "Base\n\nProject instructions:\nRule" +
      reference_prefix +
      "QuestionHistory",
  ).length;
  expect(sum).toBe(expected);
  expect(container.querySelector("strong")?.textContent).toContain(
    String(expected),
  );
  cleanup();
});
