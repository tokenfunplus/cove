import { ModelPicker } from "./ModelPicker";
import { settingsStyles } from "@/styles/settings";
import { primitivesStyles } from "@/styles/primitives";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { defaultModelAfterTest } from "@/components/providers/model-selection";
import {
  providerConnectionLabel,
  providerConnectionStatus,
  providerErrorFeedback,
  isLocalProviderSetupError,
  type ProviderFeedback,
} from "@/components/providers/provider-feedback";
import { FrontSelect } from "@/components/ui/front-select";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import {
  type ProviderProfile,
  type ProviderProfileInput,
  type ProviderModelMetadata,
  type ProviderValidationResponse,
} from "@cove/api-contract";
import { KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProviderAuthMethod } from "@cove/api-contract";
import { allowsNoAuthentication, providerPresetId, providerPresets } from "@/lib/provider-presets";

export function ProviderSettings({
  id,
  profiles: allProfiles,
  initialProviderId,
  onSave,
  onTest,
  onDelete,
  onDeleteKey,
  onOpenLocalModels,
  copy = englishConversationCopy,
}: {
  id?: string;
  profiles: ProviderProfile[];
  initialProviderId?: string;
  onSave: (input: ProviderProfileInput) => Promise<ProviderProfile>;
  onTest: (
    input: ProviderProfileInput,
  ) => Promise<string[] | ProviderValidationResponse>;
  onDelete: (id: string) => Promise<void>;
  onDeleteKey: (id: string) => Promise<void>;
  onOpenLocalModels?:()=>void;
  copy?: ApplicationCopy;
}) {
  const profiles=allProfiles.filter((profile):profile is ProviderProfile & {kind:"nearai"|"openai_compatible"}=>profile.kind!=="local");
  const existing =
    profiles.find((profile) => profile.id === initialProviderId) ?? profiles[0];
  const [selectedProviderId, setSelectedProviderId] = useState(
    existing?.id ?? "",
  );
  const selectedProfile = profiles.find(
    (profile) => profile.id === selectedProviderId,
  );
  const [kind, setKind] = useState<"nearai" | "openai_compatible">(
    selectedProfile?.kind ?? "openai_compatible",
  );
  const [name, setName] = useState(selectedProfile?.name ?? "");
  const [endpoint, setEndpoint] = useState(selectedProfile?.endpoint ?? "");
  const [presetId, setPresetId] = useState(() => providerPresetId(selectedProfile));
  const [authMethod, setAuthMethod] = useState<ProviderAuthMethod>(
    selectedProfile?.auth_method ?? "bearer",
  );
  const [model, setModel] = useState(selectedProfile?.model_id ?? "");
  const [secret, setSecret] = useState("");
  const [models, setModels] = useState<string[]>(
    selectedProfile?.model_id ? [selectedProfile.model_id] : [],
  );
  const [metadata, setMetadata] = useState<
    Record<string, ProviderModelMetadata>
  >({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [connectionTest, setConnectionTest] = useState<
    "idle" | "verified" | "failed"
  >("idle");
  const [feedback, setFeedback] = useState<ProviderFeedback>();
  const [rotateOpen, setRotateOpen] = useState(false);
  const preferredSelection = useRef({
    id: initialProviderId,
    applied: profiles.some((profile) => profile.id === initialProviderId),
  });
  const busy = isTesting || isDeleting || isSaving;
  const keyless = authMethod === "none";
  const preset = providerPresets.find(item => item.id === providerPresetId({ kind, endpoint }));

  useEffect(() => {
    if (preferredSelection.current.id !== initialProviderId) {
      preferredSelection.current = { id: initialProviderId, applied: false };
    }
    if (busy) return;
    const preferred = profiles.find((profile) => profile.id === initialProviderId);
    if (preferred && !preferredSelection.current.applied) {
      preferredSelection.current.applied = true;
      if (selectedProviderId !== preferred.id) selectProvider(preferred.id);
      return;
    }
    if (
      selectedProviderId === "__new__" ||
      (selectedProviderId && selectedProfile)
    ) {
      return;
    }
    if (profiles.length === 0) {
      return;
    }
    selectProvider(
      profiles.find((profile) => profile.id === initialProviderId)?.id ??
        profiles[0].id,
    );
  }, [busy, initialProviderId, profiles, selectedProfile, selectedProviderId]);

  const input = (): ProviderProfileInput => ({
    id: selectedProfile?.id,
    kind,
    name,
    endpoint,
    model_id: model,
    auth_method: authMethod,
    ...(secret ? { secret } : {}),
  });

  function selectProvider(id: string) {
    const profile = profiles.find((candidate) => candidate.id === id);
    setSelectedProviderId(id);
    setKind(profile?.kind ?? "openai_compatible");
    setPresetId(providerPresetId(profile));
    setName(profile?.name ?? "");
    setEndpoint(profile?.endpoint ?? "");
    setAuthMethod(profile?.auth_method ?? "bearer");
    setModel(profile?.model_id ?? "");
    setModels(profile?.model_id ? [profile.model_id] : []);
    setMetadata({});
    setSecret("");
    setConnectionTest("idle");
    setFeedback(undefined);
  }

  function startNewProvider() {
    setSelectedProviderId("__new__");
    setKind("openai_compatible");
    setPresetId("openai_compatible");
    setName("");
    setEndpoint("");
    setAuthMethod("bearer");
    setModel("");
    setModels([]);
    setMetadata({});
    setSecret("");
    setConnectionTest("idle");
    setFeedback(undefined);
  }

  function destinationNeedsKey() {
    const normalize = (value: string) => {
      try {
        return new URL(value).href.replace(/\/+$/, "");
      } catch {
        return value.trim();
      }
    };
    return Boolean(
      !keyless && selectedProfile?.configured &&
        !secret.trim() &&
        (normalize(endpoint) !== normalize(selectedProfile.endpoint) || authMethod !== selectedProfile.auth_method),
    );
  }

  function connectionFeedback(error: unknown) {
    const result = providerErrorFeedback(error, copy);
    if (keyless && result.text === copy.authenticationFailed) {
      return { ...result, text: "The local server requires authentication. Choose Bearer and enter its API token." };
    }
    return result;
  }

  async function testConnection() {
    if (destinationNeedsKey()) {
      setFeedback({ text: copy.providerDestinationKeyRequired, tone: "error" });
      return;
    }
    setIsTesting(true);
    setFeedback(undefined);
    try {
      const result = await onTest(input());
      const availableModels = Array.isArray(result) ? result : result.models;
      setMetadata(
        Object.fromEntries(
          (Array.isArray(result) ? [] : (result.model_metadata ?? [])).map(
            (item) => [item.id, item],
          ),
        ),
      );
      setModels(availableModels);
      const nextModel = defaultModelAfterTest(availableModels, model);
      if (nextModel !== model) {
        setModel(nextModel);
      }
      setConnectionTest("verified");
      setFeedback({ text: copy.providerTested, tone: "success" });
    } catch (error) {
      setConnectionTest(isLocalProviderSetupError(error) ? "idle" : "failed");
      setFeedback(connectionFeedback(error));
    } finally {
      setIsTesting(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (destinationNeedsKey()) {
      setFeedback({ text: copy.providerDestinationKeyRequired, tone: "error" });
      return;
    }
    if (!name.trim()) {
      setFeedback({ text: copy.providerNameRequired, tone: "error" });
      return;
    }
    if (!model.trim()) {
      setFeedback({ text: copy.modelRequired, tone: "error" });
      return;
    }
    setIsSaving(true);
    try {
      const saved = await onSave(input());
      setSelectedProviderId(saved.id);
      setKind(saved.kind==="local"?"openai_compatible":saved.kind);
      setName(saved.name);
      setEndpoint(saved.endpoint);
      setAuthMethod(saved.auth_method);
      setModel(saved.model_id);
      setModels(saved.model_id ? [saved.model_id] : models);
      setSecret("");
      if (secret || keyless) setConnectionTest("verified");
      setFeedback({ text: copy.providerSaved, tone: "success" });
    } catch (error) {
      setFeedback(connectionFeedback(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeKey() {
    if (!selectedProfile) {
      return;
    }
    setIsDeleting(true);
    setFeedback(undefined);
    try {
      await onDeleteKey(selectedProfile.id);
      setSecret("");
      setConnectionTest("idle");
      setFeedback({ text: copy.keyDeleted, tone: "success" });
    } catch (error) {
      setFeedback(providerErrorFeedback(error, copy, copy.keyDeleteFailed));
    } finally {
      setIsDeleting(false);
    }
  }

  async function removeProvider() {
    if (!selectedProfile) {
      return;
    }
    setIsDeleting(true);
    setFeedback(undefined);
    try {
      await onDelete(selectedProfile.id);
      startNewProvider();
      setFeedback({ text: copy.providerDeleted, tone: "success" });
    } catch (error) {
      setFeedback(
        providerErrorFeedback(error, copy, copy.providerDeleteFailed),
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section
      className="provider-settings"
      id={id}
      aria-label={copy.providerSettings}
    >
      <div className={settingsStyles.providerSettings_heading}>
        <div>
          <h2>{copy.providerSettings}</h2>
        </div>
        <Badge
          className={cn(
            settingsStyles.providerStatus,
            `provider-status provider-status--${providerConnectionStatus(connectionTest, selectedProfile?.configured)}`,
          )}
          data-connection-test={connectionTest}
        >
          {keyless && connectionTest === "idle" ? (selectedProfile?.configured ? "Local service configured" : "Not tested") : providerConnectionLabel(
            connectionTest,
            selectedProfile?.configured,
            copy,
          )}
        </Badge>
      </div>
      <p className={settingsStyles.settingsSection_lede}>
        {copy.settingsProviderLede}
      </p>
      {initialProviderId==="cove-local" && <div className="mb-4 grid gap-2 rounded-xl bg-muted p-3 text-sm"><p>Your current model runs on this Mac. Manage its download in Local models; it does not use a Provider Key.</p><Button variant="outline" onClick={onOpenLocalModels}>Open Local models</Button></div>}
      <form className="provider-settings__form" onSubmit={save}>
        <fieldset disabled={busy} className="min-w-0 border-0 p-0">
          <div
            className={cn(
              settingsStyles.prov,
              `prov${selectedProfile?.configured ? " prov--configured" : ""}`,
            )}
          >
            <div className={settingsStyles.prov_head}>
              <span
                className={cn(
                  settingsStyles.prov_sq,
                  `prov__sq${kind === "nearai" ? " prov__sq--sig" : ""}`,
                )}
              />
              <span className={settingsStyles.prov_name}>
                {name || copy.newProvider}
              </span>
              <span
                className={cn(
                  settingsStyles.prov_kind,
                  `prov__kind${kind === "nearai" ? " prov__kind--sig" : ""}`,
                )}
              >
                {kind === "nearai"
                  ? copy.presetConfidential
                  : preset ? `Preset · ${allowsNoAuthentication(endpoint) ? "Local service" : "Cloud"}` : copy.customEndpoint}
              </span>
              <span className={settingsStyles.prov_status}>
                <span
                  className={cn(
                    primitivesStyles.dot,
                    `dot${selectedProfile?.configured ? "" : " dot--grey"}`,
                  )}
                />
                {keyless ? "No API key required" : selectedProfile?.configured
                  ? copy.keyInKeychainConfigured
                  : copy.unconfigured}
              </span>
            </div>
            <div className={settingsStyles.prov_body}>
              {profiles.length > 0 ? (
                <FrontSelect
                  ariaLabel={copy.provider}
                  label={copy.provider}
                  options={[
                    ...profiles.map((profile) => ({
                      value: profile.id,
                      label: profile.name,
                    })),
                    { value: "__new__", label: copy.newProvider },
                  ]}
                  value={selectedProviderId}
                  onValueChange={(providerId) => {
                    preferredSelection.current.applied = true;
                    providerId === "__new__"
                      ? startNewProvider()
                      : selectProvider(providerId);
                  }}
                />
              ) : null}
              {selectedProfile ? (
                <dl className={settingsStyles.specLine}>
                  <dt>{copy.connectionType}</dt>
                  <dd>
                    {kind === "nearai" ? copy.nearai : providerPresets.find(preset => preset.id === providerPresetId(selectedProfile))?.name ?? copy.openaiCompatible}
                  </dd>
                </dl>
              ) : (
                <FrontSelect
                  ariaLabel={copy.connectionType}
                  label={copy.connectionType}
                  options={[
                    { value: "nearai", label: copy.nearai },
                    ...providerPresets.map(preset => ({ value: preset.id, label: preset.name })),
                    {
                      value: "openai_compatible",
                      label: copy.openaiCompatible,
                    },
                  ]}
                  value={presetId}
                  onValueChange={(value) => {
                    if (value === presetId) return;
                    const preset = providerPresets.find(item => item.id === value);
                    const nextKind = value === "nearai" ? "nearai" : "openai_compatible";
                    setPresetId(value);
                    setKind(nextKind);
                    setName(nextKind === "nearai" ? "NearAI" : preset?.name ?? "");
                    setEndpoint(nextKind === "nearai" ? "https://cloud-api.near.ai" : preset?.endpoint ?? "");
                    setAuthMethod(preset?.auth_method ?? "bearer");
                    setSecret("");
                    setModel("");
                    setModels([]);
                    setMetadata({});
                    setConnectionTest("idle");
                    setFeedback(undefined);
                  }}
                />
              )}
              <label>
                {copy.displayName}
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                {copy.endpoint}
                <Input
                  readOnly={kind === "nearai"}
                  value={endpoint}
                  onChange={(event) => {
                    const value = event.target.value;
                    setEndpoint(value);
                    setPresetId(providerPresetId({ kind, endpoint: value }));
                    setConnectionTest("idle");
                    setModels([]);
                    setMetadata({});
                    setModel("");
                  }}
                  onBlur={() => { if (authMethod === "none" && !allowsNoAuthentication(endpoint)) setAuthMethod("bearer"); }}
                />
              </label>
              <FrontSelect
                ariaLabel={copy.authentication}
                disabled={kind === "nearai"}
                label={copy.authentication}
                options={[
                  { value: "bearer", label: copy.bearer },
                  { value: "x_api_key", label: copy.apiKeyHeader },
                  { value: "none", label: "None (local service)", disabled: !allowsNoAuthentication(endpoint) || kind === "nearai" },
                ]}
                value={authMethod}
                onValueChange={(value) => {
                  setAuthMethod(value as ProviderAuthMethod);
                  if (value === "none") setSecret("");
                  setConnectionTest("idle");
                  setModels([]);
                  setMetadata({});
                  setModel("");
                }}
              />
              {keyless && <p className="text-sm text-muted-foreground">Start the local server and load a model, then test the connection. Choose Bearer if the server requires an API token.</p>}
              {presetId === "minimax" && <p className="text-sm text-muted-foreground">Models are listed from MiniMax documentation. Testing checks access with a short chat request. Use a platform API key for this endpoint.</p>}
              <ModelPicker
                ariaLabel={copy.model}
                label={copy.model}
                copy={copy}
                providerId={selectedProfile?.id ?? "setup"}
                models={models}
                metadata={metadata}
                showPrivacyMode={kind === "nearai"}
                value={model}
                onValueChange={setModel}
                placeholder={copy.selectModel}
              />
            </div>
            {!keyless && <div
              className={cn(
                settingsStyles.rotate,
                `rotate${rotateOpen || !selectedProfile?.configured ? " is-open" : ""}`,
              )}
            >
              <div className={settingsStyles.rotate_label}>
                {copy.keyRotation}
              </div>
              <label>
                {copy.secret}
                <Input
                  autoComplete="new-password"
                  type="password"
                  value={secret}
                  onChange={(event) => {
                    setSecret(event.target.value);
                    setConnectionTest("idle");
                  }}
                />
              </label>
              <p className={settingsStyles.rotate_hint}>
                {copy.keyRotationHint}
              </p>
            </div>}
            <div
              className={cn(
                settingsStyles.prov_foot,
                "provider-settings__actions",
              )}
            >
              <Button
                variant="outline"
                type="button"
                onClick={() => void testConnection()}
                disabled={busy}
              >
                {isTesting ? copy.testing : copy.testConnection}
              </Button>
              {!keyless && <Button
                variant="outline"
                type="button"
                onClick={() => setRotateOpen((open) => !open)}
                disabled={busy}
              >
                <KeyRound aria-hidden="true" size={13} strokeWidth={1.8} />
                {copy.rotateKey}
              </Button>}
              <Button variant="default" type="submit" disabled={busy}>
                {isSaving ? copy.saving : copy.saveProvider}
              </Button>
            </div>
            {selectedProfile && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2">
                {!keyless && <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="text-destructive"
                  onClick={() => void removeKey()}
                  disabled={busy || !selectedProfile.configured}
                >
                  {copy.removeKey}
                </Button>}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="text-destructive"
                  onClick={() => void removeProvider()}
                  disabled={busy}
                >
                  {copy.removeProvider}
                </Button>
              </div>
            )}
          </div>
        </fieldset>
      </form>
      {feedback ? (
        <p
          className={cn(
            settingsStyles.providerSettings_message,
            `provider-settings__message provider-settings__message--${feedback.tone}`,
          )}
          role="status"
        >
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
