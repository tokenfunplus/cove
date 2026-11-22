import { useQuery } from "@tanstack/react-query";
import { getProject, projectKeys } from "@/api/projects";
import type { AttachmentDraft } from "@/hooks/chat/use-attachment-draft";

export function ProjectInputSummary({
  id,
  attachments,
}: {
  id: string;
  attachments?: AttachmentDraft;
}) {
  const query = useQuery({
    queryKey: [...projectKeys, id],
    queryFn: () => getProject(id),
    retry: false,
  });
  const p = query.data;
  if (!p)
    return (
      <p className="mb-2 text-xs text-muted-foreground">
        {query.isError
          ? "Project context is unavailable. Review context before sending."
          : "Loading project context…"}
      </p>
    );
  const turn = attachments?.attachments ?? [];
  const remainingSlots = 4 - p.sources.length - turn.length;
  const remainingCharacters =
    120000 -
    p.sources.reduce((n, s) => n + s.snapshot.characters, 0) -
    turn.reduce((n, a) => n + (a.snapshot?.characters ?? 0), 0);
  return (
    <div
      className="mb-2 text-xs text-muted-foreground"
      aria-label="Active project input"
    >
      <details>
        <summary className="cursor-pointer select-none">
          Project context · {p.sources.length}{" "}
          {p.sources.length === 1 ? "source" : "sources"}
        </summary>
        <div className="space-y-1 pb-1 pt-2">
          <p>
            {p.name} · {Math.max(0, remainingSlots)} attachment slots and{" "}
            {Math.max(0, remainingCharacters).toLocaleString()} source
            characters remaining.
          </p>
          <p>
            Instructions, background and fixed sources go to every selected
            model. Review context for exact input and destinations.
          </p>
        </div>
      </details>
      {(remainingSlots < 0 || remainingCharacters < 0) && (
        <p role="alert">
          Project sources and turn attachments exceed the shared limit. Remove
          an attachment or edit the project sources.
        </p>
      )}
    </div>
  );
}
