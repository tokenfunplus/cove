// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AttachmentSnapshot } from "@cove/api-contract";
import * as api from "@/api";
import { useAttachmentDraft } from "./use-attachment-draft";

const preview = vi.hoisted(() => vi.fn());
vi.mock("@/api/hooks/useGenerations", () => ({ usePreviewAttachment: () => ({ mutateAsync: preview }) }));
vi.mock("@/api", async importOriginal => ({ ...await importOriginal<typeof import("@/api")>(), prepareWebSource: vi.fn(), releaseWebSource: vi.fn() }));
const snapshot: AttachmentSnapshot = { id: "a".repeat(64), name: "Evidence", media_type: "text/plain", extraction_version: "v1", characters: 8, size: 8, sections: [{ id: "L1", text: "Evidence" }] };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

test("prepared webpages expire visibly and restored submissions cannot reuse expired tokens", async () => {
  vi.useFakeTimers();
  vi.mocked(api.releaseWebSource).mockResolvedValue(undefined);
  vi.mocked(api.prepareWebSource).mockResolvedValue({ source_token: "synthetic-token", snapshot, expires_at: new Date(Date.now() + 60_000).toISOString() });
  const { result } = renderHook(() => useAttachmentDraft("chat-1"));
  await act(() => result.current.addWebSource("https://example.com"));
  expect(result.current.invalid).toBe(false);
  const original = result.current.attachments;
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current.invalid).toBe(true);
  expect(result.current.attachments[0].error).toContain("Remove it and read the webpage again");
  act(() => result.current.clearAttachments(false));
  act(() => result.current.restoreAttachments(original));
  expect(result.current.invalid).toBe(true);
  act(() => result.current.removeAttachment(original[0].key));
  expect(result.current.invalid).toBe(false);
  expect(result.current.attachments).toEqual([]);
});

test("submission rechecks expiry when background timers have not run, while file previews remain valid", async () => {
  vi.useFakeTimers();
  vi.mocked(api.releaseWebSource).mockResolvedValue(undefined);
  const { result } = renderHook(() => useAttachmentDraft("chat-1"));
  const expiresAt = Date.now() + 60_000;
  act(() => result.current.restoreAttachments([
    { key: "file", name: "notes.txt", snapshot, input: { name: "notes.txt", data: "RXZpZGVuY2U=" } },
    { key: "web", name: "Page", snapshot, webSourceToken: "synthetic-token", expiresAt },
  ]));
  vi.setSystemTime(expiresAt);
  act(() => { expect(result.current.validateAttachments()).toBe(false); });
  expect(result.current.attachments[0].error).toBeUndefined();
  expect(result.current.attachments[1].error).toContain("expired");
  act(() => result.current.removeAttachment("web"));
  expect(result.current.validateAttachments()).toBe(true);
  expect(result.current.attachments[0].input?.name).toBe("notes.txt");
});
