import { type PrivateConnectionProgressState } from "@/components/verification/PrivateConnectionProgress";
import { type ConfirmationRequest } from "@/lib/workspace-types";
import { type ConversationNavigation } from "@/lib/workspace-types";
import {
  type Conversation,
  type ConversationView,
  type Project,
  type ProjectContextPreview,
  type VerificationEvidence,
} from "@cove/api-contract";
import { useCallback, useEffect, useState } from "react";
import { useHistoryFilters } from "@/hooks/conversations/use-history-filters";

export type WorkspaceFeedback = {
  message: string;
  tone: "error" | "info" | "success";
};

export function useWorkspaceUi() {
  const history = useHistoryFilters();
  const [conversationSearchQuery, setConversationSearchQuery] = useState("");
  const [conversationNavigation, setConversationNavigation] = useState<ConversationNavigation>();
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  const [feedback, updateFeedback] = useState<WorkspaceFeedback>();
  const setFeedback = useCallback(
    (message?: string, tone: WorkspaceFeedback["tone"] = "error") => {
      updateFeedback(message ? { message, tone } : undefined);
    },
    [],
  );

  const [workspaceVerification, setWorkspaceVerification] = useState<{
    kind: "model" | "gateway";
    evidence: VerificationEvidence;
  }>();

  const [privateConnectionProgress, setPrivateConnectionProgress] =
    useState<PrivateConnectionProgressState>();

  const [localOnly, setLocalOnly] = useState(false);
  const [privacyStatusOpen, setPrivacyStatusOpen] = useState(false);

  const [isClearingChatData, setIsClearingChatData] = useState(false);

  const [projectDrafts, setProjectDrafts] = useState<Record<string, string>>({});
  const [projectPage, setProjectPage] = useState<{ projectId?: string }>();
  const [projectMoveTarget, setProjectMoveTarget] = useState<Conversation>();
  const [projectEditor, setProjectEditor] = useState<Project | null>();
  const [projectRemoval, setProjectRemoval] = useState<{ project: Project; deleteConversations: boolean }>();
  const [projectContextPreview, setProjectContextPreview] = useState<ProjectContextPreview>();

  const [settingsEntry, setSettingsEntry] = useState<"general" | "provider" | "web-search" | "local-models" | "chat-data" | "network">();
  const [localCapabilityEntry, setLocalCapabilityEntry] = useState<{tab:"installed"|"discover"|"speech";purpose?:"speak";modelId?:string}>();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [focusMode, setFocusMode] = useState(false);
  const enterFocusMode = useCallback(() => {
    setMobileSidebarOpen(false);
    setFocusMode(true);
  }, []);
  const exitFocusMode = useCallback(() => setFocusMode(false), []);

  useEffect(() => {
    if (!focusMode) return;
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }
      // A dialog or popup gets the first Escape, including during its dismissal.
      if (
        (event.target instanceof Element &&
          event.target.closest(
            '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]',
          )) ||
        document.querySelector(
          '[data-slot="dialog-content"][data-state="open"], dialog[open]',
        )
      ) {
        return;
      }
      event.preventDefault();
      exitFocusMode();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [focusMode, exitFocusMode]);

  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();
  const [isNavigating, setIsNavigating] = useState(false);

  const [showingArchived, setShowingArchived] = useState(false);

  const [renameTarget, setRenameTarget] = useState<Conversation>();

  const [downloadTarget, setDownloadTarget] = useState<ConversationView>();

  return {
    ...history,
    conversationSearchQuery,
    setConversationSearchQuery,
    conversationNavigation,
    setConversationNavigation,
    isSavingTitle,
    setIsSavingTitle,
    feedback,
    setFeedback,
    workspaceVerification,
    setWorkspaceVerification,
    privateConnectionProgress,
    setPrivateConnectionProgress,
    localOnly, setLocalOnly,
    privacyStatusOpen,
    setPrivacyStatusOpen,
    isClearingChatData,
    setIsClearingChatData,
    projectPage,
    setProjectPage,
    projectDrafts,
    setProjectDrafts,
    projectMoveTarget,
    setProjectMoveTarget,
    projectEditor,
    setProjectEditor,
    projectRemoval,
    setProjectRemoval,
    projectContextPreview,
    setProjectContextPreview,
    settingsEntry,
    setSettingsEntry,
    localCapabilityEntry, setLocalCapabilityEntry,
    sidebarCollapsed,
    setSidebarCollapsed,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    focusMode,
    enterFocusMode,
    exitFocusMode,
    confirmation,
    setConfirmation,
    isNavigating,
    setIsNavigating,
    showingArchived,
    setShowingArchived,
    renameTarget,
    setRenameTarget,
    downloadTarget,
    setDownloadTarget,
  };
}

export type WorkspaceUi = ReturnType<typeof useWorkspaceUi>;
