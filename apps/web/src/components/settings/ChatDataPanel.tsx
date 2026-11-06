import { settingsStyles } from "@/styles/settings";
import { primitivesStyles } from "@/styles/primitives";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type ConversationExportFormat } from "@/lib/conversation-export";
import { formatDate } from "@/lib/format-date";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { type Conversation } from "@cove/api-contract";
import { Download, Trash2 } from "lucide-react";

export function ChatDataPanel({
  conversations = [],
  generationCount = 0,
  onDelete,
  deleteDisabled = false,
  onClear,
  onExport,
  isClearing = false,
  copy = englishConversationCopy,
}: {
  conversations?: Conversation[];
  generationCount?: number;
  onDelete?: (id: string) => void;
  deleteDisabled?: boolean;
  onClear: () => void;
  onExport?: (format: ConversationExportFormat) => void;
  isClearing?: boolean;
  copy?: ApplicationCopy;
}) {
  return (
    <section className="chat-data" aria-label={copy.chatData}>
      <div className={settingsStyles.chatData_heading}>
        <div>
          <h2>{copy.chatData}</h2>
        </div>
      </div>
      <p className={settingsStyles.settingsSection_lede}>
        {copy.settingsChatDataLede}
      </p>
      <div className={settingsStyles.dataStats}>
        <div className={settingsStyles.dataStats_cell}>
          <div className={settingsStyles.dataStats_k}>
            {copy.localConversationsStat}
          </div>
          <div className={settingsStyles.dataStats_v}>
            {conversations.length}
          </div>
          <div className={settingsStyles.dataStats_s}>
            {copy.includingComparisons}
          </div>
        </div>
        <div className={settingsStyles.dataStats_cell}>
          <div className={settingsStyles.dataStats_k}>
            {copy.generationRecords}
          </div>
          <div className={settingsStyles.dataStats_v}>{generationCount}</div>
          <div className={settingsStyles.dataStats_s}>
            {copy.eachWithSnapshot}
          </div>
        </div>
      </div>
      <div
        className={cn(
          settingsStyles.workspaceSettings_row,
          settingsStyles.chatData_export,
        )}
      >
        <div className={settingsStyles.workspaceSettings_rowKey}>
          <span>{copy.exportConversationHistory}</span>
          <small>{copy.conversations}</small>
        </div>
        <p className={settingsStyles.workspaceSettings_rowDetail}>
          {copy.workspaceExportHint}
        </p>
        <div className={settingsStyles.workspaceSettings_rowControl}>
          <Button
            variant="outline"
            className={primitivesStyles.btn}
            disabled={!onExport}
            onClick={() => onExport?.("json")}
            type="button"
          >
            <Download aria-hidden="true" size={13} strokeWidth={1.8} />
            {copy.exportAsJson}
          </Button>
          <Button
            variant="outline"
            className={primitivesStyles.btn}
            disabled={!onExport}
            onClick={() => onExport?.("markdown")}
            type="button"
          >
            <Download aria-hidden="true" size={13} strokeWidth={1.8} />
            {copy.exportAsMarkdown}
          </Button>
        </div>
      </div>
      <div className={settingsStyles.chatData_conversations}>
        <h3>{copy.conversations}</h3>
        {conversations.length === 0 ? (
          <p className={settingsStyles.chatData_empty}>
            {copy.noConversations}
          </p>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <span className={settingsStyles.chatData_conversationCopy}>
                  <strong title={conversation.title}>
                    {conversation.title}
                  </strong>
                  <time dateTime={conversation.updated_at}>
                    {formatDate(conversation.updated_at)}
                  </time>
                </span>
                {onDelete ? (
                  <Button
                    variant="ghost"
                    aria-label={`${copy.deleteConversation}: ${conversation.title}`}
                    disabled={isClearing || deleteDisabled}
                    onClick={() => onDelete(conversation.id)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
                    <span>{copy.deleteConversation}</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={settingsStyles.danger}>
        <div>
          <div className={settingsStyles.danger_t}>{copy.clearChatData}</div>
          <div className={settingsStyles.danger_d}>
            {copy.clearChatDataScope}
          </div>
        </div>
        <Button
          variant="outline"
          className={cn(primitivesStyles.btn, "chat-data__clear btn--danger")}
          disabled={isClearing}
          onClick={onClear}
          type="button"
        >
          <Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
          <span>{isClearing ? copy.clearingChatData : copy.clearChatData}</span>
        </Button>
      </div>
    </section>
  );
}
