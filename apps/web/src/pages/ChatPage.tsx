import { answerToolsCopy as toolCopy } from "@/messages/answer-tools";
import { useNarrowLayout } from "@/hooks/use-media-query";
import { AnswerToolsContext } from "@/components/chat/AnswerActions";
import { AnswerToolsPanel } from "@/components/chat/AnswerToolsPanel";
import { answerToolsStyles } from "@/styles/answer-tools";
import { Button } from "@/components/ui/button";
import { PanelRightOpen } from "lucide-react";
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
import { useState } from "react";
import { DebateSetupDialog } from "@/components/debate/DebateSetupDialog";
import { DebateWorkspace } from "@/components/debate/DebateWorkspace";
import { MessagesSquare } from "lucide-react";

export function ChatPage() {
	const [debateSetupOpen, setDebateSetupOpen] = useState(false);
  const workspace = useChatWorkspace();
  const narrowAnswerTools = useNarrowLayout("(width <= 900px)");
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
    isNavigating,
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
          focusMode
            ? workspaceStyles.focusWorkspace
            : workspaceStyles.workspace,
          "workspace workspace--focused workspace--nearai",
        )}
        aria-label={copy.chatSurface}
      >
        <div
          className={cn(
            focusMode
              ? workspaceStyles.focusBody
              : workspaceStyles.workspace_body,
            `workspace__body workspace__body--nearai${sidebarCollapsed ? " workspace__body--sidebar-collapsed" : ""}`,
          )}
        >
          <WorkspaceSidebar workspace={workspace} />
          <div
            className={cn(workspaceStyles.workspace_main, "workspace__main")}
          >
            <WorkspaceHeader
              debateMode={Boolean(conversationView?.debate_id)}
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
              onApplyModelSet={targets=>void workspace.handleApplyModelSet(targets)}
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
              {feedback ? (
                <WorkspaceToast feedback={feedback} onDismiss={setFeedback} />
              ) : null}
            </div>
            {!conversationView?.debate_id && <div className="flex shrink-0 justify-end gap-2 border-b border-border/40 px-4 py-1">
              <Button size="xs" variant="ghost" disabled={isSending || isNavigating || connection !== "ready"} onClick={() => setDebateSetupOpen(true)}><MessagesSquare aria-hidden="true" />New debate</Button>
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={workspace.answerTools.open}
                onClick={() => workspace.answerTools.setOpen((value) => !value)}
              >
                <PanelRightOpen aria-hidden="true" />
                {toolCopy.title}
                {workspace.answerTools.busy ? " · Working…" : ""}
              </Button>
            </div>}
            {conversationView?.debate_id ? <DebateWorkspace key={conversationView.debate_id} id={conversationView.debate_id} focusMode={focusMode} newDebateDisabled={isSending || isNavigating || connection !== "ready"} onNewDebate={() => setDebateSetupOpen(true)} /> : (
            <div className={`${answerToolsStyles.layout} relative`}>
              <AnswerToolsContext.Provider
                value={{
                  busy: isSending || isNavigating,
                  ask: workspace.answerTools.openAsk,
                  edit: workspace.answerTools.openEditor,
                }}
              >
                <div
                  className={answerToolsStyles.main}
                  inert={workspace.answerTools.open && narrowAnswerTools}
                >
                  <ConversationPanel
                    focusMode={focusMode}
                    attachmentDraft={workspace.attachmentDraft}
                    view={isLoadingConversation ? undefined : conversationView}
                    copy={copy}
                    isLoading={isLoadingConversation}
                    onSend={() => void handleSend()}
                    onCancel={() => void handleCancel()}
                    onChooseModel={()=>{exitFocusMode();requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.model-selector [aria-label="Model"]')?.focus());}}
                    onEditPrompt={(batchId,body,targets,callbacks)=>void handleSend({editOfBatchId:batchId,body,targets,...callbacks})}
                    onRetry={(batchID, targetID) =>
                      void handleRetry(batchID, targetID)
                    }
                    onCreateConversation={() => void handleCreateConversation()}
                    onOpenSettings={() => setSettingsEntry("provider")}
                    generationBatch={generationBatch}
                    navigation={conversationNavigation}
                    generationBatches={
                      conversationView?.generation_batches ?? []
                    }
                    liveTurn={liveTurn}
                    draft={draft}
                    onDraftChange={(value) => {
                      if (!isNavigating) setDraft(value);
                    }}
                    privateMode={secureInferenceTargetSelected(
                      activeModelSet,
                      providerProfiles,
                      catalogs,
                    )}
                    isSending={isSending}
                    navigationBusy={isNavigating}
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
                </div>
              </AnswerToolsContext.Provider>
              {workspace.answerTools.open && (
                <AnswerToolsPanel tools={workspace.answerTools} />
              )}
            </div>
            )}
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
      <DebateSetupDialog open={debateSetupOpen} onClose={() => setDebateSetupOpen(false)} profiles={providerProfiles} catalogs={catalogs} activeModelSet={activeModelSet} onStarted={id => { workspace.answerTools.setOpen(false); workspace.setSelectedId(id); workspace.setShowingArchived(false); }} onOpenSettings={() => setSettingsEntry("provider")} />
    </main>
  );
}
