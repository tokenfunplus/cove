import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorMessage } from "./presentation";

export function WorkspaceSearch({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [term, setTerm] = useState("");
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const otherDialog = Array.from(
          document.querySelectorAll('[role="dialog"]:not([data-workspace-search])'),
        ).some((dialog) => !dialog.closest("[inert]"));
        if (event.defaultPrevented || otherDialog) return;
        event.preventDefault();
        setTerm("");
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const instances = useQuery({
    queryKey: appKeys.instances,
    queryFn: miniApps.instances,
    enabled: open,
    retry: false,
  });
  const releases = useQuery({
    queryKey: appKeys.releases,
    queryFn: miniApps.releases,
    enabled: open,
    retry: false,
  });
  const results = [
    { name: "My apps", path: "/apps", kind: "Workspace" },
    { name: "Agent packages", path: "/apps?section=agent", kind: "Workspace" },
    {
      name: "Host activity",
      path: "/apps?section=activity",
      kind: "Workspace",
    },
    ...(instances.data?.instances ?? []).flatMap((instance) => {
      const release = releases.data?.packages.find(
        (item) => item.id === instance.release_id,
      );
      return [
        {
          name: instance.name,
          path: "/apps/" + encodeURIComponent(instance.id),
          kind: release?.package.name ?? "App",
        },
        ...(release?.package.pages ?? []).map((page) => ({
          name: instance.name + " · " + page.title,
          path:
            "/apps/" +
            encodeURIComponent(instance.id) +
            "/" +
            encodeURIComponent(page.id),
          kind: "View",
        })),
      ];
    }),
  ].filter(
    (item) =>
      !term.trim() ||
      (item.name + " " + item.kind)
        .toLocaleLowerCase()
        .includes(term.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Search workspace"
        className="!text-xs"
        onClick={() => {
          setTerm("");
          setOpen(true);
        }}
      >
        <Search />
        <span className="hidden sm:inline">Search</span>
        <kbd className="ml-2 hidden text-[10px] opacity-50 sm:inline">⌘K</kbd>
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          className="fixed inset-0 z-[100] grid place-items-center p-3"
        >
          <DialogOverlay />
          <DialogContent data-workspace-search className="max-h-[80dvh] w-full max-w-xl space-y-3 overflow-auto rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <DialogTitle>Search workspace</DialogTitle>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Close search
              </Button>
            </div>
            <Input
              autoFocus
              aria-label="App or page"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search apps, views and tools"
            />
            <ErrorMessage error={instances.error ?? releases.error} />
            <div className="grid gap-1">
              {results.map((item) => (
                <Button
                  key={item.path}
                  variant="ghost"
                  className="justify-start"
                  onClick={() => {
                    setOpen(false);
                    navigate(item.path);
                  }}
                >
                  {item.name}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.kind}
                  </span>
                </Button>
              ))}
            </div>
            {!results.length && <p>No matching app or page.</p>}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
