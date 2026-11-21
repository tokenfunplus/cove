import { useSourceNavigation } from "./SourceDocuments";
import { citedSources } from "@/lib/chat/source-references";

export function SourceReferences({ content }: { content: string }) {
  const navigation = useSourceNavigation();
  const references = citedSources(content, (navigation.sources ?? []).map(item => item.document));
  if (!references.length) return null;
  return <section aria-label="References" className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
    <p className="mb-2 font-medium">References</p>
    <ol className="space-y-2">{references.map(({ source, section }, index) => <li key={source.id}>
      <button type="button" className="cursor-pointer text-left text-primary underline underline-offset-2" onClick={navigation.resolve(`cove:${source.id}:${section}`)}>{index + 1}. {source.name}</button>
      {source.web && <><span className="ml-2">{sourceDomain(source.web.final_url)} · {source.web.kind === "search_result" ? "Search excerpt" : "Retrieved page"} · {new Date(source.web.fetched_at).toLocaleString()}</span><a href={source.web.final_url} target="_blank" rel="noopener noreferrer" className="ml-2 underline">Original</a>{source.web.published_at && <span className="ml-2">Published {source.web.published_at}</span>}</>}
    </li>)}</ol>
  </section>;
}

function sourceDomain(url: string) { try { return new URL(url).hostname; } catch { return "Source"; } }
