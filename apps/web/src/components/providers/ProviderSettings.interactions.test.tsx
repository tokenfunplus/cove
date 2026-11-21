// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ProviderSettings } from "./ProviderSettings";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { LocalServiceError } from "@/api/client";

const patchedMethods: string[] = [];
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  // JSDOM omits browser methods used by Radix's pointer and focus handling.
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"]) {
    if (Reflect.get(Element.prototype, name) !== undefined) continue;
    Object.defineProperty(Element.prototype, name, { configurable: true, value: name === "hasPointerCapture" ? () => false : () => {} });
    patchedMethods.push(name);
  }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); for (const name of patchedMethods.splice(0)) Reflect.deleteProperty(Element.prototype, name); });

test.each([undefined, "provider-one"])("settings follow a later active Provider (initial: %s)", async (initialProviderId) => {
  const { profile } = createWorkspaceFixture();
  const active = { ...profile, id: "active-provider", name: "Active Provider", endpoint: "https://active.example" };
  const probe = vi.fn().mockResolvedValue({ models: [active.model_id] });
  const props = { profiles: [profile, active], onSave: vi.fn(), onTest: probe, onDelete: vi.fn(), onDeleteKey: vi.fn() };
  const { rerender } = render(<ProviderSettings {...props} initialProviderId={initialProviderId} />);
  rerender(<ProviderSettings {...props} initialProviderId={active.id} />);
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe(active.endpoint);
  await userEvent.setup().click(screen.getByRole("button", { name: "Test connection" }));
  expect(probe).toHaveBeenCalledWith(expect.objectContaining({ id: active.id, endpoint: active.endpoint }));
});

test("settings adopt an active Provider whose profile arrives after the fallback", () => {
  const { profile } = createWorkspaceFixture();
  const active = { ...profile, id: "active-provider", name: "Active Provider", endpoint: "https://active.example" };
  const props = { initialProviderId: active.id, onSave: vi.fn(), onTest: vi.fn(), onDelete: vi.fn(), onDeleteKey: vi.fn() };
  const { rerender } = render(<ProviderSettings {...props} profiles={[profile]} />);
  rerender(<ProviderSettings {...props} profiles={[profile, active]} />);
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe(active.endpoint);
});

test("an active Provider change waits for a pending test and clears its old result", async () => {
  const { profile } = createWorkspaceFixture();
  const active = { ...profile, id: "active-provider", name: "Active Provider", endpoint: "https://active.example" };
  let finish!: (result: { models: string[] }) => void;
  const probe = vi.fn(() => new Promise<{ models: string[] }>(resolve => { finish = resolve; }));
  const props = { profiles: [profile, active], onSave: vi.fn(), onTest: probe, onDelete: vi.fn(), onDeleteKey: vi.fn() };
  const { rerender } = render(<ProviderSettings {...props} initialProviderId={profile.id} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Test connection" }));
  rerender(<ProviderSettings {...props} initialProviderId={active.id} />);
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe(profile.endpoint);
  await act(async () => finish({ models: [profile.model_id] }));
  await waitFor(() => expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe(active.endpoint));
  expect(screen.queryByText("Connection verified")).toBeNull();
});

test("refreshing profiles preserves a manually selected Provider and its draft", async () => {
  const { profile } = createWorkspaceFixture();
  const other = { ...profile, id: "other-provider", name: "Other Provider" };
  const props = { profiles: [profile, other], initialProviderId: profile.id, onSave: vi.fn(), onTest: vi.fn(), onDelete: vi.fn(), onDeleteKey: vi.fn() };
  const { rerender } = render(<ProviderSettings {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Provider" }));
  await user.click(screen.getByRole("option", { name: other.name }));
  await user.type(screen.getByLabelText("Display name"), " draft");
  rerender(<ProviderSettings {...props} profiles={[{ ...profile }, { ...other }]} />);
  expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe(other.name + " draft");
});

function setup() {
  const fixture = createWorkspaceFixture();
  const probe = vi.fn().mockResolvedValue({ models: ["nearai-fixture"], model_metadata: [{ id: "nearai-fixture", privacy_mode: "private_tee", verifiable: true }] });
  render(<ProviderSettings profiles={[]} onSave={async () => fixture.profile} onTest={probe} onDelete={async () => {}} onDeleteKey={async () => {}} />);
  return { user: userEvent.setup(), probe };
}

test("setup without saved Providers starts with a blank OpenAI-compatible connection", () => {
  const { probe } = setup();
  expect(screen.getByRole("combobox", { name: "Connection type" }).textContent).toBe("OpenAI-compatible");
  expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).readOnly).toBe(false);
  expect(probe).not.toHaveBeenCalled();
});

test("expired local authorization is explained without labelling the Provider as failed", async () => {
  const { user, probe } = setup();
  probe.mockRejectedValueOnce(new LocalServiceError({error:{code:"invalid_session",message:"A valid browser session is required.",details:null,request_id:"fixture"}}));
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findByText("Local browser access is no longer valid. Reopen Cove from the Launcher, then try again.");
  expect(screen.queryByText("Provider connection failed")).toBeNull();
  expect(screen.getByText("Key not configured")).toBeTruthy();
  expect(probe).toHaveBeenCalledTimes(1);
});

test("switching a tested NearAI draft to OpenAI-compatible clears its identity and stale connection data", async () => {
  const { user, probe } = setup();
  await user.click(screen.getByRole("combobox", { name: "Connection type" }));
  await user.click(screen.getByRole("option", { name: "NearAI preset" }));
  expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("NearAI");
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe("https://cloud-stg-api.near.ai");
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).readOnly).toBe(true);
  await user.type(screen.getByLabelText("API Key"), "synthetic-nearai-key");
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findAllByText("Connection verified");
  expect((screen.getByRole("combobox", { name: "Model" }) as HTMLInputElement).value).toBe("nearai-fixture");

  await user.click(screen.getByRole("combobox", { name: "Connection type" }));
  await user.click(screen.getByRole("option", { name: "OpenAI-compatible" }));
  expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Endpoint") as HTMLInputElement).readOnly).toBe(false);
  expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("combobox", { name: "Model" }) as HTMLInputElement).value).toBe("");
  expect(screen.queryAllByText("Connection verified")).toHaveLength(0);
  expect(probe).toHaveBeenCalledTimes(1);
});

test.each([false, true])("saving settings without a new key does not invent a successful connection test (previous failure: %s)", async (failed) => {
  const { profile } = createWorkspaceFixture();
  const save = vi.fn().mockResolvedValue(profile);
  const probe = vi.fn().mockRejectedValue(new LocalServiceError({
    error: { code: "authentication_failed", message: "Rejected", details: null, request_id: "fixture" },
  }));
  render(<ProviderSettings profiles={[profile]} onSave={save} onTest={probe} onDelete={async () => {}} onDeleteKey={async () => {}} />);
  const user = userEvent.setup();
  if (failed) {
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText("The Provider rejected the API key");
  }
  await user.type(screen.getByLabelText("Display name"), " renamed");
  await user.click(screen.getByRole("button", { name: "Save Provider" }));
  await screen.findByText("Provider saved");
  expect(screen.queryByText("Connection verified")).toBeNull();
  expect(screen.getByText(failed ? "Provider connection failed" : "Key configured")).toBeTruthy();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: profile.id, name: profile.name + " renamed" }));
  expect(save.mock.calls[0][0].secret).toBeUndefined();
  expect(probe).toHaveBeenCalledTimes(failed ? 1 : 0);
});
