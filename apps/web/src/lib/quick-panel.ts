export const quickPanelFocusEvent = "cove-quick-panel-focus";
export const quickPanelSessionEvent = "cove-quick-panel-session";
export const quickPanelImportEvent = "cove-quick-panel-import";
export const quickPanelDialogSelector = '[data-slot="dialog-content"][data-state="open"], dialog[open]';
export const quickPanelMenuSelector = '[role="menu"][data-state="open"]';

type QuickPanelMessage =
  | { action: "ready" | "escape" | "reauthorize" | "open-provider-settings" }
  | { action: "import-consumed" | "import-rejected"; id: string }
  | { action: "resize"; height: number }
  | { action: "open-chat"; conversationId?: string };

export function postQuickPanelMessage(message: QuickPanelMessage) {
  const nativeWindow = window as Window & {
    webkit?: { messageHandlers?: { coveQuickPanel?: { postMessage: (message: QuickPanelMessage) => void } } };
  };
  nativeWindow.webkit?.messageHandlers?.coveQuickPanel?.postMessage(message);
}
