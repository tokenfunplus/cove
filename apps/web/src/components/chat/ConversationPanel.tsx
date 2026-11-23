import { useState, type ReactNode } from "react";
import { EditPromptDialog } from "./EditPromptDialog";
import { ChatExperienceContext, GenerationActivity, FailureActions } from "./ChatExperience";
import { AnswerActions } from "@/components/chat/AnswerActions";
import { ResponseDetails } from "./ResponseDetails";
import { WebSearchTrace } from "./WebSearchTrace";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ConversationTimeline } from "@/components/chat/ConversationTimeline";
import {
  SourceDocuments,
  BatchSources,
} from "@/components/chat/SourceDocuments";
import { type AttachmentDraft } from "@/hooks/chat/use-attachment-draft";
import { chatStyles } from "@/styles/chat";
import { welcomeStyles } from "@/styles/welcome";
import { baseStyles } from "@/styles/base";
import { primitivesStyles } from "@/styles/primitives";
import { messagesStyles } from "@/styles/messages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CoveMark } from "@/components/ui/CoveMark";
import { ConversationWelcome } from "@/components/chat/ConversationWelcome";
import { generationFailureMessage } from "@/components/chat/generation-status";
import {
  StopGenerationButton,
} from "@/components/chat/GenerationProgress";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { MessageMeta } from "@/components/chat/MessageMeta";
import {
  LiveModelComparisonGrid,
  ModelComparisonResultGrid,
} from "@/components/chat/ModelComparison";
import {
  type ActiveModelSet,
  inferenceModeForSnapshot,
  type ProviderSelectionStatus,
} from "@/components/providers/model-selection";
import { ProviderStatusNotice } from "@/components/providers/ProviderStatusNotice";
import { type LiveTurn } from "@/lib/chat/live-turn";
import { conversationTimeline } from "@/lib/chat/timeline";
import { timelineStyles } from "@/styles/timeline";
import { formatTime } from "@/lib/format-date";
import { type ApplicationCopy, englishConversationCopy } from "@/messages";
import {
  type ConversationView,
  type Generation,
  type GenerationBatch,
  type ProviderProfile,
  type VerificationEvidence,
} from "@cove/api-contract";
import { ArrowRight } from "lucide-react";
import { useConversationScroll } from "@/hooks/chat/use-conversation-scroll";
import type { ConversationNavigation } from "@/lib/workspace-types";

export function ConversationPanel({
  execution,
  webSearch,
  focusMode = false,
  quickPanel = false,
  quickPanelModelControl,
  connectionReady = true,
  composerId,
  attachmentDraft,
  view,
  copy = englishConversationCopy,
  isLoading = false,
  onSend,
  onCancel,
  onRetry,
  onCreateConversation,
  onOpenSettings,
  onChooseModel,
  onEditPrompt,
  generationBatch,
  navigation,
  generationBatches = [],
  activeModelSet = [],
  profiles = [],
  generation,
  liveAssistantBody = "",
  liveTurn,
  draft = "",
  onDraftChange,
  privateMode = true,
  isSending = false,
  navigationBusy = false,
  providerStatus = "ready",
  onCancelTarget,
  onSelectAnswer,
  onSkipContext,
  onVerifyAgain,
}: {
  execution?: Parameters<typeof ChatComposer>[0]["execution"];
  webSearch?: Parameters<typeof ChatComposer>[0]["webSearch"];
  focusMode?: boolean;
  quickPanel?: boolean;
  quickPanelModelControl?: ReactNode;
  connectionReady?: boolean;
  attachmentDraft?: AttachmentDraft;
  view: ConversationView | undefined;
  copy?: ApplicationCopy;
  composerId?: string;
  isLoading?: boolean;
  onSend?: () => void;
  onCancel?: () => void;
  onRetry?: (batchID: string, targetID: string) => void;
  onCreateConversation?: () => void;
  onOpenSettings?: () => void;
  onChooseModel?: () => void;
  onEditPrompt?: (batchId:string,body:string,targets:ActiveModelSet,callbacks:{onAccepted:()=>void;onFailure:(message:string)=>void})=>void;
  generationBatch?: GenerationBatch;
  navigation?: ConversationNavigation;
  generationBatches?: GenerationBatch[];
  /** @deprecated retained for one-target shell tests during the Batch migration. */
  generation?: Generation;
  liveAssistantBody?: string;
  liveTurn?: LiveTurn;
  draft?: string;
  onDraftChange?: (value: string) => void;
  privateMode?: boolean;
  isSending?: boolean;
  navigationBusy?: boolean;
  providerStatus?: ProviderSelectionStatus;
  onCancelTarget?: (batchID: string, generationID: string) => void;
  onSelectAnswer?: (batchID: string, generationID: string) => void;
  onSkipContext?: (batchID: string) => void;
  onVerifyAgain?: (
    targetID: string,
    kind: "model" | "gateway",
  ) => Promise<VerificationEvidence | undefined> | void;
  activeModelSet?: ActiveModelSet;
  profiles?: ProviderProfile[];
}) {
  const retryLocalOnly = Boolean(execution?.localOnly || attachmentDraft?.localOnly);
  const [editing,setEditing]=useState<{batch:GenerationBatch;body:string}>();
  const [editError,setEditError]=useState<string>();
  const {
    messageListRef,
    contentRef,
    updatedReplies,
    composerRef,
    footerRef,
    footerHeight,
    showReturnToLatest,
    handleMessageScroll,
    returnToLatest,
    scrollToMessage,
  } = useConversationScroll({
    view,
    liveTurn,
    generationBatch,
    generation,
    isLoading,
    navigation,
    quickPanel,
  });

  if (isLoading) {
    return (
      <section
        className={chatStyles.conversationPanel}
        data-workspace-chat-style="nearai"
      >
        <p className={chatStyles.conversationPanel_empty}>
          {copy.loadingConversation}
        </p>
      </section>
    );
  }
  if (!view) {
    return (
      <section
        className={chatStyles.conversationPanel}
        data-workspace-chat-style="nearai"
      >
        <div
          className={welcomeStyles.conversationEmptyState}
          data-workspace-empty="true"
        >
          <div className={welcomeStyles.emptyState_mark} aria-hidden="true">
            <CoveMark />
          </div>
          <p className={baseStyles.eyebrow}>{copy.chatSurface}</p>
          <h2>{copy.noConversationSelected}</h2>
          <p>{copy.emptyConversationHint}</p>
          {onCreateConversation ? (
            <Button
              variant="default"
              className={primitivesStyles.emptyState_action}
              onClick={onCreateConversation}
            >
              {copy.startConversation}
            </Button>
          ) : null}
        </div>
        {providerStatus !== "ready" && providerStatus !== "catalog-loading" ? (
          <ProviderStatusNotice
            onOpenSettings={onOpenSettings}
            status={providerStatus}
            copy={copy}
          />
        ) : null}
      </section>
    );
  }

  const catalogLoading = providerStatus === "catalog-loading";
  const showComposer =
    !view.archived &&
    (quickPanel || providerStatus === "ready" || catalogLoading) &&
    onSend &&
    onDraftChange;
  const canStopFromComposer = showComposer && isSending && onCancel;
  const allGenerationBatches =
    generationBatch &&
    !generationBatches.some((batch) => batch.id === generationBatch.id)
      ? [...generationBatches, generationBatch]
      : generationBatches;
  const batchTargetByAssistantMessageID = new Map<
    string,
    { batch: GenerationBatch; target: GenerationBatch["targets"][number] }
  >();
  const assistantMessageIDByTargetOrGenerationID = new Map<string, string>();
  for (const batch of allGenerationBatches) {
    for (const target of batch.targets) {
      if (target.generation.assistant_message_id) {
        batchTargetByAssistantMessageID.set(
          target.generation.assistant_message_id,
          { batch, target },
        );
        assistantMessageIDByTargetOrGenerationID.set(
          target.id,
          target.generation.assistant_message_id,
        );
        assistantMessageIDByTargetOrGenerationID.set(
          target.generation.id,
          target.generation.assistant_message_id,
        );
      }
    }
  }
  const hasMessages = view.messages.length > 0 || Boolean(liveTurn);
  const liveUserAlreadyPersisted = Boolean(
    liveTurn?.userMessageId &&
      view.messages.some((message) => message.id === liveTurn.userMessageId),
  );
  const rawLiveTargets = liveTurn?.targets?.length
    ? liveTurn.targets
    : generation
      ? [
          {
            key: generation.id,
            generationId: generation.id,
            providerId: generation.snapshot.provider_id,
            modelId: generation.snapshot.model_id,
            snapshot: generation.snapshot,
            assistantBody: liveAssistantBody || liveTurn?.assistantBody || "",
            phase: liveTurn?.phase ?? generation.state,
            errorCode: generation.error_code,
            errorMessage: generation.error_message,
          },
        ]
      : liveTurn
        ? [
            {
              key: "legacy-live",
              generationId: liveTurn.generationId,
              providerId: "",
              modelId: "",
              assistantBody: liveTurn.assistantBody ?? "",
              phase: liveTurn.phase ?? "pending",
            },
          ]
        : [];
  // Completed assistant bodies are authoritative Conversation History as soon
  // as they are saved. Keep only the non-persistent/failing cards in Live Turn
  // so a status refresh never shows the completed answer twice.
  const liveTargets = rawLiveTargets.filter((target) => {
    const assistantMessageID =
      target.assistantMessageId ??
      (target.targetId
        ? assistantMessageIDByTargetOrGenerationID.get(target.targetId)
        : undefined) ??
      (target.generationId
        ? assistantMessageIDByTargetOrGenerationID.get(target.generationId)
        : undefined);
    return (
      !assistantMessageID ||
      !view.messages.some((message) => message.id === assistantMessageID)
    );
  });
  const liveBatch = liveTurn?.batchId
    ? allGenerationBatches.find((batch) => batch.id === liveTurn.batchId)
    : generationBatch;
  const generationActive =
    generationBatch?.state === "pending" ||
    generationBatch?.state === "streaming" ||
    generation?.state === "pending" ||
    generation?.state === "verifying_environment" ||
    generation?.state === "streaming" ||
    generation?.state === "verifying_response";
  const isTerminalBatch = (batch: GenerationBatch) =>
    batch.state === "completed" ||
    batch.state === "completed_with_errors" ||
    batch.state === "stopped" ||
    batch.state === "failed";
  const contextDispositionBatch = allGenerationBatches.find(
    (batch) =>
      isTerminalBatch(batch) &&
      !batch.context_frozen &&
      !batch.selected_generation_id &&
      !batch.context_skipped,
  );
  const comparisonFirstAssistantMessageID = new Map<string, string>();
  for (const batch of allGenerationBatches) {
    if (batch.targets.length < 2) continue;
    const assistantMessageIDs = new Set(
      batch.targets
        .map((target) => target.generation.assistant_message_id)
        .filter((messageID): messageID is string => Boolean(messageID)),
    );
    const firstAssistantMessageID = view.messages.find((message) =>
      assistantMessageIDs.has(message.id),
    )?.id;
    if (firstAssistantMessageID)
      comparisonFirstAssistantMessageID.set(batch.id, firstAssistantMessageID);
  }
  const terminalFailedTargets = allGenerationBatches.flatMap((batch) =>
    batch.targets
      .filter(
        (target) =>
          batch.targets.length === 1 &&
          (target.generation.state === "failed" ||
            target.generation.state === "stopped") &&
          !liveTargets.some((live) => live.targetId === target.id),
      )
      .map((target) => ({ batch, target })),
  );
  const terminalFailedBatches = allGenerationBatches.filter(
    (batch) =>
      batch.targets.length > 1 &&
      batch.targets.every(
        (target) =>
          target.generation.state === "failed" ||
          target.generation.state === "stopped",
      ) &&
      !batch.targets.some((target) =>
        liveTargets.some((live) => live.targetId === target.id),
      ),
  );
  const liveComparison =
    liveTargets.length > 1 ||
    Boolean(liveBatch && liveBatch.targets.length > 1);
  const liveComparisonAlreadyInHistory = Boolean(
    liveBatch && comparisonFirstAssistantMessageID.has(liveBatch.id),
  );
  const timelineEntries = conversationTimeline(view, liveTurn);
  const latestButton = showReturnToLatest && (
    <Button
      variant={quickPanel ? "ghost" : "outline"}
      size={quickPanel ? "xs" : "default"}
      className={quickPanel ? "mx-3 self-end text-muted-foreground" : chatStyles.conversationPanel_latest}
      style={quickPanel ? undefined : { bottom: footerHeight + 12 }}
      onClick={returnToLatest}
      type="button"
    >
      ↓ {copy.returnToLatest}{updatedReplies > 0 ? ` · ${updatedReplies} updated ${updatedReplies === 1 ? "answer" : "answers"}` : ""}
    </Button>
  );

  return (
    <SourceDocuments batches={allGenerationBatches} messages={view.messages}>
    <ChatExperienceContext.Provider value={{chooseModel:onChooseModel,openSettings:onOpenSettings,busy:isSending || navigationBusy,editTarget:onEditPrompt && !draft.trim() && !attachmentDraft?.attachments.length && !view.archived ? targetId=>{const batch=allGenerationBatches.find(item=>item.targets.some(target=>target.id===targetId));const message=view.messages.find(item=>item.id===batch?.user_message_id);if(batch && message)setEditing({batch,body:message.body});}:undefined}}>
      <section
        className={cn(
          chatStyles.conversationPanel,
          `conversation-panel${hasMessages ? "" : " conversation-panel--empty"}`,
          quickPanel && !hasMessages && "justify-center",
        )}
        aria-label={view.title}
        data-workspace-chat-style="nearai"
        data-workspace-region="conversation"
        data-workspace-empty={hasMessages ? undefined : "true"}
        data-quick-panel-conversation={quickPanel || undefined}
      >
        {view.branch && <p className="mx-5 my-2 text-xs text-muted-foreground" role="status">Branch of {view.branch.source_title}. Earlier messages are copied context from the edited turn.</p>}
        {editing && onEditPrompt && <EditPromptDialog key={editing.batch.id} batch={editing.batch} body={editing.body} targets={activeModelSet} profiles={profiles} busy={isSending || navigationBusy} error={editError} onCancelSubmission={onCancel} onClose={()=>{setEditing(undefined);setEditError(undefined);}} onSubmit={(body,targets)=>{setEditError(undefined);onEditPrompt(editing.batch.id,body,targets,{onAccepted:()=>setEditing(undefined),onFailure:setEditError});}}/>}
        {view.archived ? (
          <p className={chatStyles.conversationPanel_archived} role="status">
            {copy.archivedConversationNotice}
          </p>
        ) : connectionReady && providerStatus !== "ready" &&
          providerStatus !== "catalog-loading" ? (
          <ProviderStatusNotice
            onOpenSettings={onOpenSettings}
            status={providerStatus}
            copy={copy}
          />
        ) : null}
        <div className={cn(timelineStyles.viewport, quickPanel && !hasMessages && "hidden")}>
          <div
          ref={messageListRef}
          onScroll={handleMessageScroll}
          className={cn(
            chatStyles.messageList,
            focusMode && chatStyles.focusMessages,
            quickPanel && "[&_.message]:mb-4",
            !quickPanel && timelineEntries.length > 0 && timelineStyles.messages,
            `message-list${view.messages.length === 0 && liveTargets.length === 0 && !liveTurn ? " message-list--empty" : ""}`,
          )}
          aria-label={copy.conversationMessages}
          role={quickPanel ? "region" : undefined}
          tabIndex={quickPanel && hasMessages ? 0 : undefined}
          data-workspace-region="messages"
        >
          <div ref={contentRef} className="flow-root min-w-0" data-message-content>
          {view.messages.length === 0 &&
          liveTargets.length === 0 &&
          !liveTurn ? (
            !quickPanel && <ConversationWelcome copy={copy} onSelectPrompt={onDraftChange} />
          ) : view.messages.length === 0 ? null : (
            view.messages.map((message) => {
              const snapshot = message.provider_snapshot;
              const generationTarget =
                message.role === "assistant"
                  ? batchTargetByAssistantMessageID.get(message.id)
                  : undefined;
              if (
                generationTarget?.batch.targets.length &&
                generationTarget.batch.targets.length > 1
              ) {
                if (
                  comparisonFirstAssistantMessageID.get(
                    generationTarget.batch.id,
                  ) !== message.id
                )
                  return null;
                return (
                  <ModelComparisonResultGrid
                    localOnly={retryLocalOnly}
                    busy={isSending}
                    batch={generationTarget.batch}
                    copy={copy}
                    key={generationTarget.batch.id}
                    liveTargets={
                      generationTarget.batch.id === liveBatch?.id
                        ? liveTargets
                        : undefined
                    }
                    onCancelTarget={
                      generationTarget.batch.id === liveBatch?.id
                        ? onCancelTarget
                        : undefined
                    }
                    messages={view.messages}
                    onRetry={onRetry}
                    onSelectAnswer={onSelectAnswer}
                    onVerifyAgain={onVerifyAgain}
                  />
                );
              }
              const historyVerification =
                generationTarget?.target.generation.verification;
              return (
                <article
                  className={cn(
                    messagesStyles.message,
                    `message message--${message.role}`,
                  )}
                  data-generation-target={generationTarget?.target.id}
                  data-timeline-anchor={message.role === "user" ? message.id : undefined}
                  data-quick-panel-question={quickPanel && message.role === "user" ? "" : undefined}
                  key={message.id}
                >
                  {message.role === "user" ? (
                    <span
                      className={cn(
                        messagesStyles.message_role,
                        "message__role--user",
                      )}
                      data-message-meta="user"
                    >
                      {copy.you}
                    </span>
                  ) : (
                    <MessageMeta
                      role={message.role}
                      modelId={snapshot?.model_id}
                      providerName={snapshot?.provider_name}
                      createdAt={message.created_at}
                      copy={copy}
                      verification={historyVerification}
                      onVerifyAgain={
                        generationTarget && onVerifyAgain
                          ? (kind) =>
                              onVerifyAgain(generationTarget.target.id, kind)
                          : undefined
                      }
                      mode={inferenceModeForSnapshot(
                        generationTarget?.target.generation.snapshot ??
                          snapshot,
                      )}
                    />
                  )}
                  {message.role === "assistant" ? (
                    <AnswerActions source={{ messageId: message.id, conversationId: message.conversation_id, body: message.body, snapshot }}>
                      <AssistantMessage content={message.body} reasoning={message.reasoning} />
                    </AnswerActions>
                  ) : (
                    <p
                      className={cn(
                        messagesStyles.message_bubble,
                        messagesStyles.message_body,
                      )}
                    >
                      {message.body}
                    </p>
                  )}
                  {message.role === "user" && onEditPrompt && (()=>{
                    const batch=allGenerationBatches.find(item=>item.user_message_id===message.id);
                    return batch && isTerminalBatch(batch) ? <Button variant="ghost" size="xs" type="button" disabled={isSending || navigationBusy || !!draft.trim() || !!attachmentDraft?.attachments.length || view.archived} title={draft.trim() || attachmentDraft?.attachments.length ? "Send or clear your current draft before editing a saved prompt." : "Edit prompt and branch"} onClick={()=>{setEditError(undefined);setEditing({batch,body:message.body});}}>Edit and resend</Button> : null;
                  })()}
                  {message.role === "user" && message.created_at ? (
                    <time
                      className={messagesStyles.message_timestamp}
                      dateTime={message.created_at}
                    >
                      {formatTime(message.created_at)}
                    </time>
                  ) : null}
                  {message.role === "user" &&
                    (() => {
                      const batch = allGenerationBatches.find(
                        (item) => item.user_message_id === message.id,
                      );
                      return batch ? (
                        <BatchSources batch={batch} userBody={message.body} />
                      ) : null;
                    })()}
                  {message.role === "assistant" && generationTarget?.target.generation.configuration_snapshot.web_search && <WebSearchTrace info={generationTarget.target.generation.web_search} />}
                  {message.role === "assistant" && <ResponseDetails metrics={generationTarget?.target.generation.metrics} snapshot={snapshot} verification={historyVerification} mode={inferenceModeForSnapshot(snapshot)} copy={copy} onVerifyAgain={generationTarget && onVerifyAgain ? kind=>onVerifyAgain(generationTarget.target.id,kind) : undefined}/>}

                </article>
              );
            })
          )}
          {liveTurn && !liveUserAlreadyPersisted ? (
            <article
              data-timeline-anchor={liveTurn.userMessageId}
              data-quick-panel-question={quickPanel ? "" : undefined}
              className={cn(
                messagesStyles.message,
                "message--user message--live",
              )}
            >
              <p
                className={cn(
                  messagesStyles.message_bubble,
                  messagesStyles.message_body,
                )}
              >
                {liveTurn.userBody}
              </p>
            </article>
          ) : null}
          {liveTargets.length > 0 &&
          liveComparison &&
          !liveComparisonAlreadyInHistory ? (
            <LiveModelComparisonGrid
              localOnly={retryLocalOnly}
              busy={isSending}
              batch={liveBatch}
              copy={copy}
              onCancelTarget={onCancelTarget}
              onRetry={onRetry}
              onSelectAnswer={onSelectAnswer}
              onVerifyAgain={onVerifyAgain}
              targets={liveTargets}
            />
          ) : !liveComparison ? (
            liveTargets.map((target) => {
              const liveGeneration = liveBatch?.targets.find(
                (candidate) => candidate.id === target.targetId,
              )?.generation;
              const liveVerification = liveGeneration?.verification;
              const liveWaiting =
                target.phase === "pending" ||
                target.phase === "verifying_environment" ||
                target.phase === "streaming" ||
                target.phase === "verifying_response";
              return (
                <article
                  className={cn(
                    messagesStyles.message,
                    `message message--assistant message--live-assistant${target.phase === "stopped" ? " message--stopped" : ""}`,
                  )}
                  data-generation-target={target.targetId ?? target.key}
                  key={target.key}
                >
                  <MessageMeta
                    role="assistant"
                    modelId={target.snapshot?.model_id ?? target.modelId}
                    providerName={target.snapshot?.provider_name}
                    copy={copy}
                    verification={liveVerification}
                    onVerifyAgain={
                      target.targetId && onVerifyAgain
                        ? (kind) => onVerifyAgain(target.targetId!, kind)
                        : undefined
                    }
                    mode={inferenceModeForSnapshot(target.snapshot)}
                  />
                  {liveWaiting && target.activity && <p role="status" className="my-2 text-xs text-muted-foreground">{target.activity}</p>}
                  {liveWaiting && <GenerationActivity stopWhenStalledOnly={Boolean(canStopFromComposer)} phase={target.phase} body={target.assistantBody} reasoning={target.reasoningBody} onStop={target.generationId && liveBatch && onCancelTarget ? ()=>onCancelTarget(liveBatch.id,target.generationId!) : onCancel}/>}
                  {target.assistantBody || target.reasoningBody ? (
                    <AssistantMessage content={target.assistantBody} reasoning={target.reasoningBody} streaming={target.phase === "streaming"} />
                  ) : null}
                  {target.phase === "stopped" ? (
                    <p className={messagesStyles.message_state}>
                      {copy.generationStopped}
                    </p>
                  ) : null}
                  {target.phase === "failed" ? (
                    <p className={messagesStyles.message_state}>
                      {generationFailureMessage(
                        target.errorCode ?? liveVerification?.failure_code,
                        copy,
                        target.errorMessage ??
                          liveVerification?.evidence_summary,
                      )}
                    </p>
                  ) : null}
                  {target.phase === "unknown" ? (
                    <p className={messagesStyles.message_state}>
                      {copy.generationDeliveryUnknown}
                    </p>
                  ) : null}
                  {!liveWaiting && liveGeneration?.configuration_snapshot.web_search && <WebSearchTrace info={liveGeneration.web_search} />}
                  {(target.assistantBody || !liveWaiting) && <ResponseDetails metrics={liveGeneration?.metrics} snapshot={target.snapshot} verification={liveVerification} copy={copy} mode={inferenceModeForSnapshot(target.snapshot)} onVerifyAgain={target.targetId && onVerifyAgain ? kind=>onVerifyAgain(target.targetId!,kind):undefined}/>}
                  {!canStopFromComposer &&
                  liveWaiting &&
                  target.assistantBody &&
                  liveBatch &&
                  target.generationId &&
                  onCancelTarget ? (
                    <StopGenerationButton
                      copy={copy}
                      onClick={() =>
                        onCancelTarget(liveBatch.id, target.generationId!)
                      }
                    />
                  ) : null}
                  {(target.phase === "failed" || target.phase === "stopped") &&
                  (target.targetId || target.generationId) &&
                  onRetry ? (
                    <Button disabled={isSending || (retryLocalOnly && target.providerId !== "cove-local")}
                      variant="outline"
                      type="button"
                      onClick={() =>
                        onRetry(
                          liveBatch?.id ?? "",
                          target.targetId ?? target.generationId!,
                        )
                      }
                    >
                      {copy.retryGeneration}
                    </Button>
                  ) : null}
                  {(target.phase==="failed" || target.phase==="stopped") && <FailureActions targetId={target.targetId} code={target.errorCode} busy={isSending}/>}
                  {liveBatch &&
                  liveBatch.targets.length > 1 &&
                  !liveBatch.context_frozen &&
                  isTerminalBatch(liveBatch) &&
                  target.phase === "completed" &&
                  target.generationId &&
                  onSelectAnswer ? (
                    <Button
                      variant="outline"
                      aria-pressed={
                        liveBatch.selected_generation_id === target.generationId
                      }
                      type="button"
                      onClick={() =>
                        onSelectAnswer(liveBatch.id, target.generationId!)
                      }
                    >
                      {copy.useForNextTurn}
                    </Button>
                  ) : null}
                </article>
              );
            })
          ) : null}
          {terminalFailedTargets.map(({ batch, target }) => (
            <article
              className={cn(
                messagesStyles.message,
                `message message--assistant message--live-assistant${target.generation.state === "stopped" ? " message--stopped" : ""}`,
              )}
              data-generation-target={target.id}
              key={`${batch.id}:${target.id}`}
            >
              <MessageMeta
                role="assistant"
                modelId={target.model_id}
                providerName={target.generation.snapshot.provider_name}
                copy={copy}
              />
              {target.generation.configuration_snapshot.web_search && <WebSearchTrace info={target.generation.web_search} />}
              <p className={messagesStyles.message_state}>
                {target.generation.state === "stopped"
                  ? copy.generationStopped
                  : generationFailureMessage(
                      target.generation.error_code,
                      copy,
                      target.generation.error_message,
                    )}
              </p>
              <ResponseDetails snapshot={target.generation.snapshot} metrics={target.generation.metrics} verification={target.generation.verification} copy={copy}/>
              <FailureActions targetId={target.id} code={target.generation.error_code} busy={isSending}/>
              {onRetry ? (
                <Button
                  variant="outline"
                  type="button"
                  disabled={isSending || (retryLocalOnly && target.provider_id !== "cove-local")}
                  onClick={() => onRetry(batch.id, target.id)}
                >
                  {copy.retryGeneration}
                </Button>
              ) : null}
            </article>
          ))}
          {terminalFailedBatches.map((batch) => (
            <ModelComparisonResultGrid
              localOnly={retryLocalOnly}
              busy={isSending}
              batch={batch}
              copy={copy}
              key={batch.id}
              messages={view.messages}
              onRetry={onRetry}
              onSelectAnswer={onSelectAnswer}
              onVerifyAgain={onVerifyAgain}
            />
          ))}
          </div>
          </div>
          {!quickPanel && <ConversationTimeline
            key={view.id}
            conversationId={view.id}
            entries={timelineEntries}
            scrollRef={messageListRef}
            onNavigate={scrollToMessage}
            copy={copy}
          />}
        </div>
        {!quickPanel && latestButton}
        <p
          className={baseStyles.chatStatusLive}
          role="status"
          aria-live="polite"
        >
          {generationActive
            ? copy.generationStreaming
            : contextDispositionBatch
              ? copy.modelComparison
              : ""}
        </p>
        <div ref={footerRef} className="flex shrink-0 flex-col" data-workspace-region="composer">
          {quickPanel && latestButton}
          {contextDispositionBatch && onSkipContext ? (
            <div className={cn(chatStyles.noteBand, focusMode && chatStyles.focusNoteBand)}>
              <div className={cn(chatStyles.noteBand_inner, focusMode && chatStyles.focusNoteInner)}>
                <span className={cn(chatStyles.noteBand_no, focusMode && "hidden")}>※</span>
                <p className={cn(chatStyles.noteBand_text, focusMode && chatStyles.focusNoteText)}>
                  {focusMode ? copy.focusContextChoice : copy.contextDispositionNote}
                </p>
                <Button
                  variant="outline"
                  className={cn(
                    chatStyles.noteBand_cta,
                    "conversation-panel__skip-context",
                    focusMode && chatStyles.focusNoteAction,
                  )}
                  type="button"
                  onClick={() => onSkipContext(contextDispositionBatch.id)}
                >
                  <span>{copy.continueWithoutAnswer}</span>
                  <ArrowRight aria-hidden="true" size={15} strokeWidth={2} />
                </Button>
              </div>
            </div>
          ) : null}
          {showComposer ? (
            <ChatComposer execution={execution}
              webSearch={webSearch}
              composerId={composerId}
              compact={focusMode}
              quickPanel={quickPanel}
              quickPanelModelControl={quickPanelModelControl}
              connectionReady={connectionReady}
              attachmentDraft={attachmentDraft}
              view={view}
              copy={copy}
              activeModelSet={activeModelSet}
              profiles={profiles}
              draft={draft}
              onDraftChange={onDraftChange}
              onSend={onSend}
              onCancel={onCancel}
              isSending={isSending}
              navigationBusy={navigationBusy}
              catalogLoading={quickPanel ? providerStatus !== "ready" : catalogLoading}
              privateMode={privateMode}
              composerRef={composerRef}
              requiresContextChoice={Boolean(contextDispositionBatch)}
            />
          ) : null}
        </div>
      </section>
    </ChatExperienceContext.Provider>
    </SourceDocuments>
  );
}
