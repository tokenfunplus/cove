import type { MiniAppFields, MiniAppInvocation } from "@cove/api-contract";

function sortedFields(fields: MiniAppFields) {
  return Object.fromEntries(
    Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** Bind a conversation proposal to one operation across remounts and retries. */
export async function proposalOperationId(
  generation: string,
  instance: string,
  release: string,
  initial: MiniAppFields,
  command: MiniAppInvocation,
) {
  const changes = Object.fromEntries(
    Object.entries(command.inputs ?? {}).filter(
      ([name, value]) => value !== initial[name],
    ),
  );
  const payload = JSON.stringify([
    "conversation-app-proposal-v1",
    generation,
    instance,
    release,
    command.action,
    sortedFields(changes),
    command.items?.map(sortedFields),
    command.records?.map((record) => record.id).sort(),
  ]);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return (
    "chat_" +
    Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}
