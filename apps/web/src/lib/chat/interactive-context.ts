import type { CardSubmission } from "@cove/api-contract";

export type PreparedCardReference = CardSubmission & { release?: () => void };

// Window-local callback bridge. The card controller remains the sole draft owner.
const controllers = new Map<
  string,
  Map<string, () => Promise<PreparedCardReference>>
>();
const references = new Map<
  string,
  { owner: string; source: string; included: boolean }
>();
export function registerCardController(
  source: string,
  token: string,
  prepare: () => Promise<PreparedCardReference>,
) {
  const entries = controllers.get(source) ?? new Map();
  entries.set(token, prepare);
  controllers.set(source, entries);
  return () => {
    entries.delete(token);
    if (!entries.size && controllers.get(source) === entries)
      controllers.delete(source);
  };
}
export function setComposerCard(
  conversation: string,
  owner: string,
  source: string,
  included: boolean,
) {
  references.set(conversation, { owner, source, included });
  return () => {
    if (references.get(conversation)?.owner === owner)
      references.delete(conversation);
  };
}
export function hasComposerCard(conversation: string) {
  return Boolean(references.get(conversation)?.included);
}
export async function prepareComposerCard(
  conversation: string,
): Promise<PreparedCardReference | undefined> {
  const reference = references.get(conversation);
  if (!reference?.included) return;
  const prepare = controllers.get(reference.source)?.values().next().value;
  if (!prepare)
    throw new Error(
      "Wait for the current card to load, or remove its reference before sending.",
    );
  const prepared = await prepare();
  if (references.get(conversation) !== reference || !reference.included) {
    prepared.release?.();
    throw new Error(
      "The card reference changed while preparing. Review your message before sending again.",
    );
  }
  return { ...prepared, intent: "discuss" };
}
