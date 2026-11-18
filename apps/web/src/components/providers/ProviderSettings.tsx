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
import { useEffect, useState } from "react";

export function ProviderSettings({
  id,
  profiles,
  onSave,
  onTest,
  onDelete,
  onDeleteKey,
  copy = englishConversationCopy,
}: {
  id?: string;
  profiles: ProviderProfile[];
  onSave: (input: ProviderProfileInput) => Promise<ProviderProfile>;
  onTest: (
    input: ProviderProfileInput,
  ) => Promise<string[] | ProviderValidationResponse>;
  onDelete: (id: string) => Promise<void>;
  onDeleteKey: (id: string) => Promise<void>;
  copy?: ApplicationCopy;
}) {
  const existing = profiles[0];
  const [selectedProviderId, setSelectedProviderId] = useState(
    existing?.id ?? "",
  );
  const selectedProfile = profiles.find(
    (profile) => profile.id === selectedProviderId,
  );
  const [kind, setKind] = useState<"nearai" | "openai_compatible">(
    selectedProfile?.kind ?? "nearai",
  );
  const [name, setName] = useState(selectedProfile?.name ?? "NearAI");
  const [endpoint, setEndpoint] = useState(
    selectedProfile?.endpoint ?? "https://cloud-stg-api.near.ai",
  );
  const [authMethod, setAuthMethod] = useState<"bearer" | "x_api_key">(
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

  useEffect(() => {
    if (
      selectedProviderId === "__new__" ||
      (selectedProviderId && selectedProfile)
    ) {
      return;
    }
    if (profiles.length === 0) {
      return;
    }
    selectProvider(profiles[0].id);
  }, [profiles, selectedProfile, selectedProviderId]);

  const busy = isTesting || isDeleting || isSaving;

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
    setKind(profile?.kind ?? "nearai");
    setName(profile?.name ?? "NearAI");
    setEndpoint(profile?.endpoint ?? "https://cloud-stg-api.near.ai");
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
      selectedProfile?.configured &&
        !secret.trim() &&
        normalize(endpoint) !== normalize(selectedProfile.endpoint),
    );
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
      setConnectionTest("failed");
      setFeedback(providerErrorFeedback(error, copy));
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
      setKind(saved.kind);
      setName(saved.name);
      setEndpoint(saved.endpoint);
      setAuthMethod(saved.auth_method);
      setModel(saved.model_id);
      setModels(saved.model_id ? [saved.model_id] : models);
      setSecret("");
      setConnectionTest("verified");
      setFeedback({ text: copy.providerSaved, tone: "success" });
    } catch (error) {
      setFeedback(providerErrorFeedback(error, copy));
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
          {providerConnectionLabel(
            connectionTest,
            selectedProfile?.configured,
            copy,
          )}
        </Badge>
      </div>
      <p className={settingsStyles.settingsSection_lede}>
        {copy.settingsProviderLede}
      </p>
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
                  : copy.customEndpoint}
              </span>
              <span className={settingsStyles.prov_status}>
                <span
                  className={cn(
                    primitivesStyles.dot,
                    `dot${selectedProfile?.configured ? "" : " dot--grey"}`,
                  )}
                />
                {selectedProfile?.configured
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
                  onValueChange={(providerId) =>
                    providerId === "__new__"
                      ? startNewProvider()
                      : selectProvider(providerId)
                  }
                />
              ) : null}
              {selectedProfile ? (
                <dl className={settingsStyles.specLine}>
                  <dt>{copy.connectionType}</dt>
                  <dd>
                    {kind === "nearai" ? copy.nearai : copy.openaiCompatible}
                  </dd>
                </dl>
              ) : (
                <FrontSelect
                  ariaLabel={copy.connectionType}
                  label={copy.connectionType}
                  options={[
                    { value: "nearai", label: copy.nearai },
                    {
                      value: "openai_compatible",
                      label: copy.openaiCompatible,
                    },
                  ]}
                  value={kind}
                  onValueChange={(value) => {
                    const nextKind = value as "nearai" | "openai_compatible";
                    setKind(nextKind);
                    if (nextKind === "nearai") {
                      setName("NearAI");
                      setEndpoint("https://cloud-stg-api.near.ai");
                      setAuthMethod("bearer");
                    }
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
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              </label>
              <FrontSelect
                ariaLabel={copy.authentication}
                disabled={kind === "nearai"}
                label={copy.authentication}
                options={[
                  { value: "bearer", label: copy.bearer },
                  { value: "x_api_key", label: copy.apiKeyHeader },
                ]}
                value={authMethod}
                onValueChange={(value) =>
                  setAuthMethod(value as "bearer" | "x_api_key")
                }
              />
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
            <div
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
            </div>
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
              <Button
                variant="outline"
                type="button"
                onClick={() => setRotateOpen((open) => !open)}
                disabled={busy}
              >
                <KeyRound aria-hidden="true" size={13} strokeWidth={1.8} />
                {copy.rotateKey}
              </Button>
              <Button variant="default" type="submit" disabled={busy}>
                {isSaving ? copy.saving : copy.saveProvider}
              </Button>
            </div>
            {selectedProfile && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="text-destructive"
                  onClick={() => void removeKey()}
                  disabled={busy || !selectedProfile.configured}
                >
                  {copy.removeKey}
                </Button>
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
