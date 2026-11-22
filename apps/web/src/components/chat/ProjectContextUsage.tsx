import type {
  ContextUsage,
  GenerationContextMessage,
  ProjectContext,
} from "@cove/api-contract";
import { projectSystemPrompt } from "@/lib/chat/project-context";

export function ProjectContextUsage({
  project,
  base = "",
  body = "",
  history = [],
  usage,
  preview = false,
}: {
  project?: ProjectContext | null;
  base?: string;
  body?: string;
  history?: Pick<GenerationContextMessage, "content">[];
  usage?: ContextUsage;
  preview?: boolean;
}) {
  const count = (s: string) => Array.from(s).length;
  const instructions = count(projectSystemPrompt(base, project));
  const background = count(project?.background ?? "");
  const sources = count(project?.reference_prefix ?? "") - background;
  const historical = history.reduce((n, m) => n + count(m.content), 0),
    question = count(body);
  const measured = usage ?? {
    instructions,
    background,
    sources,
    history: historical,
    question,
    total: instructions + background + sources + historical + question,
    limit: 240000,
  };
  return (
    <div
      className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs"
      aria-label="Context usage"
    >
      <strong>
        {measured.total.toLocaleString()} / {measured.limit.toLocaleString()}{" "}
        characters
      </strong>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.entries({
          Instructions: measured.instructions,
          Background: measured.background,
          "Project sources and reference framing": measured.sources,
          History: measured.history,
          "Question and turn attachments": measured.question,
        }).map(([name, n]) => (
          <div key={name}>
            <dt className="text-muted-foreground">{name}</dt>
            <dd>{n.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {project && (
        <p>
          {project.project_name} · {preview ? "preview" : "saved"} project
          revision {project.project_revision}. This input is sent to every
          selected model. Sources are reference data.
        </p>
      )}
      {measured.total > measured.limit && (
        <p role="alert">
          Context limit exceeded. Reduce project input or continue your draft in
          a new conversation.
        </p>
      )}
    </div>
  );
}
