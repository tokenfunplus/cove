import { ConversationDownloadDialog } from "@/components/conversations/ConversationDownloadDialog";
import { ConversationRenameDialog } from "@/components/conversations/ConversationRenameDialog";
import { ProviderSettings } from "@/components/providers/ProviderSettings";
import { ChatDataPanel } from "@/components/settings/ChatDataPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { WorkspaceSettingsPanel } from "@/components/settings/WorkspaceSettingsPanel";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { PrivacyStatusPanel } from "@/components/verification/PrivacyStatusPanel";
import { VerificationDialog } from "@/components/verification/VerificationDialog";
import { downloadConversationExport } from "@/lib/conversation-export";
import { privacyStatusFromConversation } from "@/lib/verification/privacy-status";

import { type ChatWorkspace } from "@/hooks/workspace/use-chat-workspace";

type Props = {
  workspace: Pick<
    ChatWorkspace,
    | "workspaceVerification"
    | "providerProfiles"
    | "activeSelection"
    | "copy"
    | "handleVerifyWorkspaceAgain"
    | "setWorkspaceVerification"
    | "privacyStatusOpen"
    | "conversationView"
    | "generationBatch"
    | "setPrivacyStatusOpen"
    | "handleVerifyAgain"
    | "settingsEntry"
    | "setSettingsEntry"
    | "settings"
    | "handleSaveSettings"
    | "handleSaveProvider"
    | "handleTestProvider"
    | "handleDeleteProvider"
    | "handleDeleteProviderKey"
    | "conversations"
    | "handleDeleteConversation"
    | "isSending"
    | "handleClearChatData"
    | "handleExportChatData"
    | "isClearingChatData"
    | "confirmation"
    | "isNavigating"
    | "setConfirmation"
    | "confirmRequestedAction"
    | "renameTarget"
    | "isSavingTitle"
    | "setRenameTarget"
    | "saveConversationTitle"
    | "downloadTarget"
    | "setDownloadTarget"
  >;
};

export function WorkspaceOverlays({ workspace }: Props) {
  const {
    workspaceVerification,
    providerProfiles,
    activeSelection,
    copy,
    handleVerifyWorkspaceAgain,
    setWorkspaceVerification,
    privacyStatusOpen,
    conversationView,
    generationBatch,
    setPrivacyStatusOpen,
    handleVerifyAgain,
    settingsEntry,
    setSettingsEntry,
    settings,
    handleSaveSettings,
    handleSaveProvider,
    handleTestProvider,
    handleDeleteProvider,
    handleDeleteProviderKey,
    conversations,
    handleDeleteConversation,
    isSending,
    handleClearChatData,
    handleExportChatData,
    isClearingChatData,
    confirmation,
    isNavigating,
    setConfirmation,
    confirmRequestedAction,
    renameTarget,
    isSavingTitle,
    setRenameTarget,
    saveConversationTitle,
    downloadTarget,
    setDownloadTarget,
  } = workspace;
  return (
    <>
      {workspaceVerification ? (
        <VerificationDialog
          kind={workspaceVerification.kind}
          evidence={workspaceVerification.evidence}
          providerName={
            providerProfiles.find(
              (profile) => profile.id === activeSelection.providerId,
            )?.name
          }
          modelId={activeSelection.modelId}
          copy={copy}
          onVerifyAgain={handleVerifyWorkspaceAgain}
          onClose={() => setWorkspaceVerification(undefined)}
        />
      ) : null}
      <PrivacyStatusPanel
        open={privacyStatusOpen}
        summary={privacyStatusFromConversation(
          conversationView,
          generationBatch,
          providerProfiles,
        )}
        copy={copy}
        onClose={() => setPrivacyStatusOpen(false)}
        onVerifyAgain={(targetID, kind) => handleVerifyAgain(targetID, kind)}
      />
      <SettingsDialog
        open={Boolean(settingsEntry)}
        initialSection={settingsEntry}
        onClose={() => setSettingsEntry(undefined)}
        copy={copy}
      >
        <div
          aria-labelledby="settings-tab-general"
          className="settings-dialog__section settings-section"
          data-settings-section="general"
          id="settings-general"
          role="tabpanel"
        >
          <WorkspaceSettingsPanel
            settings={settings}
            onSave={handleSaveSettings}
            copy={copy}
          />
        </div>
        <div
          aria-labelledby="settings-tab-provider"
          className="settings-dialog__section settings-section"
          data-settings-section="provider"
          id="settings-provider"
          role="tabpanel"
        >
          <ProviderSettings
            id="provider-settings"
            copy={copy}
            profiles={providerProfiles}
            onSave={handleSaveProvider}
            onTest={handleTestProvider}
            onDelete={handleDeleteProvider}
            onDeleteKey={handleDeleteProviderKey}
          />
        </div>
        <div
          aria-labelledby="settings-tab-chat-data"
          className="settings-dialog__section settings-section"
          data-settings-section="chat-data"
          id="settings-chat-data"
          role="tabpanel"
        >
          <ChatDataPanel
            conversations={conversations}
            generationCount={
              (conversationView?.generation_batches ?? []).length
            }
            onDelete={(id) => void handleDeleteConversation(id)}
            deleteDisabled={isSending}
            onClear={() => void handleClearChatData()}
            onExport={(format) => void handleExportChatData(format)}
            isClearing={isClearingChatData}
            copy={copy}
          />
        </div>
      </SettingsDialog>
      <ConfirmationDialog
        open={Boolean(confirmation)}
        busy={isNavigating}
        title={
          confirmation?.discardDraft ? copy.discardDraftTitle : confirmation?.kind === "navigate" ? copy.changeChatView : confirmation?.kind === "new" ? copy.newChat : confirmation?.kind === "delete"
            ? copy.deleteConversation
            : confirmation?.kind === "clear"
              ? copy.clearChatData
              : copy.switchConversation
        }
        description={
          confirmation?.discardDraft
            ? confirmation.stopGeneration ? copy.confirmDiscardDraftAndStop : copy.confirmDiscardDraft
            : confirmation?.kind === "navigate" ? copy.confirmStopAndNavigate : confirmation?.kind === "new" ? copy.confirmStopAndCreate : confirmation?.kind === "delete"
            ? copy.confirmDeleteConversation
            : confirmation?.kind === "clear"
              ? copy.confirmClearChatData
              : copy.confirmSwitchConversation
        }
        confirmLabel={
          confirmation?.discardDraft ? copy.discardAndContinue : confirmation?.kind === "navigate" ? copy.changeChatView : confirmation?.kind === "new" ? copy.newChat : confirmation?.kind === "delete"
            ? copy.deleteConversation
            : confirmation?.kind === "clear"
              ? copy.clearChatData
              : copy.switchConversation
        }
        cancelLabel={confirmation?.discardDraft ? copy.stay : undefined}
        destructive={Boolean(confirmation?.discardDraft) || confirmation?.kind === "delete" || confirmation?.kind === "clear"}
        onCancel={() => setConfirmation(undefined)}
        onConfirm={() => void confirmRequestedAction()}
        copy={copy}
      />
      <ConversationRenameDialog
        conversation={renameTarget}
        copy={copy}
        isSaving={isSavingTitle}
        onClose={() => setRenameTarget(undefined)}
        onSave={(title) => {
          if (renameTarget) {
            void saveConversationTitle(renameTarget.id, title);
          }
        }}
      />
      <ConversationDownloadDialog
        conversation={downloadTarget}
        copy={copy}
        onClose={() => setDownloadTarget(undefined)}
        onDownload={(format) => {
          if (downloadTarget) {
            downloadConversationExport(downloadTarget, format);
            setDownloadTarget(undefined);
          }
        }}
      />
    </>
  );
}
