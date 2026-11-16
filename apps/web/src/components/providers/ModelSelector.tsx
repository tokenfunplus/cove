import { modelsStyles } from "@/styles/models";
import { primitivesStyles } from "@/styles/primitives";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  type ActiveModelSet,
  type ActiveSelection,
  availableModelsForAddedTarget,
  isDuplicateModelTarget,
  type ModelCatalogs,
  type ModelCatalogState,
  privacyModeLabel,
} from "@/components/providers/model-selection";
import { FrontSelect } from "@/components/ui/front-select";
import { type ApplicationCopy, englishConversationCopy } from "@/messages";
import {
  type ProviderModelMetadata,
  type ProviderProfile,
} from "@cove/api-contract";
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Popover,
  PopoverButton,
  PopoverPanel,
} from "@headlessui/react";
import {
  ChevronDown,
  GitCompareArrows,
  LoaderCircle,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

function ModelOptionLabel({
  modelId,
  metadata,
  copy,
  showPrivacyMode = false,
}: {
  modelId: string;
  metadata?: ProviderModelMetadata;
  copy: ApplicationCopy;
  showPrivacyMode?: boolean;
}) {
  const mode = showPrivacyMode ? metadata?.privacy_mode : undefined;
  return (
    <span className={modelsStyles.modelOption}>
      <span className={modelsStyles.modelOption_id}>{modelId}</span>
      {mode ? (
        <Badge
          className={cn(
            modelsStyles.modelOption_badge,
            `model-option__badge model-option__badge--${mode}`,
          )}
          data-privacy-mode={mode}
        >
          {privacyModeLabel(mode, copy)}
        </Badge>
      ) : null}
    </span>
  );
}

export function ModelSelector({
  profiles,
  activeProviderId,
  activeModelId,
  activeModelSet = [],
  catalog,
  catalogs,
  onProviderChange,
  onModelChange,
  onTargetModelChange,
  onAddModel,
  onRemoveModel,
  trailingAction,
  disabled = false,
  copy = englishConversationCopy,
}: {
  profiles: ProviderProfile[];
  activeProviderId: string;
  activeModelId: string;
  activeModelSet?: ActiveModelSet;
  catalog: ModelCatalogState;
  catalogs?: ModelCatalogs;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onTargetModelChange?: (targetIndex: number, modelId: string) => void;
  onAddModel?: (profile: ProviderProfile, modelId: string) => void;
  onRemoveModel?: (target: ActiveSelection) => void;
  trailingAction?: ReactNode;
  disabled?: boolean;
  copy?: ApplicationCopy;
}) {
  const [editingTargetIndex, setEditingTargetIndex] = useState(0);
  const [addModelQuery, setAddModelQuery] = useState("");
  const configuredProfiles = profiles.filter((profile) => profile.configured);
  const targets =
    activeModelSet.length > 0
      ? activeModelSet
      : activeProviderId && activeModelId
        ? [{ providerId: activeProviderId, modelId: activeModelId }]
        : [];
  const targetCatalogs: ModelCatalogs =
    catalogs ?? (activeProviderId ? { [activeProviderId]: catalog } : {});
  const selectedTargetIndex = Math.min(
    editingTargetIndex,
    Math.max(targets.length - 1, 0),
  );
  const selectedTarget = targets[selectedTargetIndex];
  const selectedProfile = configuredProfiles.find(
    (profile) => profile.id === selectedTarget?.providerId,
  );
  const selectedCatalog: ModelCatalogState = selectedTarget
    ? (targetCatalogs[selectedTarget.providerId] ?? {
        status: "idle",
        models: [],
        metadata: {},
      })
    : { status: "idle", models: [], metadata: {} };
  const selectedModelUnavailable =
    selectedCatalog.status === "ready" &&
    selectedTarget?.modelId !== "" &&
    !selectedCatalog.models.includes(selectedTarget?.modelId ?? "");
  const activeModelInvalid =
    Boolean(selectedProfile) &&
    (!selectedTarget?.modelId || selectedModelUnavailable);
  const catalogsLoading = targets.some(
    (target) => targetCatalogs[target.providerId]?.status === "loading",
  );
  const modelPlaceholder =
    selectedCatalog.status === "loading"
      ? selectedTarget?.modelId || copy.loadingModels
      : selectedCatalog.status === "error"
        ? copy.modelsUnavailable
        : copy.selectModel;
  const addableProfiles = configuredProfiles
    .map((profile) => ({
      profile,
      models: availableModelsForAddedTarget(
        profile,
        targets,
        targetCatalogs[profile.id],
      ),
    }))
    .filter((entry) => entry.models.length > 0);
  const normalizedAddModelQuery = addModelQuery.trim().toLocaleLowerCase();
  const filteredAddableProfiles = addableProfiles
    .map(({ profile, models }) => ({
      profile,
      models: normalizedAddModelQuery
        ? models.filter((modelId) =>
            modelId.toLocaleLowerCase().includes(normalizedAddModelQuery),
          )
        : models,
    }))
    .filter((entry) => entry.models.length > 0);
  const handleTargetChange =
    onTargetModelChange ??
    ((targetIndex: number, modelId: string) => {
      if (targetIndex === 0) onModelChange(modelId);
    });

  return (
    <div
      className={cn(modelsStyles.modelSelector, "model-selector--nearai")}
      data-catalog-status={selectedCatalog.status}
      data-selection-valid={activeModelInvalid ? "false" : "true"}
    >
      <div className={modelsStyles.modelSelector_topline}>
        <div className={modelsStyles.modelSelector_fields}>
          <FrontSelect
            ariaLabel={copy.provider}
            className={modelsStyles.modelSelector_providerSelect}
            label={copy.provider}
            options={configuredProfiles.map((profile) => ({
              value: profile.id,
              label: profile.name,
            }))}
            placeholder={copy.selectProvider}
            value={selectedTarget?.providerId ?? ""}
            onValueChange={onProviderChange}
            disabled={
              disabled || targets.length > 1 || configuredProfiles.length === 0
            }
          />
          <FrontSelect
            ariaLabel={copy.model}
            searchable
            searchPlaceholder={copy.searchModels}
            emptyText={copy.noMatchingModels}
            label={
              <span className={modelsStyles.modelSelector_fieldLabel}>
                <span>{copy.model}</span>
                {catalogsLoading ? (
                  <span
                    role="status"
                    title={copy.loadingModels}
                    className={modelsStyles.modelSelector_fieldState}
                  >
                    <LoaderCircle
                      aria-hidden="true"
                      size={11}
                      strokeWidth={2}
                    />
                    <span className="sr-only">{copy.loadingModels}</span>
                  </span>
                ) : null}
              </span>
            }
            placeholder={modelPlaceholder}
            options={selectedCatalog.models.map((model) => ({
              value: model,
              keywords: model,
              label: (
                <ModelOptionLabel
                  copy={copy}
                  modelId={model}
                  metadata={selectedCatalog.metadata?.[model]}
                  showPrivacyMode={
                    configuredProfiles.find(
                      (profile) => profile.id === selectedTarget?.providerId,
                    )?.kind === "nearai"
                  }
                />
              ),
              disabled: selectedTarget
                ? isDuplicateModelTarget(
                    targets,
                    { providerId: selectedTarget.providerId, modelId: model },
                    selectedTargetIndex,
                  )
                : false,
            }))}
            value={selectedTarget?.modelId ?? ""}
            onValueChange={(modelId) =>
              handleTargetChange(selectedTargetIndex, modelId)
            }
            disabled={
              disabled ||
              !selectedTarget ||
              selectedCatalog.status !== "ready" ||
              selectedCatalog.models.length === 0
            }
          />
        </div>
        <Popover className="static shrink-0">
          <PopoverButton
            as={Button}
            variant="outline"
            aria-label={`${copy.modelComparison}, ${targets.length} / 4`}
            className={modelsStyles.modelSelector_comparisonToggle}
            disabled={disabled}
            type="button"
          >
            <GitCompareArrows aria-hidden="true" size={17} strokeWidth={1.8} />
            <span>{copy.modelComparison}</span>
            <strong aria-label={`${targets.length} / 4`}>
              {targets.length}/4
            </strong>
            <ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
          </PopoverButton>
          <PopoverPanel
            as="section"
            aria-label={copy.activeModelSet}
            className={modelsStyles.modelSelector_comparison}
            unmount={false}
          >
            <div className={modelsStyles.modelSelector_comparisonHeading}>
              <span>{copy.activeModelSet}</span>
              <span
                aria-label={`${targets.length} / 4`}
                className="model-selector__count"
              >
                {targets.length}/4
              </span>
            </div>
            <div className={modelsStyles.modelSelector_chips} role="list">
              {targets.map((target, targetIndex) => {
                const profileName =
                  configuredProfiles.find(
                    (profile) => profile.id === target.providerId,
                  )?.name ?? target.providerId;
                const chipCatalog = targetCatalogs[target.providerId] ?? {
                  status: "idle" as const,
                  models: [],
                  metadata: {},
                };
                return (
                  <span
                    className={cn(
                      modelsStyles.modelSelector_chip,
                      `model-selector__chip${targetIndex === selectedTargetIndex ? " model-selector__chip--editing" : ""}`,
                    )}
                    key={`${target.providerId}:${target.modelId}:${targetIndex}`}
                    role="listitem"
                  >
                    <span className={modelsStyles.modelSelector_chipProvider}>
                      {profileName}
                    </span>
                    <FrontSelect
                      ariaLabel={`${copy.model}: ${profileName} ${target.modelId}`}
                      searchable
                      searchPlaceholder={copy.searchModels}
                      emptyText={copy.noMatchingModels}
                      className={modelsStyles.modelSelector_chipModelSelect}
                      options={chipCatalog.models.map((model) => ({
                        value: model,
                        keywords: model,
                        label: (
                          <ModelOptionLabel
                            copy={copy}
                            modelId={model}
                            metadata={chipCatalog.metadata?.[model]}
                            showPrivacyMode={
                              configuredProfiles.find(
                                (profile) => profile.id === target.providerId,
                              )?.kind === "nearai"
                            }
                          />
                        ),
                        disabled: isDuplicateModelTarget(
                          targets,
                          { providerId: target.providerId, modelId: model },
                          targetIndex,
                        ),
                      }))}
                      placeholder={copy.selectModel}
                      value={target.modelId}
                      onValueChange={(modelId) => {
                        setEditingTargetIndex(targetIndex);
                        handleTargetChange(targetIndex, modelId);
                      }}
                      disabled={
                        disabled ||
                        chipCatalog.status !== "ready" ||
                        chipCatalog.models.length === 0
                      }
                    />
                    {onRemoveModel && targets.length > 1 ? (
                      <Button
                        variant="outline"
                        aria-label={`${copy.removeModel}: ${profileName} ${target.modelId}`}
                        className={modelsStyles.modelSelector_chipRemove}
                        disabled={disabled}
                        onClick={() => onRemoveModel(target)}
                        title={copy.removeModel}
                        type="button"
                      >
                        <X aria-hidden="true" size={15} strokeWidth={2} />
                      </Button>
                    ) : null}
                  </span>
                );
              })}
              {targets.length === 0 ? (
                <p className={modelsStyles.modelSelector_empty}>
                  {copy.selectProvider}
                </p>
              ) : null}
            </div>
            {onAddModel && targets.length < 4 && addableProfiles.length > 0 ? (
              <Popover className="model-selector__add-menu">
                <PopoverButton
                  onClick={() => setAddModelQuery("")}
                  as={Button}
                  variant="outline"
                  className={modelsStyles.modelSelector_addButton}
                  disabled={disabled}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} strokeWidth={2} />
                  {copy.addModel}
                </PopoverButton>
                <PopoverPanel
                  className={primitivesStyles.modelSelector_addMenuItems}
                >
                  {({ close }) => (
                    <div
                      onKeyDownCapture={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          close();
                        }
                      }}
                    >
                      <Combobox
                        value={null}
                        onChange={(
                          selection: {
                            profile: ProviderProfile;
                            modelId: string;
                          } | null,
                        ) => {
                          if (!selection) return;
                          onAddModel(selection.profile, selection.modelId);
                          setEditingTargetIndex(targets.length);
                          setAddModelQuery("");
                          close();
                        }}
                        immediate
                        nullable
                      >
                        <div className={modelsStyles.modelSelector_addSearch}>
                          <Search
                            aria-hidden="true"
                            size={13}
                            strokeWidth={1.8}
                          />
                          <ComboboxInput
                            as={Input}
                            autoFocus
                            aria-label={copy.searchModels}
                            onChange={(event) =>
                              setAddModelQuery(event.target.value)
                            }
                            placeholder={copy.searchModels}
                          />
                        </div>
                        <ComboboxOptions
                          static
                          className={modelsStyles.modelSelector_addOptions}
                        >
                          {filteredAddableProfiles.length > 0 ? (
                            filteredAddableProfiles.map(
                              ({ profile, models }) => (
                                <div
                                  aria-label={profile.name}
                                  className="model-selector__add-provider"
                                  key={profile.id}
                                  role="group"
                                >
                                  <span
                                    className={
                                      primitivesStyles.modelSelector_addProviderName
                                    }
                                  >
                                    {profile.name}
                                  </span>
                                  {models.map((modelId) => (
                                    <ComboboxOption
                                      key={modelId}
                                      value={{ profile, modelId }}
                                      className={
                                        primitivesStyles.modelSelector_addOption
                                      }
                                    >
                                      <ModelOptionLabel
                                        copy={copy}
                                        modelId={modelId}
                                        metadata={
                                          targetCatalogs[profile.id]
                                            ?.metadata?.[modelId]
                                        }
                                        showPrivacyMode={
                                          profile.kind === "nearai"
                                        }
                                      />
                                      <Plus
                                        aria-hidden="true"
                                        size={14}
                                        strokeWidth={2}
                                      />
                                    </ComboboxOption>
                                  ))}
                                </div>
                              ),
                            )
                          ) : (
                            <p className={modelsStyles.modelSelector_empty}>
                              {copy.noMatchingModels}
                            </p>
                          )}
                        </ComboboxOptions>
                      </Combobox>
                    </div>
                  )}
                </PopoverPanel>
              </Popover>
            ) : null}
          </PopoverPanel>
        </Popover>
        {trailingAction}
      </div>
      <div className={modelsStyles.modelSelector_status} aria-live="polite">
        {selectedCatalog.status === "error" ? copy.modelsUnavailable : null}
        {selectedCatalog.status === "ready" &&
        selectedCatalog.models.length === 0
          ? copy.noModels
          : null}
        {selectedModelUnavailable ? copy.modelUnavailable : null}
      </div>
    </div>
  );
}
