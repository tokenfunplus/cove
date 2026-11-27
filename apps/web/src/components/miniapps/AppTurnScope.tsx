import { useState } from "react";
import type {
  MiniAppInstance,
  MiniAppPackage,
  MiniAppTurnScope,
} from "@cove/api-contract";
import { Button } from "@/components/ui/button";

interface Props {
  instance: MiniAppInstance;
  pkg: MiniAppPackage;
  actions: string[];
  choose: (scope: MiniAppTurnScope, name: string) => void;
}

export function AppTurnScope({ instance, pkg, actions, choose }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const allowed = selected.filter((id) => actions.includes(id));
  return (
    <details className="rounded-xl border p-3 text-sm">
      <summary>Use app actions in my next message</summary>
      <fieldset className="my-2 grid gap-1">
        <legend>Select the actions to share with your chat model</legend>
        {actions.map((id) => (
          <label key={id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowed.includes(id)}
              disabled={!allowed.includes(id) && allowed.length >= 16}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...allowed, id]
                    : allowed.filter((other) => other !== id),
                )
              }
            />
            {pkg.actions[id].title}
          </label>
        ))}
      </fieldset>
      <Button
        size="sm"
        type="button"
        disabled={!allowed.length}
        onClick={() =>
          choose(
            {
              instance: instance.id,
              release: instance.release_id,
              revision: instance.revision,
              actions: allowed,
            },
            instance.name,
          )
        }
      >
        Use in next message
      </Button>
    </details>
  );
}
