import type { MiniAppInstance, MiniAppRecord } from "@cove/api-contract";
import { isConversationId } from "@/lib/launcher-intent";

export function appBookmark(id: string, view: string) {
  return (
    "cove://open/" + encodeURIComponent(id) + "/" + encodeURIComponent(view)
  );
}
export function snapshot(
  instance: MiniAppInstance,
  action: string,
  view: string,
  rows: MiniAppRecord[],
) {
  return (
    "Reference from " +
    instance.name +
    " (" +
    action +
    ")\n" +
    appBookmark(instance.id, view) +
    "\n" +
    JSON.stringify(
      rows.map(({ id, revision, fields }) => ({ id, revision, fields })),
      null,
      2,
    )
  );
}

// A user can edit the snapshot before sending it. Only reconstruct a local
// navigation intent; no text from the snapshot can authorize a host command.
export function miniAppSources(body: string) {
  const sources = new Map<string, string>();
  const header = /^Reference from ([\s\S]{1,100}?) \([A-Za-z][A-Za-z0-9_.]{0,79}\)\ncove:\/\/open\/([a-f0-9-]{36})\/([a-z][a-z0-9-]{0,47})\n(?=\[\n  \{)/gm;
  for (const [, name, id, view] of body.matchAll(header)) {
    if (isConversationId(id)) sources.set(appBookmark(id, view), name);
  }
  return sources;
}
