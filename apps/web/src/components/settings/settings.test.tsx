import { ChatDataPanel } from "@/components/settings/ChatDataPanel";
import { SettingsDialogContent } from "@/components/settings/SettingsDialog";
import { WorkspaceSettingsPanel } from "@/components/settings/WorkspaceSettingsPanel";
import {
  isSystemPromptWithinLimit,
  modelParameterFormValue,
  parseModelParameters,
} from "@/components/settings/settings-model";
import type { Conversation, WorkspaceSettings } from "@cove/api-contract";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("workspace settings expose global system prompt and optional model parameters", () => {
  const settings: WorkspaceSettings = {
    theme: "system",
    locale: "system",
    system_prompt: "",
    temperature: null,
    top_p: null,
    max_tokens: null,
    active_model_set: [],
  };
  const markup = renderToStaticMarkup(
    <WorkspaceSettingsPanel settings={settings} onSave={async () => {}} />,
  );

  expect(markup).toContain("Settings");
  expect(markup).toContain('aria-label="Theme"');
  expect(markup).toContain('aria-label="Language"');
  expect(markup).toContain("Follow system");
  expect(markup).toContain("Model parameters");
  expect(markup).toContain("Temperature");
  expect(markup).toContain("Top P");
  expect(markup).toContain("Max tokens");
  expect(markup).not.toContain("maxlength");
});

test("model parameter form values retain provider defaults when blank and reject unsupported values", () => {
  expect(modelParameterFormValue(null)).toBe("");
  expect(modelParameterFormValue(0.7)).toBe("0.7");
  expect(
    parseModelParameters({ temperature: "0", topP: "0.95", maxTokens: "2048" }),
  ).toEqual({ temperature: 0, top_p: 0.95, max_tokens: 2048 });
  expect(
    parseModelParameters({ temperature: "", topP: "", maxTokens: "" }),
  ).toEqual({ temperature: null, top_p: null, max_tokens: null });
  expect(
    parseModelParameters({ temperature: "2.1", topP: "0.2", maxTokens: "1" }),
  ).toBeUndefined();
  expect(
    parseModelParameters({ temperature: "1", topP: "1.1", maxTokens: "1" }),
  ).toBeUndefined();
  expect(
    parseModelParameters({ temperature: "1", topP: "0.5", maxTokens: "1.5" }),
  ).toBeUndefined();
});

test("chat workspace explains the clear scope before offering the destructive action", () => {
  const markup = renderToStaticMarkup(<ChatDataPanel onClear={() => {}} />);

  expect(markup).toContain("Clear chat data");
  expect(markup).toContain(
    "Deletes all local conversations, messages, Generations, Provider Snapshots, and the local document library.",
  );
  expect(markup).toContain(
    "Provider Profiles, workspace settings, and saved Provider Keys are kept.",
  );
  expect(markup).toContain("Projects and project materials, downloaded models");
  expect(markup).toContain("data-stats");
  expect(markup).toContain("JSON");
  expect(markup).toContain("Markdown");
  expect(markup).toContain("all active and archived conversations");
});

test("settings dialog content exposes General, Provider, and Chat Data sections", () => {
  const markup = renderToStaticMarkup(
    <SettingsDialogContent>
      <section data-settings-section="general">
        <h3>General</h3>
      </section>
      <section data-settings-section="provider">
        <h3>Provider settings</h3>
      </section>
      <section data-settings-section="chat-data">
        <h3>Chat data</h3>
      </section>
    </SettingsDialogContent>,
  );

  expect(markup).toContain("Settings");
  expect(markup).toContain('data-settings-section="general"');
  expect(markup).toContain('data-settings-section="provider"');
  expect(markup).toContain('data-settings-section="chat-data"');
  expect(markup).toContain('aria-label="Close settings"');
});

test("settings dialog uses a left-hand selector and one active content panel", () => {
  const markup = renderToStaticMarkup(
    <SettingsDialogContent>
      <section data-settings-section="general">
        <h3>General</h3>
      </section>
      <section data-settings-section="provider">
        <h3>Provider settings</h3>
      </section>
      <section data-settings-section="chat-data">
        <h3>Chat data</h3>
      </section>
    </SettingsDialogContent>,
  );

  expect(markup).toMatch(/class="[^"\n]*\bsettings\-dialog__content\b[^"\n]*"/);
  expect(markup).toContain('data-active-settings-section="general"');
  expect(markup).toContain('aria-selected="true"');
  expect(markup).not.toContain('href="#settings-general"');
});

test("chat data settings exposes a delete action for each conversation", () => {
  const conversations: Conversation[] = [
    {
      id: "conversation-1",
      title: "Keep locally",
      created_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z",
    },
  ];

  const markup = renderToStaticMarkup(
    <ChatDataPanel
      conversations={conversations}
      onDelete={() => {}}
      onClear={() => {}}
    />,
  );

  expect(markup).toContain('aria-label="Delete: Keep locally"');
});

test("system prompt limit counts Unicode characters rather than UTF-16 code units", () => {
  expect(isSystemPromptWithinLimit("😀".repeat(8192))).toBe(true);
  expect(isSystemPromptWithinLimit("😀".repeat(8193))).toBe(false);
});

test("settings show the supported English interface without unavailable language controls", () => {
  const settings: WorkspaceSettings = {
    theme: "system",
    locale: "system",
    system_prompt: "",
    temperature: null,
    top_p: null,
    max_tokens: null,
    active_model_set: [],
  };
  const markup = renderToStaticMarkup(
    <WorkspaceSettingsPanel settings={settings} onSave={async () => {}} />,
  );
  expect(markup).toContain('aria-label="Language"');
  expect(markup).toContain("Follow system");
  expect(markup).toContain("English");
  expect(markup).not.toContain('aria-pressed="false">Chinese');
  expect(markup).toContain("Messages and prompts can use any language");
});
