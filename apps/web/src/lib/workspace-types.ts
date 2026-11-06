export type ConnectionState = "loading" | "ready" | "unavailable";

export type ConfirmationRequest = {
  kind: "switch" | "delete" | "clear";
  conversationId?: string;
};
