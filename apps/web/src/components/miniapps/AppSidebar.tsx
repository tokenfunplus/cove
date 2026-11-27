import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  Code2,
  Grid2X2,
  MessageSquare,
  Settings2,
  Laptop,
  Library,
} from "lucide-react";
import { appKeys, miniApps } from "@/api/mini-apps";

export function AppSidebar({
  current,
  instance,
  navigate,
}: {
  current: string;
  instance?: string;
  navigate: (path: string) => void;
}) {
  const apps = useQuery({
    queryKey: appKeys.instances,
    queryFn: miniApps.instances,
    retry: false,
  });
  const link = (
    path: string,
    label: string,
    icon: React.ReactNode,
    active: boolean,
  ) => (
    <a
      key={path}
      href={path}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
          return;
        e.preventDefault();
        navigate(path);
      }}
    >
      {icon}
      <span>{label}</span>
    </a>
  );
  return (
    <aside className="mini-app-sidebar" aria-label="Mini Apps navigation">
      <a
        className="mini-app-brand"
        href="/apps"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          navigate("/apps");
        }}
      >
        <span>C</span> Cove
      </a>
      <p>Workspace</p>
      {link("/", "Cove Chat", <MessageSquare />, false)}
      {link(
        "/apps?section=catalog",
        "App catalog",
        <Grid2X2 />,
        !instance && current === "catalog",
      )}
      {link("/apps", "My apps", <Library />, !instance && current === "mine")}
      <p>Installed apps</p>
      {apps.data?.instances.map((app) =>
        link(
          "/apps/" + encodeURIComponent(app.id),
          app.name,
          <BookOpen />,
          instance === app.id,
        ),
      )}
      {apps.isSuccess && !apps.data.instances.length && (
        <small>Your apps will appear here.</small>
      )}
      {apps.isError && (
        <small>Could not load apps. Open My apps to retry.</small>
      )}
      <p>Developer tools</p>
      {link(
        "/apps?section=agent",
        "Agent packages",
        <Code2 />,
        current === "agent" && !instance,
      )}
      {link(
        "/apps?section=settings",
        "Catalog settings",
        <Settings2 />,
        current === "settings" && !instance,
      )}
      {link(
        "/apps?section=activity",
        "Host activity",
        <Activity />,
        current === "activity" && !instance,
      )}
      <footer>
        <Laptop />
        <div>
          <strong>Personal workspace</strong>
          <small>Stored on this Mac</small>
        </div>
      </footer>
    </aside>
  );
}
