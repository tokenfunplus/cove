import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { FileInput } from "@/components/ui/file-input";
import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AttachmentSnapshot, LocalSearchResults, PreparedWebSource } from "@cove/api-contract";
import { LocalModelControl } from "./LocalModelControl";
import { searchProjectDocuments,prepareProjectSources,reindexProjectDocument,importLocalDocument, prepareLocalSources, reindexLocalDocument, removeLocalDocument, searchLocalDocuments } from "@/api/local-models";
import { localDocumentsKey, useLocalDocuments, useLocalModels } from "@/api/hooks/useLocalModels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";
import { DocumentPreview } from "@/components/chat/SourceDocuments";
import { releaseWebSource } from "@/api";

function readFile(file: File, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const stopped = () => { reader.abort(); reject(new DOMException("File reading stopped.", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", stopped);
    if (signal.aborted) { stopped(); return; }
    signal.addEventListener("abort", stopped, {once:true});
    reader.onload = () => { cleanup(); resolve(String(reader.result).split(",", 2)[1] ?? ""); };
    reader.onerror = () => { cleanup(); reject(new Error("The file could not be read.")); };
    reader.onabort = cleanup;
    reader.readAsDataURL(file);
  });
}

type Operation = { signal: AbortSignal; isCurrent: () => boolean };
type SearchOptions = "documents" | "filters";

const searchingLabel = "Searching selected documents locally…";
const indexingLabel = "Indexing documents locally…";
const singleHan = /^\p{Script=Han}\p{Mark}*$/u;
const singleGlyph = /^(?:\p{Script=Han}|\p{Punctuation})\p{Mark}*$/u;

function resultExcerpt(text: string, mediaType: AttachmentSnapshot["media_type"]) {
  if (mediaType !== "application/pdf") return text;

  const lines = text.split("\n");
  const excerpt: string[] = [];
  // Repair long runs of single Chinese glyphs in the card preview.
  for (let start = 0; start < lines.length;) {
    let end = start;
    let hanCount = 0;
    while (end < lines.length && singleGlyph.test(lines[end].trim())) {
      if (singleHan.test(lines[end].trim())) hanCount++;
      end++;
    }
    if (hanCount >= 5) excerpt.push(lines.slice(start, end).map(line => line.trim()).join(""));
    else excerpt.push(...lines.slice(start, Math.max(start + 1, end)));
    start = Math.max(start + 1, end);
  }
  return excerpt.join("\n");
}

export function LocalDocumentsDialog({onClose,onUseSources,projectId}:{onClose:()=>void;onUseSources?:(sources:PreparedWebSource[])=>boolean;projectId?:string}) {
  const library=useLocalDocuments(projectId);const models=useLocalModels();const cache=useQueryClient();
  const [selected,setSelected]=useState<string[]>([]);const [query,setQuery]=useState("");const [results,setResults]=useState<LocalSearchResults>();
  const [minimum,setMinimum]=useState(0);
  const [chosen,setChosen]=useState<number[]>([]);const [preview,setPreview]=useState<AttachmentSnapshot>();
  const [copied,setCopied]=useState(false);const [busy,setBusy]=useState("");const [error,setError]=useState("");const [remove,setRemove]=useState<string>();
  const [options, setOptions] = useState<SearchOptions | undefined>("documents");
  const documentOptionsId = useId();
  const filterOptionsId = useId();
  const searchBody = useRef<HTMLDivElement>(null);
  const upload=useRef<HTMLInputElement>(null);const active=useRef<AbortController | undefined>(undefined);const epoch=useRef(0);
  const installed=models.data?.some(model=>model.id==="bge-small-zh" && model.state==="installed" && model.runtime_ready);
  const title = projectId ? "Search project materials" : "Search local documents";
  const canSearch = !busy && installed && selected.length > 0 && Boolean(query.trim());
  const canUseSelection = !busy && chosen.length > 0;
  useEffect(()=>()=>{epoch.current++;active.current?.abort();},[]);
  function clearResults() {
    setResults(undefined);
    setChosen([]);
    setCopied(false);
  }
  function reset() {
    epoch.current++;
    active.current?.abort();
    clearResults();
    setBusy("");
  }
  function showOptions(next: SearchOptions) {
    setOptions(options === next ? undefined : next);
    if (searchBody.current) searchBody.current.scrollTop = 0;
  }
  function scope(id:string){reset();setSelected(current=>current.includes(id)?current.filter(value=>value!==id):current.length<4?[...current,id]:current);}
  async function work(label:string,operation:(operation:Operation)=>Promise<void>) {
    active.current?.abort();
    const current = ++epoch.current;
    const controller = new AbortController();
    active.current = controller;
    const isCurrent = () => current === epoch.current && !controller.signal.aborted;
    setBusy(label);setError("");
    try { await operation({signal:controller.signal,isCurrent}); }
    catch(error) { if(isCurrent())setError(error instanceof Error?error.message:"The local document operation failed."); }
    finally {
      void cache.invalidateQueries({queryKey:localDocumentsKey});
      if(isCurrent()){active.current=undefined;setBusy("");}
    }
  }
  async function add(files:File[]){
    await work(indexingLabel,async({signal,isCurrent})=>{
      if(files.length>32)throw new Error("Choose up to 32 documents at a time.");
      for(const file of files){
      if(!isCurrent())return;
      if(file.size<1 || file.size>4*1024*1024)throw new Error("Each document must contain between 1 byte and 4 MiB.");
      const data=await readFile(file,signal);
      if(!isCurrent())return;
      await importLocalDocument({name:file.name,data},signal);
    }});
  }
  function reindex(id: string) {
    clearResults();
    void work(indexingLabel, ({signal}) => projectId
      ? reindexProjectDocument(projectId, id, signal)
      : reindexLocalDocument(id, signal));
  }
  async function search(){
    const current=++epoch.current;const controller=new AbortController();active.current?.abort();active.current=controller;setBusy(searchingLabel);setError("");
    setOptions(undefined);
    clearResults();
    if (searchBody.current) searchBody.current.scrollTop = 0;
    try{const value=await (projectId?searchProjectDocuments(projectId,selected,query,controller.signal,minimum):searchLocalDocuments(selected,query,controller.signal,minimum));if(current===epoch.current)setResults(value);}catch(error){if(current===epoch.current && !controller.signal.aborted)setError(error instanceof Error?error.message:"Local search failed.");}finally{if(current===epoch.current)setBusy("");}
  }
  async function attach(){
    if(!onUseSources || !results)return;
    await work("Preparing source snapshots…",async({signal,isCurrent})=>{
      const selections = chosen.map(index => {
        const { document_id, ordinal, source } = results.hits[index];
        return { document_id, ordinal, extraction_version: source.extraction_version || undefined };
      });
      const sources=await (projectId?prepareProjectSources(projectId,selections,signal):prepareLocalSources(selections,signal));
      if(!isCurrent()){
        for(const source of sources)void releaseWebSource(source.source_token).catch(()=>undefined);
        return;
      }
      if(onUseSources(sources))onClose();
      else throw new Error("Remove an existing source or make room in the chat draft before adding these results.");
    });
  }
  async function copySelected(){
    if(!results)return;const sections=new Map<string,string>();
    for(const index of chosen){const hit=results.hits[index];for(const section of hit.source.sections)sections.set(hit.document_id+":"+section.id,hit.source.name+" · "+section.id+"\n"+section.text);}
    try{await navigator.clipboard.writeText([...sections.values()].join("\n\n"));setCopied(true);}catch{setError("The selected text could not be copied. Select and copy the visible source text instead.");}
  }
  return (
    <>
      <Dialog open onClose={onClose} label={title} className="fixed inset-0 z-80 flex items-center justify-center p-2 sm:p-4">
        <DialogOverlay />
        <DialogContent className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl [@media(max-height:300px)]:overflow-y-auto">
          <header className="shrink-0 space-y-2 border-b border-border px-3 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 text-base font-semibold sm:text-lg">{title}</h2>
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
            <form className="flex gap-2" onSubmit={event => {
              event.preventDefault();
              event.stopPropagation();
              if (canSearch) void search();
            }}>
              <Input
                aria-label="What are you looking for?"
                className="h-8 min-w-0 flex-1"
                disabled={!!busy && busy !== searchingLabel}
                value={query}
                maxLength={400}
                onChange={event => { reset(); setQuery(event.target.value); }}
                placeholder="Search in selected documents"
              />
              <Button type="submit" size="sm" aria-label="Search selected documents" disabled={!canSearch}>Search</Button>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="xs" aria-expanded={options === "documents"} aria-controls={documentOptionsId} onClick={() => showOptions("documents")}>
                Documents
              </Button>
              <span className="text-xs text-muted-foreground">{selected.length} of 4 selected</span>
              <Button type="button" variant="outline" size="xs" aria-expanded={options === "filters"} aria-controls={filterOptionsId} onClick={() => showOptions("filters")}>
                {minimum > 0 ? `Filters · ${minimum.toFixed(2)}` : "Filters"}
              </Button>
            </div>
            {busy && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span role="status">{busy}</span>
                {(busy === searchingLabel || busy === indexingLabel) && (
                  <Button type="button" variant="ghost" size="xs" onClick={() => {
                    reset();
                    setError("Operation stopped. Completed documents stay in the library.");
                    void cache.invalidateQueries({ queryKey: localDocumentsKey });
                  }}>Stop</Button>
                )}
              </div>
            )}
          </header>
          <div ref={searchBody} role="region" aria-label="Document search content" tabIndex={0} className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5 [@media(max-height:300px)]:flex-none [@media(max-height:300px)]:overflow-visible">
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {!installed && (
              <div className="rounded-xl bg-muted p-3 text-sm">
                <p>Enable document search on this Mac. Your chat draft is preserved while the model downloads.</p>
                <LocalModelControl id="bge-small-zh" />
              </div>
            )}
            <section id={documentOptionsId} aria-label="Local document library" hidden={options !== "documents"} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{projectId ? "Searchable project materials" : "Your local library"}</h3>
                <FileInput ref={upload} multiple aria-label="Choose local documents" className="sr-only" tabIndex={-1} disabled={!!busy || !installed || Boolean(projectId)} onChange={event => {
                  void add(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }} />
                {!projectId && <Button type="button" variant="outline" size="sm" disabled={!!busy || !installed} onClick={() => upload.current?.click()}>Add documents</Button>}
              </div>
              <p className="text-xs text-muted-foreground">{projectId
                ? "Select materials marked Search when needed. Cove builds their indexes on this Mac as you search."
                : "Text, code, or text-based PDF. Files can be up to 4 MiB each, with up to 32 in the library."}</p>
              {library.isError && <p role="alert" className="text-sm text-destructive">The local library could not be loaded.</p>}
              {library.isLoading && <p role="status">Loading local documents…</p>}
              {!library.isLoading && library.data?.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                  {projectId ? "Add project materials in the project editor and choose Search when needed." : "Add a document to begin."}
                </p>
              )}
              <ul className="grid gap-2">
                {library.data?.map(item => (
                  <li key={item.id} className="flex min-w-0 flex-wrap items-start gap-2 rounded-xl border border-border p-3">
                    <label className="flex min-w-24 flex-1 items-start gap-2">
                      <Checkbox className="mt-0.5 shrink-0" checked={selected.includes(item.id)} disabled={!!busy || (selected.length >= 4 && !selected.includes(item.id))} onCheckedChange={() => scope(item.id)} />
                      <span className="min-w-0">
                        <strong className="block truncate text-sm font-medium" title={item.name}>{item.name}</strong>
                        <span className="text-xs text-muted-foreground">
                          {item.characters.toLocaleString()} characters · {item.needs_reindex
                            ? "PDF text update available"
                            : item.chunks ? `${item.chunks} indexed chunks` : "Needs indexing"}
                        </span>
                      </span>
                    </label>
                    {(!item.chunks || item.needs_reindex) && <Button type="button" variant="outline" size="sm" disabled={!!busy || !installed} onClick={() => reindex(item.id)}>Index again</Button>}
                    {!projectId && <Button type="button" variant="ghost" size="sm" disabled={!!busy} aria-label={`Delete document: ${item.name}`} onClick={() => setRemove(item.id)}>Delete</Button>}
                    {remove === item.id && (
                      <div className="basis-full rounded-lg bg-muted p-3 text-sm">
                        <p>Delete this library copy and its index? Snapshots already saved in chats are kept.</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="button" variant="destructive" size="sm" disabled={!!busy} onClick={() => void work("Deleting document…", async ({signal,isCurrent}) => {
                            await removeLocalDocument(item.id, signal);
                            if (!isCurrent()) return;
                            clearResults();
                            setSelected(current => current.filter(id => id !== item.id));
                            setRemove(undefined);
                          })}>Delete library copy</Button>
                          <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => setRemove(undefined)}>Keep document</Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section id={filterOptionsId} aria-label="Filters" hidden={options !== "filters"} className="rounded-xl border border-border p-3">
              <label className="grid gap-2 text-sm">
                Minimum similarity · {minimum.toFixed(2)}
                <Slider aria-label="Minimum similarity" min={0} max={1} step={0.05} value={minimum} disabled={!!busy} onValueChange={value => { reset(); setMinimum(value); }} />
                <span className="text-xs text-muted-foreground">Similarity ranks passages by closeness to your query. Raise the cutoff to hide weaker matches.</span>
              </label>
            </section>
            {results && (
              <section aria-label="Local search results" className="grid min-w-0 gap-2">
                <h3 className="text-sm font-semibold">
                  {results.hits.length} {results.hits.length === 1 ? "result" : "results"}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{results.elapsed_ms} ms</span>
                </h3>
                {results.hits.length === 0 && <p role="status" className="text-sm text-muted-foreground">No passages meet the current similarity filter. Lower the minimum or try a more specific question.</p>}
                {results.hits.map((hit, index) => {
                  const sectionIds = hit.source.sections.map(section => section.id).join(", ");
                  return (
                    <article key={`${hit.document_id}:${hit.ordinal}`} className="min-w-0 space-y-2 rounded-xl border border-border p-3">
                      <label className="flex min-w-0 items-start gap-2">
                        <Checkbox className="mt-0.5 shrink-0" disabled={!!busy} checked={chosen.includes(index)} onCheckedChange={() => {
                          setChosen(current => current.includes(index) ? current.filter(value => value !== index) : [...current, index]);
                          setCopied(false);
                        }} />
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm font-medium" title={hit.source.name}>{hit.source.name}</strong>
                          <span className="block truncate text-xs text-muted-foreground" title={sectionIds}>{sectionIds}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground" title="Similarity">
                          <span className="sr-only">Similarity </span>{hit.score.toFixed(3)}
                        </span>
                      </label>
                      <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
                        {resultExcerpt(hit.text, hit.source.media_type)}
                      </p>
                      <Button type="button" variant="link" size="none" className="text-xs" onClick={() => setPreview(hit.source)}>View cited source sections</Button>
                    </article>
                  );
                })}
                {results.hits.length > 0 && (
                  <p className="text-xs text-muted-foreground">{onUseSources
                    ? "Only selected original sections are attached. Your model receives them with other relevant context when you send."
                    : "Open a conversation to use selected results in chat."}</p>
                )}
              </section>
            )}
          </div>
          {!!results?.hits.length && (
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 sm:px-5">
              <span role="status" className="text-xs text-muted-foreground">{chosen.length} {chosen.length === 1 ? "passage" : "passages"} selected</span>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" aria-label="Copy selected text" disabled={!canUseSelection} onClick={() => void copySelected()}>
                  {copied ? "Copied" : "Copy text"}
                </Button>
                {onUseSources && <Button type="button" size="sm" aria-label="Use selected results in chat" disabled={!canUseSelection} onClick={() => void attach()}>Add to chat</Button>}
              </div>
              {copied && <p role="status" className="sr-only">Selected source text copied.</p>}
            </footer>
          )}
        </DialogContent>
      </Dialog>
      {preview && <DocumentPreview document={preview} onClose={() => setPreview(undefined)} />}
    </>
  );
}
