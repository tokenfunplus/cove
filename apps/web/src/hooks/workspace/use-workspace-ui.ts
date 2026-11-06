import { type PrivateConnectionProgressState } from "@/components/verification/PrivateConnectionProgress";
import { type ConfirmationRequest } from "@/lib/workspace-types";
import {
  type Conversation,
  type ConversationView,
  type VerificationEvidence,
} from "@cove/api-contract";
import { useCallback, useState } from "react";

export type WorkspaceFeedback = {
  message: string;
  tone: "error" | "info" | "success";
};

export function useWorkspaceUi() {
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

  const [privacyStatusOpen, setPrivacyStatusOpen] = useState(false);

  const [isClearingChatData, setIsClearingChatData] = useState(false);

  const [settingsEntry, setSettingsEntry] = useState<"general" | "provider">();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();

  const [showingArchived, setShowingArchived] = useState(false);

  const [renameTarget, setRenameTarget] = useState<Conversation>();

  const [downloadTarget, setDownloadTarget] = useState<ConversationView>();

  return {
    isSavingTitle,
    setIsSavingTitle,
    feedback,
    setFeedback,
    workspaceVerification,
    setWorkspaceVerification,
    privateConnectionProgress,
    setPrivateConnectionProgress,
    privacyStatusOpen,
    setPrivacyStatusOpen,
    isClearingChatData,
    setIsClearingChatData,
    settingsEntry,
    setSettingsEntry,
    sidebarCollapsed,
    setSidebarCollapsed,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    confirmation,
    setConfirmation,
    showingArchived,
    setShowingArchived,
    renameTarget,
    setRenameTarget,
    downloadTarget,
    setDownloadTarget,
  };
}

export type WorkspaceUi = ReturnType<typeof useWorkspaceUi>;
