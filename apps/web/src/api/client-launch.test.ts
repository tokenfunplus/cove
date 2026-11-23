// @vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.resetModules();
});

test("the authenticated handoff keeps the Provider setup intent and removes the session from the URL", async () => {
  window.history.replaceState(null, "", "/#cove-session=fixture-session&intent=provider-setup");
  const { browserSessionHeaders } = await import("./client");
  expect(browserSessionHeaders()["X-Cove-Session-Token"]).toBe("fixture-session");
  expect(window.location.hash).toBe("#provider-setup");
});

test("unknown handoff intents are discarded", async () => {
  window.history.replaceState(null, "", "/#cove-session=fixture-session&intent=delete-history");
  await import("./client");
  expect(window.location.hash).toBe("");
});

test("the full-chat handoff retains only the validated conversation ID", async () => {
  const id = "12345678-1234-4234-9234-123456789abc";
  window.history.replaceState(null, "", `/#cove-session=fixture-session&intent=conversation&conversation_id=${id}`);
  const { browserSessionHeaders } = await import("./client");
  expect(browserSessionHeaders()["X-Cove-Session-Token"]).toBe("fixture-session");
  expect(window.location.hash).toBe(`#conversation=${id}`);
});

test("Quick Panel authorization replaces the session and its CSRF proof in place", async () => {
  window.history.replaceState(null, "", "/?surface=quick-panel#cove-session=fixture-session");
  const client = await import("./client");
  const observe = vi.fn();
  client.observeBrowserSessionExpiry(observe);
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ csrf_token: "first-csrf" }))
    .mockResolvedValueOnce(Response.json({ error: { code: "provider_auth" } }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ error: { code: "invalid_session" } }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ csrf_token: "next-csrf" }));
  vi.stubGlobal("fetch", fetch);
  await client.getSession();
  await client.fetchLocalService("/provider-proxy");
  expect(observe).not.toHaveBeenCalled();
  await client.fetchLocalService("/api/settings");
  expect(observe).toHaveBeenCalledTimes(1);

  client.replaceBrowserSession("next-session");
  expect(window.location.search).toBe("?surface=quick-panel");
  expect(window.location.hash).toBe("");
  expect(client.browserSessionHeaders()).toEqual({ "X-Cove-Session-Token": "next-session" });
  await client.getSession();
  expect(client.browserSessionHeaders()).toEqual({
    "X-Cove-Session-Token": "next-session",
    "X-Cove-CSRF-Token": "next-csrf",
  });
});
