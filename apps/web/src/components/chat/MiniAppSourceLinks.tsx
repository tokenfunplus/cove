import { memo } from "react";
import { miniAppSources } from "@/lib/mini-app-snapshot";

export const MiniAppSourceLinks = memo(function MiniAppSourceLinks({ userBody }: { userBody?: string }) {
  if (!userBody?.includes("cove://open/")) return null;
  const sources = miniAppSources(userBody);
  if (!sources.size) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2 text-xs">
      {Array.from(sources, ([href, name]) => (
        <a key={href} href={href} className="text-primary underline underline-offset-2">
          Open {name}
        </a>
      ))}
    </div>
  );
});
