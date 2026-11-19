// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
