import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModelPreferences } from "@/hooks/providers/use-model-preferences";
import type { ActiveModelSet, ModelCatalogs } from "./model-selection";
import type { ProviderProfile } from "@cove/api-contract";

export function ModelPresets({
  targets,
  catalogs,
  profiles,
  disabled,
  onApply,
}: {
  targets: ActiveModelSet;
  catalogs: ModelCatalogs;
  profiles: ProviderProfile[];
  disabled: boolean;
  onApply: (targets: ActiveModelSet) => void;
}) {
  const { preferences, savePreset, removePreset } = useModelPreferences();
  const [name, setName] = useState("");
  return (
    <section
      className="mt-3 grid gap-2 border-t border-border pt-3"
      aria-label="Saved model combinations"
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label="Combination name"
          placeholder="Name this model combination"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-8 min-w-0 text-xs"
        />
        <Button
          size="xs"
          variant="outline"
          disabled={
            disabled ||
            !name.trim() ||
            !targets.length ||
            targets.some((target) => !target.modelId)
          }
          onClick={() => {
            savePreset(name, targets);
            setName("");
          }}
        >
          Save combination
        </Button>
      </div>
      {preferences.presets.map((preset) => {
        const available = preset.targets.every(
          (target) =>
            profiles.some(
              (profile) =>
                profile.id === target.providerId && profile.configured,
            ) &&
            catalogs[target.providerId]?.status === "ready" &&
            catalogs[target.providerId]?.models.includes(target.modelId),
        );
        return (
          <div key={preset.id} className="flex items-center gap-2">
            <Button
              className="min-w-0 flex-1 justify-start truncate"
              variant="ghost"
              size="xs"
              disabled={disabled || !available}
              title={preset.targets.map((target) => target.modelId).join(", ")}
              onClick={() => onApply(preset.targets)}
            >
              {preset.name} · {preset.targets.length}
              {!available ? " · Unavailable" : ""}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled}
              aria-label={`Delete combination: ${preset.name}`}
              onClick={() => removePreset(preset.id)}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </section>
  );
}
