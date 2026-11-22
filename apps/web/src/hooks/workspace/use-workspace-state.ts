import {
  useConversation,
  useConversations,
} from "@/api/hooks/useConversations";
import { useProviders } from "@/api/hooks/useProviders";
import { useLocalSession } from "@/api/hooks/useSession";
import { useSettings } from "@/api/hooks/useSettings";
import { conversationKeys, settingsKey } from "@/api/queryKeys";
import {
  activeModelSetFromWorkspaceSettings,
  type ActiveModelSet,
} from "@/components/providers/model-selection";
import { defaultWorkspaceSettings } from "@/components/settings/settings-model";
import type { ConnectionState } from "@/lib/workspace-types";
import type { ConversationView, WorkspaceSettings } from "@cove/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

export function useWorkspaceState(showingArchived: boolean) {
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [activeModelSet, setActiveModelSet] = useState<ActiveModelSet>([]);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const initialized = useRef(false);
  const session = useLocalSession();
  const list = useConversations(showingArchived);
  const providers = useProviders();
  const preferences = useSettings();
  const conversation = useConversation(selectedId);
  const [recoveredConnection, setConnection] = useState<ConnectionState>();
  const bootQueries = [session, list, providers, preferences];
  const connection: ConnectionState =
    recoveredConnection ??
    (bootQueries.some((query) => query.isPending)
      ? "loading"
      : bootQueries.some((query) => query.isError) || !session.data
        ? "unavailable"
        : "ready");

  useEffect(() => {
    if (
      initialized.current ||
      connection !== "ready" ||
      !list.data ||
      !providers.data ||
      !preferences.data
    )
      return;
    initialized.current = true;
    setSelectedId(list.data.find(conversation => !conversation.project_id)?.id);
    setActiveModelSet(
      activeModelSetFromWorkspaceSettings(preferences.data, providers.data),
    );
  }, [connection, list.data, providers.data, preferences.data]);

  function setConversationView(view: ConversationView | undefined) {
    if (view) cache.setQueryData(conversationKeys.detail(view.id), view);
  }

  return {
    connection,
    setConnection,
    conversations: list.data ?? [],
    providerProfiles: providers.data ?? [],
    settings: preferences.data ?? defaultWorkspaceSettings,
    selectedId,
    setSelectedId,
    selectedIdRef,
    activeModelSet,
    setActiveModelSet,
    conversationView: selectedId ? conversation.data : undefined,
    conversationError: conversation.error,
    isLoadingConversation: Boolean(selectedId && conversation.isPending),
    setConversationView,
    setSettings: (value: WorkspaceSettings) =>
      cache.setQueryData(settingsKey, value),
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
