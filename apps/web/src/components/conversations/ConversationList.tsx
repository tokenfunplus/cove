import { cn } from "@/lib/utils";
import { workspaceStyles } from "@/styles/workspace";
import { primitivesStyles } from "@/styles/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { groupConversations } from "@/components/conversations/group-conversations";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { type Conversation, type ConversationSearchResult } from "@cove/api-contract";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import {
  Archive,
  MessageCircleMore,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ConversationList({
  conversations,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  searchPending = false,
  searchFailed = false,
  selectedId,
  showingArchived = false,
  onSelect,
  onCreate,
  onRename,
  onPin,
  onArchive,
  onDownload,
  onDelete,
  onShowArchived,
  onOpenSettings,
  onOpenPrivacyStatus,
  revealSearch,
  deleteDisabled = false,
  copy = englishConversationCopy,
}: {
  conversations: Conversation[];
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  searchResults?: ConversationSearchResult[];
  searchPending?: boolean;
  searchFailed?: boolean;
  selectedId: string | undefined;
  showingArchived?: boolean;
  onSelect: (id: string, messageId?: string) => void;
  onCreate?: () => void;
  onRename?: (conversation: Conversation) => void;
  onPin?: (conversation: Conversation) => void;
  onArchive?: (conversation: Conversation) => void;
  onDownload?: (conversation: Conversation) => void;
  onDelete?: (id: string) => void;
  onShowArchived?: (archived: boolean) => void;
  onOpenSettings?: () => void;
  onOpenPrivacyStatus?: () => void;
  revealSearch?: () => void;
  deleteDisabled?: boolean;
  copy?: ApplicationCopy;
}) {
  const [localQuery, setQuery] = useState("");
  const query = searchQuery ?? localQuery;
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const dialog = document.querySelector(
          '[aria-modal="true"], [role="dialog"]',
        );
        if (dialog && !dialog.contains(searchRef.current)) return;
        event.preventDefault();
        if (revealSearch) {
          revealSearch();
          requestAnimationFrame(() => searchRef.current?.focus());
        } else {
          searchRef.current?.focus();
        }
      }
    }
    if (typeof window !== "undefined")
      window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (typeof window !== "undefined")
        window.removeEventListener("keydown", handleKeyDown);
    };
  }, [revealSearch]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleConversations = normalizedQuery
    ? searchResults ?? conversations.filter((conversation) =>
        conversation.title.toLowerCase().includes(normalizedQuery),
      )
    : conversations;
  const groups = groupConversations(visibleConversations, !showingArchived);
  const matches = new Map((normalizedQuery ? searchResults ?? [] : []).map((result) => [result.id, result]));

  return (
    <div
      className={workspaceStyles.conversationListShell}
      data-workspace-region="conversation-list"
    >
      <div className="conversation-list__header">
        <Button
          variant="default"
          aria-label={copy.newConversation}
          title={copy.newConversation}
          className={workspaceStyles.conversationList_new}
          disabled={deleteDisabled}
          onClick={onCreate}
          type="button"
        >
          <Plus aria-hidden="true" size={17} strokeWidth={1.9} />
          <span>{copy.newChat}</span>
        </Button>
      </div>
      <label className={workspaceStyles.conversationList_search}>
        <Search aria-hidden="true" size={12} strokeWidth={1.8} />
        <Input
          aria-label={copy.searchPlaceholder}
          onChange={(event) => {
            setQuery(event.target.value);
            onSearchQueryChange?.(event.target.value);
          }}
          placeholder={copy.searchPlaceholder}
          ref={searchRef}
          type="text"
          maxLength={256}
          value={query}
        />
        <kbd className="pointer-coarse:hidden">⌘K</kbd>
      </label>
      {normalizedQuery && (searchPending || searchFailed) ? (
        <p className={workspaceStyles.conversationList_empty} role="status">
          {searchFailed ? copy.searchFailed : copy.searchingConversations}
        </p>
      ) : conversations.length === 0 && !normalizedQuery ? (
        <p className={workspaceStyles.conversationList_empty}>
          {copy.noConversations}
        </p>
      ) : visibleConversations.length === 0 ? (
        <p className={workspaceStyles.conversationList_empty}>
          {copy.searchNoResults}
        </p>
      ) : (
        <nav
          className={workspaceStyles.conversationList}
          aria-label={copy.chats}
        >
          {groups.map((group) => (
            <section
              className={workspaceStyles.conversationList_group}
              key={group.id}
            >
              <p className={workspaceStyles.conversationList_sectionLabel}>
                {group.label(copy)}
              </p>
              {group.conversations.map((conversation) => (
                <div
                  className={workspaceStyles.conversationRow}
                  key={conversation.id}
                >
                  <Button
                    variant="ghost"
                    title={conversation.title}
                    className={cn(
                      workspaceStyles.conversation,
                      conversation.id === selectedId
                        ? "conversation conversation--selected"
                        : "conversation",
                    )}
                    aria-current={
                      conversation.id === selectedId ? "page" : undefined
                    }
                    onClick={() => onSelect(conversation.id, matches.get(conversation.id)?.turn_message_id ?? matches.get(conversation.id)?.message_id)}
                    type="button"
                  >
                    <span className="flex min-w-0 flex-col items-start gap-1">
                      <span className={cn(workspaceStyles.conversation_title, "max-w-full")}>{conversation.title}</span>
                      {matches.get(conversation.id)?.excerpt ? (
                        <span className="line-clamp-2 max-w-full whitespace-normal break-words text-left text-xs font-normal text-muted-foreground">
                          {matches.get(conversation.id)?.role === "user" ? copy.you : copy.assistant}: {matches.get(conversation.id)?.excerpt}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                  {onRename || onPin || onArchive || onDownload || onDelete ? (
                    <ConversationActions
                      conversation={conversation}
                      disabled={deleteDisabled}
                      onArchive={onArchive}
                      onDelete={onDelete}
                      onDownload={onDownload}
                      onPin={onPin}
                      onRename={onRename}
                      copy={copy}
                    />
                  ) : null}
                </div>
              ))}
            </section>
          ))}
        </nav>
      )}
      {normalizedQuery && visibleConversations.length === 50 ? (
        <p className={workspaceStyles.conversationList_empty}>{copy.searchResultLimit}</p>
      ) : null}
      <div className={workspaceStyles.conversationList_footer}>
        {onOpenPrivacyStatus ? (
          <Button
            variant="ghost"
            aria-label={copy.privacyStatus}
            title={copy.privacyStatus}
            className={workspaceStyles.conversationList_privacy}
            onClick={onOpenPrivacyStatus}
            type="button"
          >
            <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />
            <span>{copy.privacyStatus}</span>
          </Button>
        ) : null}
        {onShowArchived ? (
          <Button
            variant="ghost"
            aria-label={showingArchived ? copy.allChats : copy.archivedChats}
            title={showingArchived ? copy.allChats : copy.archivedChats}
            aria-pressed={showingArchived}
            className={workspaceStyles.conversationList_archiveToggle}
            disabled={deleteDisabled}
            onClick={() => onShowArchived(!showingArchived)}
            type="button"
          >
            <Archive aria-hidden="true" size={16} />
            <span>{showingArchived ? copy.allChats : copy.archivedChats}</span>
          </Button>
        ) : null}
        <a
          className={workspaceStyles.conversationList_feedback}
          title={copy.feedback}
          aria-label={copy.feedback}
          href="https://github.com/tokenfunplus/cove/issues/new/choose"
          rel="noreferrer"
          target="_blank"
        >
          <MessageCircleMore aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{copy.feedback}</span>
        </a>
        <Button
          variant="ghost"
          aria-label={copy.settingsNav}
          title={copy.settingsNav}
          className={workspaceStyles.conversationList_settings}
          onClick={onOpenSettings}
          type="button"
        >
          <Settings2 aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{copy.settings}</span>
        </Button>
      </div>
    </div>
  );
}

function ConversationActions({
  conversation,
  disabled,
  onRename,
  onPin,
  onArchive,
  onDownload,
  onDelete,
  copy,
}: {
  conversation: Conversation;
  disabled: boolean;
  onRename?: (conversation: Conversation) => void;
  onPin?: (conversation: Conversation) => void;
  onArchive?: (conversation: Conversation) => void;
  onDownload?: (conversation: Conversation) => void;
  onDelete?: (id: string) => void;
  copy: ApplicationCopy;
}) {
  return (
    <Menu as="div" className={workspaceStyles.conversationActions}>
      <MenuButton
        as={Button}
        variant="ghost"
        aria-label={`${copy.conversationActions}: ${conversation.title}`}
        className={workspaceStyles.conversationActions_trigger}
        disabled={disabled}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={17} strokeWidth={2} />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        portal
        className={primitivesStyles.conversationActions_menu}
        transition
      >
        {onPin ? (
          <MenuItem>
            <Button
              variant="ghost"
              onClick={() => onPin(conversation)}
              type="button"
            >
              {conversation.pinned
                ? copy.unpinConversation
                : copy.pinConversation}
            </Button>
          </MenuItem>
        ) : null}
        {onRename ? (
          <MenuItem>
            <Button
              variant="ghost"
              onClick={() => onRename(conversation)}
              type="button"
            >
              {copy.renameConversation}
            </Button>
          </MenuItem>
        ) : null}
        {onArchive ? (
          <MenuItem>
            <Button
              variant="ghost"
              onClick={() => onArchive(conversation)}
              type="button"
            >
              {conversation.archived
                ? copy.unarchiveConversation
                : copy.archiveConversation}
            </Button>
          </MenuItem>
        ) : null}
        {onDownload ? (
          <MenuItem>
            <Button
              variant="ghost"
              onClick={() => onDownload(conversation)}
              type="button"
            >
              {copy.downloadConversation}
            </Button>
          </MenuItem>
        ) : null}
        {onDelete ? (
          <MenuItem>
            <Button
              variant="ghost"
              className={primitivesStyles.conversationActions_delete}
              onClick={() => onDelete(conversation.id)}
              type="button"
            >
              {copy.deleteConversation}
            </Button>
          </MenuItem>
        ) : null}
      </MenuItems>
    </Menu>
  );
}
