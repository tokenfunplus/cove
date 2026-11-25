import { ArrowUpRight, ChevronDown, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState, type DragEvent } from "react";
import type { ConversationView } from "@cove/api-contract";
import { ConversationPanel } from "@/components/chat/ConversationPanel";
import { WorkspaceOverlays } from "@/components/layout/WorkspaceOverlays";
import { WorkspaceToast } from "@/components/layout/WorkspaceToast";
import { ModelSelector } from "@/components/providers/ModelSelector";
import { secureInferenceTargetSelected } from "@/components/providers/model-selection";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatWorkspace } from "@/hooks/workspace/use-chat-workspace";
import { useQuickPanelBridge } from "@/hooks/workspace/use-quick-panel-bridge";
import { useQuickPanelHeight } from "@/hooks/workspace/use-quick-panel-height";
import { postQuickPanelMessage } from "@/lib/quick-panel";

const composerId = "quick-panel-input";
const emptyConversation: ConversationView = {
  id: "",
  title: "Quick chat",
  created_at: "",
  updated_at: "",
  messages: [],
};

export function QuickPanelPage() {
  const { focusComposer, hasShown, recovery, reconnect } =
    useQuickPanelBridge(composerId);
  const workspace = useChatWorkspace({
    quickPanel: true,
    catalogsEnabled: hasShown,
  });
  const [modelsOpen, setModelsOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useQuickPanelHeight(
    panelRef,
    workspace.attachmentDraft.attachments.length > 0,
  );
  const {
    activeModelSet,
    catalog,
    catalogs,
    conversationView,
    copy,
    isNavigating,
    isSending,
    providerProfiles,
    selectedId,
    selectionStatus,
  } = workspace;
  const connectionReady = workspace.connection === "ready" && !recovery;
  const busy =
    isSending ||
    isNavigating ||
    Boolean(conversationView?.active_generation_batch);
  const canContinue = Boolean(
    selectedId && conversationView?.messages.length && !busy,
  );
  const modelLabel =
    activeModelSet.length > 1
      ? `${copy.modelComparison} · ${activeModelSet.length}`
      : workspace.activeSelection.modelId || copy.selectModel;

  useLayoutEffect(() => {
    if (!selectedId && !workspace.confirmation) focusComposer();
  }, [focusComposer, selectedId, workspace.confirmation]);

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    if (connectionReady && !busy) {
      void workspace.attachmentDraft.addAttachments(
        Array.from(event.dataTransfer.files),
      );
      focusComposer();
    }
  }

  function openProviderSettings() {
    setModelsOpen(false);
    postQuickPanelMessage({ action: "open-provider-settings" });
  }

  return (
    <main
      ref={panelRef}
      aria-label="Cove Quick Panel"
      className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-background"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect =
          connectionReady && !busy ? "copy" : "none";
      }}
      onDrop={handleDrop}
    >
      {selectedId && (
        <header className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-border/65 px-3">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={workspace.startBlankQuickChat}
          >
            <Plus aria-hidden="true" />
            {copy.newChat}
          </Button>
          {canContinue && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                postQuickPanelMessage({
                  action: "open-chat",
                  conversationId: selectedId,
                })
              }
            >
              Continue in Cove
              <ArrowUpRight aria-hidden="true" />
            </Button>
          )}
        </header>
      )}
      {workspace.feedback && (
        <div className="relative shrink-0 [&_.workspace__feedback]:relative [&_.workspace__feedback]:inset-auto [&_.workspace__feedback]:mx-3 [&_.workspace__feedback]:my-1">
          <WorkspaceToast
            feedback={workspace.feedback}
            onDismiss={workspace.setFeedback}
          />
        </div>
      )}
      {!connectionReady && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2 text-xs text-muted-foreground">
          <p role="status">
            {recovery === "connecting"
              ? "Reconnecting to Cove…"
              : workspace.connection === "loading" && !recovery
                ? "Connecting to Cove…"
                : "The Local Service is unavailable."}
          </p>
          {(recovery === "failed" ||
            (workspace.connection === "unavailable" && !recovery)) && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={reconnect}
            >
              Reconnect
            </Button>
          )}
        </div>
      )}
      <ConversationPanel
        interactive={{
          enabled: workspace.interactiveEnabled,
          onContinue: (interaction, question, callbacks) =>
            void workspace.handleSend({
              interaction,
              body: question,
              preserveDraft: true,
              ...callbacks,
            }),
        }}
        focusMode
        quickPanel
        quickPanelModelControl={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-6 min-w-0 shrink gap-1 px-1.5 text-[11px]"
            aria-label={`${copy.model} · ${modelLabel}`}
            aria-haspopup="dialog"
            disabled={busy || !connectionReady}
            title={activeModelSet.map((target) => target.modelId).join(", ")}
            onClick={() => setModelsOpen(true)}
          >
            <span className="min-w-0 truncate">{modelLabel}</span>
            <ChevronDown aria-hidden="true" className="size-3" />
          </Button>
        }
        connectionReady={connectionReady}
        composerId={composerId}
        view={conversationView ?? emptyConversation}
        copy={copy}
        attachmentDraft={workspace.attachmentDraft}
        execution={{
          localOnly: workspace.localOnly,
          setLocalOnly: workspace.setLocalOnly,
          openLocalModels: () => workspace.setSettingsEntry("local-models"),
        }}
        webSearch={
          selectedId
            ? {
                ...workspace.webSearch,
                budgetLabel: workspace.webSearch.budgetLabel(
                  activeModelSet.length,
                ),
              }
            : undefined
        }
        draft={workspace.draft}
        onDraftChange={workspace.setDraft}
        onSend={() => void workspace.handleQuickPanelSend()}
        onCancel={() => void workspace.handleCancel()}
        onRetry={(batchId, targetId) =>
          void workspace.handleRetry(batchId, targetId)
        }
        onCancelTarget={(batchId, generationId) =>
          void workspace.handleCancelTarget(batchId, generationId)
        }
        onChooseModel={() => setModelsOpen(true)}
        onOpenSettings={openProviderSettings}
        onSelectAnswer={(batchId, generationId) =>
          void workspace.handleSelectAnswer(batchId, generationId)
        }
        onSkipContext={(batchId) => void workspace.handleSkipContext(batchId)}
        onVerifyAgain={workspace.handleVerifyAgain}
        generationBatch={workspace.generationBatch}
        generationBatches={conversationView?.generation_batches}
        liveTurn={workspace.liveTurn}
        activeModelSet={activeModelSet}
        profiles={providerProfiles}
        providerStatus={
          workspace.connection === "ready" ? selectionStatus : "catalog-loading"
        }
        privateMode={secureInferenceTargetSelected(
          activeModelSet,
          providerProfiles,
          catalogs,
        )}
        isSending={isSending}
        navigationBusy={isNavigating}
      />
      <WorkspaceOverlays workspace={workspace} />
      <Dialog
        open={modelsOpen}
        onClose={() => setModelsOpen(false)}
        className="fixed inset-0 z-50 flex items-center justify-center p-3"
      >
        <DialogOverlay />
        <DialogContent className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <DialogTitle>{copy.activeModelSet}</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setModelsOpen(false)}
            >
              {copy.close}
            </Button>
          </div>
          <ModelSelector
            profiles={providerProfiles}
            activeProviderId={workspace.activeSelection.providerId}
            activeModelId={workspace.activeSelection.modelId}
            activeModelSet={activeModelSet}
            catalog={catalog}
            catalogs={catalogs}
            copy={copy}
            disabled={busy || !connectionReady}
            onProviderChange={workspace.handleProviderChange}
            onModelChange={(modelId) =>
              void workspace.handleModelChange(modelId)
            }
            onTargetModelChange={(index, modelId) =>
              void workspace.handleTargetModelChange(index, modelId)
            }
            onAddModel={(profile, modelId) =>
              void workspace.handleAddModel(profile, modelId)
            }
            onRemoveModel={(target) => void workspace.handleRemoveModel(target)}
            onApplyModelSet={(targets) =>
              void workspace.handleApplyModelSet(targets)
            }
            onOpenLocalModels={() => {
              setModelsOpen(false);
              workspace.setSettingsEntry("local-models");
            }}
          />
          {providerProfiles.every((profile) => !profile.configured) && (
            <Button
              type="button"
              variant="link"
              className="mt-2"
              onClick={openProviderSettings}
            >
              {copy.openProviderSettings}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
