// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { LocalModelControl } from "./LocalModelControl";
import { SettingsDialogContent } from "./SettingsDialog";

vi.mock("@/api/hooks/useLocalModels", () => ({
  useLocalModels: () => ({ data: [{ id: "qwen-small-chat", state: "failed", role: "chat", runtime_ready: true, bytes: 100, downloaded_bytes: 50, error: "The model source could not be reached." }] }),
  useLocalModelAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/chat/LocalSpeech", () => ({ useLocalSpeech: () => undefined }));
afterEach(cleanup);

test("a failed model download opens Network and hides other panels from keyboard navigation", async () => {
  const user = userEvent.setup();
  render(<SettingsDialogContent initialSection="local-models">
    <section data-settings-section="local-models"><LocalModelControl id="qwen-small-chat" /></section>
    <section data-settings-section="network"><label>Proxy fixture<input defaultValue="http://localhost:7890" /></label></section>
  </SettingsDialogContent>);
  expect(screen.queryByRole("textbox")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Network settings…" }));
  expect(screen.getByRole("tab", { name: "Network" }).getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Network" }));
  expect(screen.queryByRole("button", { name: /Retry or resume/ })).toBeNull();
  await user.type(screen.getByRole("textbox"), "/draft");
  await user.click(screen.getByRole("tab", { name: "On this Mac" }));
  await user.click(screen.getByRole("button", { name: "Network settings…" }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("http://localhost:7890/draft");
});
