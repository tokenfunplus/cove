export type ConnectionState = "loading" | "ready" | "unavailable";

export type ConversationNavigation = { conversationId: string; messageId: string; requestId: string };

export type ConfirmationRequest = {
  kind: "switch" | "new" | "navigate" | "delete" | "clear";
  projectId?: string;
  initialDraft?: string;
  conversationId?: string;
  discardDraft?: boolean;
  stopGeneration?: boolean;
  messageId?: string;
  navigationAction?: () => Promise<void>;
};
