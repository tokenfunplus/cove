// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "@/api/download-network";
import { LocalServiceError } from "@/api/client";
import { NetworkSettingsPanel } from "./NetworkSettingsPanel";

vi.mock("@/api/download-network", () => ({ getDownloadNetwork: vi.fn(), saveDownloadNetwork: vi.fn(), testDownloadNetwork: vi.fn() }));
import { setupControlTests } from "@/test/control-helpers";
setupControlTests();
beforeEach(() => {
  vi.mocked(api.getDownloadNetwork).mockResolvedValue({ configuration: { mode: "system", proxy_url: "" }, system_proxy_supported: true });
  vi.mocked(api.saveDownloadNetwork).mockImplementation(async configuration => ({ configuration, system_proxy_supported: true }));
  vi.mocked(api.testDownloadNetwork).mockResolvedValue({ ok: true, checks: [{ source: "Hugging Face", ok: true, message: "Download source reached." }] });

});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

test("connection test uses the draft without saving; save applies it for retries", async () => {
  const user = userEvent.setup(); render(<NetworkSettingsPanel />);
  await user.click(await screen.findByRole("combobox", { name: "Download connection" }));
  await user.click(screen.getByRole("option", { name: "Manual proxy" }));
  await user.type(screen.getByLabelText("Proxy address"), "socks5://localhost:1080");
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findByText("Download sources are reachable.");
  expect(api.testDownloadNetwork).toHaveBeenCalledWith({ mode: "manual", proxy_url: "socks5://localhost:1080" });
  expect(api.saveDownloadNetwork).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText(/Saved. Retry the download/);
  expect(api.saveDownloadNetwork).toHaveBeenCalledWith({ mode: "manual", proxy_url: "socks5://localhost:1080" });
  expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(true);
});

test("failed save preserves the draft and switching away from Manual omits its address", async () => {
  const user = userEvent.setup(); render(<NetworkSettingsPanel />);
  await user.click(await screen.findByRole("combobox", { name: "Download connection" }));
  await user.click(screen.getByRole("option", { name: "Manual proxy" }));
  await user.type(screen.getByLabelText("Proxy address"), "http://localhost:7890");
  vi.mocked(api.saveDownloadNetwork).mockRejectedValueOnce(new Error("Could not save settings."));
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Proxy address") as HTMLInputElement).value).toBe("http://localhost:7890");
  expect(screen.getByLabelText("Proxy address").getAttribute("aria-invalid")).toBe("false");
  await user.click(screen.getByRole("combobox", { name: "Download connection" }));
  await user.click(screen.getByRole("option", { name: "Direct connection" }));
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(api.saveDownloadNetwork).toHaveBeenLastCalledWith({ mode: "direct", proxy_url: "" }));
});

test("proxy validation is associated with its field and cleared when edited", async () => {
  const user = userEvent.setup(); render(<NetworkSettingsPanel />);
  await user.click(await screen.findByRole("combobox", { name: "Download connection" }));
  await user.click(screen.getByRole("option", { name: "Manual proxy" }));
  const field = screen.getByLabelText("Proxy address");
  await user.type(field, "http://localhost");
  vi.mocked(api.saveDownloadNetwork).mockRejectedValueOnce(new LocalServiceError({ error: { code: "validation", message: "Use a proxy host and port.", details: null, request_id: "network-validation-test" } }));
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  const error = await screen.findByRole("alert");
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
  await user.type(field, ":7890");
  expect(field.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(field.getAttribute("aria-describedby")?.split(" ")).not.toContain(error.id);
});

test("unreadable saved settings can be replaced from the UI", async () => {
  vi.mocked(api.getDownloadNetwork).mockRejectedValueOnce(new Error("Invalid file."));
  const user = userEvent.setup(); render(<NetworkSettingsPanel />);
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText(/Saved. Retry the download/);
  expect(api.saveDownloadNetwork).toHaveBeenCalledWith({ mode: "system", proxy_url: "" });
});
