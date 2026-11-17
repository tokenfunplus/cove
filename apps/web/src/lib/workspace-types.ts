export type ConnectionState = "loading" | "ready" | "unavailable";

export type ConversationNavigation = { conversationId: string; messageId: string; requestId: string };

export type ConfirmationRequest = {
  kind: "switch" | "new" | "navigate" | "delete" | "clear";
  conversationId?: string;
  discardDraft?: boolean;
  stopGeneration?: boolean;
  messageId?: string;
  navigationAction?: () => Promise<void>;
};
