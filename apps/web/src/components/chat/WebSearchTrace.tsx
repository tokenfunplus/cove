import type { WebSearchInfo } from "@cove/api-contract";

export function WebSearchTrace({ info }: { info?: WebSearchInfo }) {
  if (!info?.steps?.length) return <p className="my-2 text-xs text-muted-foreground">Web search was available and was not used.</p>;
  return <details className="my-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Web research · {info.provider} · {info.searches} searches · {info.pages} page reads</summary><ol className="mt-2 space-y-2">{info.steps.map(step => <li key={step.id} className="break-words"><span>{step.name === "web_search" ? "Search" : "Read"}: {step.query ?? step.url} · {step.cached ? "cached" : step.status}</span>{step.error && <p className="text-destructive">{step.error}</p>}{step.usage != null && <p>Provider-reported usage: {JSON.stringify(step.usage)}</p>}</li>)}</ol></details>;
}
