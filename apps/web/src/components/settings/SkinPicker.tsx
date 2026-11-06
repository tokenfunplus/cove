import { Check } from "lucide-react";
import { selectSkin, skins, useSkin } from "@/theme/skin";

export function SkinPicker() {
  const current = useSkin();
  return (
    <fieldset className="border-b border-border pb-5">
      <legend className="mb-3 text-xs font-semibold">Workspace skin</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {skins.map((skin) => (
          <label key={skin.id} className="relative cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name="workspace-skin"
              value={skin.id}
              checked={skin.id === current}
              onChange={() => selectSkin(skin.id)}
            />
            <span className="block h-full rounded-lg border border-border p-2 peer-checked:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
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
              <span className="block pt-1 text-[10px] leading-snug text-muted-foreground">
                {skin.detail}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
