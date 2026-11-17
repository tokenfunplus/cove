import { workspaceStyles } from "@/styles/workspace";
import { cn } from "@/lib/utils";
import { ConversationPanel } from "@/components/chat/ConversationPanel";
import { WorkspaceToast } from "@/components/layout/WorkspaceToast";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { WorkspaceOverlays } from "@/components/layout/WorkspaceOverlays";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";
import { secureInferenceTargetSelected } from "@/components/providers/model-selection";
import { PrivateConnectionProgress } from "@/components/verification/PrivateConnectionProgress";
import { privacyStatusFromConversation } from "@/lib/verification/privacy-status";

import { useChatWorkspace } from "@/hooks/workspace/use-chat-workspace";

export function ChatPage() {
  const workspace = useChatWorkspace();
  const {
    appearance,
    connection,
    conversationView,
    conversationNavigation,
    isLoadingConversation,
    providerProfiles,
    activeModelSet,
    settings,
    feedback,
    setFeedback,
    setWorkspaceVerification,
    privateConnectionProgress,
    setPrivateConnectionProgress,
    setPrivacyStatusOpen,
    setSettingsEntry,
    sidebarCollapsed,
    focusMode,
    enterFocusMode,
    exitFocusMode,
    setMobileSidebarOpen,
    generationBatch,
    draft,
    setDraft,
    liveTurn,
    isSending,
    secureInferenceAbortRef,
    handleCreateConversation,
    handleVerifyPrivateConnection,
    handleVerifyAgain,
    handleVerifySelectedModel,
    handleSend,
    handleCancel,
    handleCancelTarget,
    handleRetry,
    handleSelectAnswer,
    handleSkipContext,
    handleProviderChange,
    handleModelChange,
    handleTargetModelChange,
    handleAddModel,
    handleRemoveModel,
    handleToggleTheme,
    activeSelection,
    narrowLayout,
    copy,
    catalogs,
    catalog,
    selectionStatus,
  } = workspace;

  const privacySummary = privacyStatusFromConversation(
    conversationView,
    generationBatch,
    providerProfiles,
  );

  return (
    <main
      className={cn(
        focusMode ? workspaceStyles.focusSurface : workspaceStyles.surface,
        "surface surface--focused surface--nearai",
      )}
      aria-label={copy.chatSurface}
      data-focus-mode={focusMode ? "true" : undefined}
    >
      <section
        className={cn(
          focusMode ? workspaceStyles.focusWorkspace : workspaceStyles.workspace,
          "workspace workspace--focused workspace--nearai",
        )}
        aria-label={copy.chatSurface}
      >
        <div
          className={cn(
            focusMode ? workspaceStyles.focusBody : workspaceStyles.workspace_body,
            `workspace__body workspace__body--nearai${sidebarCollapsed ? " workspace__body--sidebar-collapsed" : ""}`,
          )}
        >
          <WorkspaceSidebar workspace={workspace} />
          <div
            className={cn(workspaceStyles.workspace_main, "workspace__main")}
          >
            <WorkspaceHeader
              focusMode={focusMode}
              onEnterFocus={enterFocusMode}
              onExitFocus={exitFocusMode}
              profiles={providerProfiles}
              activeProviderId={activeSelection.providerId}
              activeModelId={activeSelection.modelId}
              activeModelSet={activeModelSet}
              catalog={catalog}
              catalogs={catalogs}
              title={conversationView?.title ?? copy.newChat}
              theme={settings.theme}
              appearance={appearance}
              onToggleTheme={() => void handleToggleTheme()}
              privacyLabel={
                privacySummary.status === "confidential"
                  ? copy.chatConfidential
                  : privacySummary.status === "gateway"
                    ? copy.verificationGateway
                    : privacySummary.status === "partial"
                      ? copy.chatPartiallyVerified
                      : privacySummary.status === "empty"
                        ? copy.privacyNoData
                        : copy.chatUnverified
              }
              privacyTone={privacySummary.status}
              onProviderChange={handleProviderChange}
              onModelChange={(modelId) => void handleModelChange(modelId)}
              onTargetModelChange={(targetIndex, modelId) =>
                void handleTargetModelChange(targetIndex, modelId)
              }
              onAddModel={(profile, modelId) =>
                void handleAddModel(profile, modelId)
              }
              onRemoveModel={(target) => void handleRemoveModel(target)}
              onVerifyPrivateConnection={
                secureInferenceTargetSelected(
                  activeModelSet,
                  providerProfiles,
                  catalogs,
                )
                  ? () => void handleVerifyPrivateConnection()
                  : undefined
              }
              onOpenPrivateVerification={
                secureInferenceTargetSelected(
                  activeModelSet,
                  providerProfiles,
                  catalogs,
                )
                  ? () => void handleVerifySelectedModel()
                  : undefined
              }
              onOpenPrivacyStatus={() => setPrivacyStatusOpen(true)}
              connection={connection}
              disabled={isSending}
              onOpenSidebar={
                narrowLayout ? () => setMobileSidebarOpen(true) : undefined
              }
              copy={copy}
            />
            <div className="relative shrink-0">
              {feedback ? <WorkspaceToast feedback={feedback} onDismiss={setFeedback} /> : null}
            </div>
            <ConversationPanel
              focusMode={focusMode}
              attachmentDraft={workspace.attachmentDraft}
              view={isLoadingConversation ? undefined : conversationView}

              copy={copy}
              isLoading={isLoadingConversation}
              onSend={() => void handleSend()}
              onCancel={() => void handleCancel()}
              onRetry={(batchID, targetID) =>
                void handleRetry(batchID, targetID)
              }
              onCreateConversation={() => void handleCreateConversation()}
              onOpenSettings={() => setSettingsEntry("provider")}
              generationBatch={generationBatch}
              navigation={conversationNavigation}
              generationBatches={conversationView?.generation_batches ?? []}
              liveTurn={liveTurn}
              draft={draft}
              onDraftChange={setDraft}
              privateMode={secureInferenceTargetSelected(
                activeModelSet,
                providerProfiles,
                catalogs,
              )}
              isSending={isSending}
              providerStatus={selectionStatus}
              activeModelSet={activeModelSet}
              profiles={providerProfiles}

              onCancelTarget={(batchID, generationID) =>
                void handleCancelTarget(batchID, generationID)
              }
              onSelectAnswer={(batchID, generationID) =>
                void handleSelectAnswer(batchID, generationID)
              }
              onSkipContext={(batchID) => void handleSkipContext(batchID)}
              onVerifyAgain={(targetID, kind) =>
                handleVerifyAgain(targetID, kind)
              }
            />
            {privateConnectionProgress ? (
              <PrivateConnectionProgress
                providerName={privateConnectionProgress.providerName}
                modelIds={privateConnectionProgress.modelIds}
                phase={privateConnectionProgress.phase}
                failedAt={privateConnectionProgress.failedAt}
                message={privateConnectionProgress.message}
                copy={copy}
                onClose={() => {
                  if (
                    privateConnectionProgress.phase !== "complete" &&
                    privateConnectionProgress.phase !== "failed"
                  ) {
                    secureInferenceAbortRef.current?.abort();
                  }
                  setPrivateConnectionProgress(undefined);
                }}
                onOpenDetails={
                  privateConnectionProgress.verification
                    ? () => {
                        setWorkspaceVerification(
                          privateConnectionProgress.verification,
                        );
                        setPrivateConnectionProgress(undefined);
                      }
                    : undefined
                }
              />
            ) : null}
          </div>
        </div>
      </section>
      <WorkspaceOverlays workspace={workspace} />
    </main>
  );
}
