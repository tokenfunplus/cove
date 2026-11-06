import { type KeyboardEvent } from "react";

export function shouldSubmitComposerKey(
  event: Pick<KeyboardEvent<HTMLTextAreaElement>, "key" | "shiftKey"> & {
    isComposing?: boolean;
  },
): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
