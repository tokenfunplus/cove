import { lazy, Suspense, useContext, useEffect, useState } from "react";
import { QueryClientContext, useQuery } from "@tanstack/react-query";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
const Picker = lazy(() => import("./ComposerAppPicker"));

interface Props {
  conversation: string;
  draft: string;
  change: (text: string) => void;
  localRequired: boolean;
  surface: "chat" | "panel";
}

export function SelectedTextToApp(props: Props) {
  const cache = useContext(QueryClientContext);
  return cache ? <SelectionControls {...props} /> : null;
}

function SelectionControls({
  conversation,
  draft,
  change,
  localRequired,
  surface,
}: Props) {
  const [selected, setSelected] = useState("");
  const [frozen, setFrozen] = useState("");
  const installed = useQuery({
    queryKey: appKeys.instances,
    queryFn: miniApps.instances,
    enabled: !!selected || !!frozen,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const canReceive = installed.data?.instances.some(
    (instance) =>
      instance.enabled && instance.grants.includes("mac.selection.receive"),
  );
  useEffect(() => {
    function source(node: Node | null) {
      const element = node instanceof Element ? node : node?.parentElement;
      return element?.closest<HTMLElement>("[data-app-selection-source]");
    }
    function changed() {
      const selection = window.getSelection();
      const from = source(selection?.anchorNode ?? null);
      const to = source(selection?.focusNode ?? null);
      const value =
        from && from === to && from.dataset.appSelectionSource === conversation
          ? (selection?.toString().trim() ?? "")
          : "";
      setSelected(value.length <= 60000 ? value : "");
    }
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [conversation]);
  if (frozen)
    return (
      <Suspense fallback={null}>
        <Picker
          surface={surface}
          draft={draft}
          selectedText={frozen}
          change={change}
          localRequired={localRequired}
          busy={false}
          close={() => setFrozen("")}
        />
      </Suspense>
    );
  if (!canReceive) return null;
  if (!selected) return null;
  return (
    <div className="flex justify-end px-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setFrozen(selected)}
      >
        Use selected text in an app
      </Button>
    </div>
  );
}
