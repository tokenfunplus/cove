// @vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
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
