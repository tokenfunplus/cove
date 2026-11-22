import { RadioGroup, RadioCard } from "@/components/ui/radio-group";
import { Check } from "lucide-react";
import { selectSkin, skins, useSkin } from "@/theme/skin";

export function SkinPicker() {
  const current = useSkin();
  return (
    <fieldset className="border-b border-border pb-5">
      <legend className="mb-3 text-xs font-semibold">Workspace skin</legend>
      <RadioGroup aria-label="Workspace skin" name="workspace-skin" value={current} onValueChange={value=>selectSkin(value as typeof current)} className="grid-cols-2 sm:grid-cols-4">
        {skins.map((skin) => (
          <RadioCard key={skin.id} value={skin.id} aria-label={skin.name} aria-describedby={`skin-${skin.id}-detail`}>
              <span
                data-skin={skin.id}
                aria-hidden="true"
                className="mb-2 flex h-12 overflow-hidden rounded-md border border-border bg-card"
              >
                <span className="w-1/4 border-r border-border bg-sidebar p-1.5">
                  <span className="block h-1 w-full rounded-full bg-primary" />
                </span>
                <span className="grid flex-1 content-center gap-1.5 px-2">
                  <span className="h-1.5 w-1/2 rounded-full bg-foreground" />
                  <span className="h-3 w-full rounded-sm border border-border bg-accent" />
                </span>
              </span>
              <span className="flex items-center justify-between gap-1 text-xs font-semibold">
                {skin.name}
                {skin.id === current && <Check aria-hidden="true" size={13} />}
              </span>
              <span id={`skin-${skin.id}-detail`} className="block pt-1 text-[10px] leading-snug text-muted-foreground">
                {skin.detail}
              </span>
          </RadioCard>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
