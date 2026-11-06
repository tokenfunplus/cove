import { ConversationList } from "@/components/conversations/ConversationList";
import { groupConversations } from "@/components/conversations/group-conversations";
import type { Conversation } from "@cove/api-contract";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.useRealTimers());

test("conversation workspace shows an empty local history state", () => {
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[]}
      selectedId={undefined}
      onSelect={() => {}}
    />,
  );

  expect(markup).toContain("No local conversations yet");
});

test("conversation workspace shows locally persisted conversation titles", () => {
  const conversations: Conversation[] = [
    {
      id: "conversation-1",
      title: "Offline chat",
      created_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z",
    },
  ];

  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={conversations}
      selectedId="conversation-1"
      onSelect={() => {}}
    />,
  );

  expect(markup).toContain("Offline chat");
  expect(markup).toContain("conversation--selected");
});

test("conversation workspace exposes the selected conversation to assistive technology", () => {
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[
        {
          id: "conversation-1",
          title: "Current chat",
          created_at: "2026-09-10T00:00:00Z",
          updated_at: "2026-09-10T00:00:00Z",
        },
      ]}
      selectedId="conversation-1"
      onSelect={() => {}}
    />,
  );

  expect(markup).toContain('aria-current="page"');
});

test("conversation workspace offers a new conversation action", () => {
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[]}
      selectedId={undefined}
      onSelect={() => {}}
    />,
  );

  expect(markup).toContain("New conversation");
});

test("conversation navigation presents the NearAI-inspired recent-workspace treatment", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[
        {
          id: "conversation-1",
          title: "Today chat",
          created_at: "2026-09-12T00:00:00Z",
          updated_at: "2026-09-12T00:00:00Z",
        },
        {
          id: "conversation-2",
          title: "Previous chat",
          created_at: "2026-09-07T00:00:00Z",
          updated_at: "2026-09-07T00:00:00Z",
        },
      ]}
      selectedId="conversation-1"
      onSelect={() => {}}
    />,
  );

  expect(markup).not.toContain("conversation-list__chats-heading");
  expect(markup).toContain('aria-label="Chats"');
  expect(markup).toContain("Today");
  expect(markup).toContain("Previous 7 days");
  expect(markup).toContain("Today chat");
  expect(markup).toContain("Previous chat");
  expect(markup).toContain('aria-label="Settings"');
  expect(markup).toContain("Feedback");
  expect(markup).toContain("github.com/tokenfunplus/cove/issues/new/choose");
});

test("conversation navigation places settings in the lower-left without an account profile", () => {
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[]}
      selectedId={undefined}
      onSelect={() => {}}
      onOpenSettings={() => {}}
    />,
  );

  expect(markup).toMatch(
    /class="[^"\n]*\bconversation\-list__settings\b[^"\n]*"/,
  );
  expect(markup).toContain("<span>Settings</span>");
  expect(markup).not.toContain("conversation-list__avatar");
  expect(markup).not.toContain("<strong>Cove</strong>");
});

test("conversation workspace exposes a secondary action menu for each conversation", () => {
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[
        {
          id: "conversation-1",
          title: "Delete locally",
          created_at: "2026-09-10T00:00:00Z",
          updated_at: "2026-09-10T00:00:00Z",
        },
      ]}
      selectedId="conversation-1"
      onSelect={() => {}}
      onDelete={() => {}}
    />,
  );

  expect(markup).toMatch(
    /class="[^"\n]*\bconversation\-actions__trigger\b[^"\n]*"/,
  );
  expect(markup).toContain('aria-label="Conversation actions: Delete locally"');
});

test("conversation navigation puts pinned chats ahead of local time groups", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  const groups = groupConversations([
    {
      id: "today",
      title: "Today",
      created_at: "2026-09-12T00:00:00Z",
      updated_at: "2026-09-12T00:00:00Z",
    },
    {
      id: "pinned",
      title: "Pinned",
      pinned: true,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    },
  ]);

  expect(groups.map((group) => group.id)).toEqual(["pinned", "today"]);
  expect(groups[0]?.conversations[0]?.title).toBe("Pinned");
});
