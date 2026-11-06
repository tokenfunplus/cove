import { SkinPicker } from "@/components/settings/SkinPicker";
import { settingsStyles } from "@/styles/settings";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type ProviderFeedback } from "@/components/providers/provider-feedback";
import {
  isSystemPromptWithinLimit,
  modelParameterFormValue,
  parseModelParameters,
} from "@/components/settings/settings-model";
import {
  type ApplicationCopy,
  applicationMessages,
  englishConversationCopy,
} from "@/messages";
import { applyDocumentTheme } from "@/theme/theme";
import {
  type ThemePreference,
  type WorkspaceSettings,
} from "@cove/api-contract";
import { useEffect, useState } from "react";

export function WorkspaceSettingsPanel({
  settings,
  onSave,
  copy = englishConversationCopy,
}: {
  settings: WorkspaceSettings;
  onSave: (settings: WorkspaceSettings) => Promise<void>;
  copy?: ApplicationCopy;
}) {
  const [theme, setTheme] = useState<ThemePreference>(settings.theme);
  const locale = "en" as const;
  const [systemPrompt, setSystemPrompt] = useState(settings.system_prompt);
  const [temperature, setTemperature] = useState(
    modelParameterFormValue(settings.temperature),
  );
  const [topP, setTopP] = useState(modelParameterFormValue(settings.top_p));
  const [maxTokens, setMaxTokens] = useState(
    modelParameterFormValue(settings.max_tokens),
  );
  const [feedback, setFeedback] = useState<ProviderFeedback>();

  useEffect(() => {
    setSystemPrompt(settings.system_prompt);
    setTemperature(modelParameterFormValue(settings.temperature));
    setTopP(modelParameterFormValue(settings.top_p));
    setMaxTokens(modelParameterFormValue(settings.max_tokens));
  }, [
    settings.system_prompt,
    settings.temperature,
    settings.top_p,
    settings.max_tokens,
  ]);

  useEffect(() => setTheme(settings.theme), [settings.theme]);

  async function persistAppearance(next: { theme?: ThemePreference }) {
    const nextTheme = next.theme ?? theme;
    if (next.theme !== undefined) {
      setTheme(nextTheme);
      applyDocumentTheme(nextTheme);
    }
    try {
      await onSave({ ...settings, theme: nextTheme, locale });
    } catch {
      setTheme(settings.theme);
      applyDocumentTheme(settings.theme);
      setFeedback({ text: copy.settingsFailed, tone: "error" });
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!isSystemPromptWithinLimit(systemPrompt)) {
      setFeedback({ text: copy.promptTooLong, tone: "error" });
      return;
    }
    const parameters = parseModelParameters({ temperature, topP, maxTokens });
    if (!parameters) {
      setFeedback({ text: copy.modelParametersInvalid, tone: "error" });
      return;
    }
    try {
      await onSave({
        theme,
        locale,
        system_prompt: systemPrompt,
        ...parameters,
        active_model_set: settings.active_model_set,
      });
      setFeedback({
        text: applicationMessages(locale).settingsSaved,
        tone: "success",
      });
    } catch {
      setFeedback({ text: copy.settingsFailed, tone: "error" });
    }
  }

  return (
    <section
      className="workspace-settings"
      id="workspace-settings"
      aria-label={copy.settings}
    >
      <div className={settingsStyles.workspaceSettings_heading}>
        <div>
          <h2>{copy.general}</h2>
        </div>
      </div>
      <p className={settingsStyles.settingsSection_lede}>
        {copy.settingsGeneralLede}
      </p>
      <form className="workspace-settings__form" onSubmit={save}>
        <div className={settingsStyles.workspaceSettings_row}>
          <div className={settingsStyles.workspaceSettings_rowKey}>
            <span>{copy.language}</span>
            <small>Interface</small>
          </div>
          <p className={settingsStyles.workspaceSettings_rowDetail}>
            {copy.settingsLanguageDetail}
          </p>
          <div className={settingsStyles.workspaceSettings_rowControl}>
            <span aria-label={copy.language}>{copy.english}</span>
          </div>
        </div>
        <div className={settingsStyles.workspaceSettings_row}>
          <div className={settingsStyles.workspaceSettings_rowKey}>
            <span>{copy.theme}</span>
            <small>{copy.appearance}</small>
          </div>
          <p className={settingsStyles.workspaceSettings_rowDetail}>
            {copy.settingsThemeDetail}
          </p>
          <div className={settingsStyles.workspaceSettings_rowControl}>
            <div
              className={settingsStyles.seg}
              role="group"
              aria-label={copy.theme}
            >
              {(
                [
                  ["light", copy.light],
                  ["dark", copy.dark],
                  ["system", copy.followSystem],
                ] as const
              ).map(([value, label]) => (
                <Button
                  variant="outline"
                  aria-pressed={theme === value}
                  className={theme === value ? "is-on" : ""}
                  key={value}
                  onClick={() => void persistAppearance({ theme: value })}
                  type="button"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="pt-4">
          <SkinPicker />
        </div>
        <label className={settingsStyles.workspaceSettings_prompt}>
          {copy.systemPrompt}
          <Textarea
            value={systemPrompt}
            rows={4}
            aria-describedby="system-prompt-hint"
            onChange={(event) => {
              if (isSystemPromptWithinLimit(event.target.value)) {
                setSystemPrompt(event.target.value);
              }
            }}
          />
          <small id="system-prompt-hint">{copy.systemPromptHint}</small>
        </label>
        <fieldset className={settingsStyles.workspaceSettings_parameters}>
          <legend>{copy.modelParameters}</legend>
          <small id="model-parameters-hint">{copy.modelParametersHint}</small>
          <div className={settingsStyles.workspaceSettings_parameterFields}>
            <label>
              {copy.temperature}
              <Input
                aria-describedby="model-parameters-hint"
                inputMode="decimal"
                max="2"
                min="0"
                onChange={(event) => setTemperature(event.target.value)}
                step="0.1"
                type="number"
                value={temperature}
              />
            </label>
            <label>
              {copy.topP}
              <Input
                aria-describedby="model-parameters-hint"
                inputMode="decimal"
                max="1"
                min="0"
                onChange={(event) => setTopP(event.target.value)}
                step="0.01"
                type="number"
                value={topP}
              />
            </label>
            <label>
              {copy.maxTokens}
              <Input
                aria-describedby="model-parameters-hint"
                inputMode="numeric"
                min="1"
                onChange={(event) => setMaxTokens(event.target.value)}
                step="1"
                type="number"
                value={maxTokens}
              />
            </label>
          </div>
        </fieldset>
        <div className={settingsStyles.workspaceSettings_actions}>
          <Button variant="default" type="submit">
            {copy.saveSettings}
          </Button>
        </div>
      </form>
      {feedback ? (
        <p
          className={cn(
            settingsStyles.workspaceSettings_message,
            `workspace-settings__message workspace-settings__message--${feedback.tone}`,
          )}
          role="status"
        >
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
