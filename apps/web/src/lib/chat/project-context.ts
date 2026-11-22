import type { ProjectContext } from "@cove/api-contract";
export function projectSystemPrompt(
  base: string,
  project?: ProjectContext | null,
) {
  if (!project?.instructions) return base;
  return base
    ? `${base}\n\nProject instructions:\n${project.instructions}`
    : project.instructions;
}
export function projectUserInput(
  body: string,
  project?: ProjectContext | null,
) {
  return (project?.reference_prefix ?? "") + body;
}
export function projectSources(project?: ProjectContext | null) {
  return project?.sources.map((item) => item.snapshot) ?? [];
}
