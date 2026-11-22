import { Checkbox } from "@/components/ui/checkbox";
import { FileInput } from "@/components/ui/file-input";
import { useEffect, useRef, useState } from "react";
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

export function LocalDocumentsDialog({onClose,onUseSources,projectId}:{onClose:()=>void;onUseSources?:(sources:PreparedWebSource[])=>boolean;projectId?:string}) {
  const library=useLocalDocuments(projectId);const models=useLocalModels();const cache=useQueryClient();
  const [selected,setSelected]=useState<string[]>([]);const [query,setQuery]=useState("");const [results,setResults]=useState<LocalSearchResults>();
  const [chosen,setChosen]=useState<number[]>([]);const [preview,setPreview]=useState<AttachmentSnapshot>();
  const [copied,setCopied]=useState(false);const [busy,setBusy]=useState("");const [error,setError]=useState("");const [remove,setRemove]=useState<string>();
  const upload=useRef<HTMLInputElement>(null);const active=useRef<AbortController | undefined>(undefined);const epoch=useRef(0);
  const installed=models.data?.some(model=>model.id==="bge-small-zh" && model.state==="installed" && model.runtime_ready);
  useEffect(()=>()=>{epoch.current++;active.current?.abort();},[]);
  const reset=()=>{epoch.current++;active.current?.abort();setResults(undefined);setChosen([]);setBusy("");};
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
    await work("Indexing documents locally…",async({signal,isCurrent})=>{
      if(files.length>32)throw new Error("Choose up to 32 documents at a time.");
      for(const file of files){
      if(!isCurrent())return;
      if(file.size<1 || file.size>4*1024*1024)throw new Error("Each document must contain between 1 byte and 4 MiB.");
      const data=await readFile(file,signal);
      if(!isCurrent())return;
      await importLocalDocument({name:file.name,data},signal);
    }});
  }
  async function search(){
    const current=++epoch.current;const controller=new AbortController();active.current?.abort();active.current=controller;setBusy("Searching selected documents locally…");setError("");setResults(undefined);setChosen([]);
    try{const value=await (projectId?searchProjectDocuments(projectId,selected,query,controller.signal):searchLocalDocuments(selected,query,controller.signal));if(current===epoch.current)setResults(value);}catch(error){if(current===epoch.current && !controller.signal.aborted)setError(error instanceof Error?error.message:"Local search failed.");}finally{if(current===epoch.current)setBusy("");}
  }
  async function attach(){
    if(!onUseSources || !results)return;
    await work("Preparing source snapshots…",async({signal,isCurrent})=>{
      const selections=chosen.map(index=>({document_id:results.hits[index].document_id,ordinal:results.hits[index].ordinal}));
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
  return <>
    <Dialog open onClose={onClose} label={projectId?"Search project materials":"Search local documents"} className="fixed inset-0 z-80 flex items-center justify-center p-3 sm:p-6">
      <DialogOverlay/><DialogContent className="flex max-h-[90dvh] w-full max-w-4xl flex-col gap-4 overflow-hidden rounded-2xl p-4 sm:p-6">
        <header className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{projectId?"Search project materials":"Search local documents"}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Choose up to four documents to search on this Mac. Preview results and select original passages before adding them to chat.</p></div><Button variant="ghost" onClick={onClose}>Close</Button></header>
        <div className="grid min-h-0 gap-5 overflow-y-auto">
          {!installed && <div className="rounded-xl bg-muted p-3 text-sm"><p>Enable document search on this Mac. Your chat draft is preserved while the model downloads.</p><LocalModelControl id="bge-small-zh"/></div>}
          <section aria-label="Local document library" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{projectId?"Searchable project materials":"Your local library"}</h3><FileInput ref={upload}  multiple aria-label="Choose local documents" className="sr-only" tabIndex={-1} disabled={!!busy || !installed || Boolean(projectId)} onChange={event=>{void add(Array.from(event.target.files??[]));event.target.value="";}}/>{!projectId&&<Button variant="outline" disabled={!!busy || !installed} onClick={()=>upload.current?.click()}>Add documents</Button>}</div>
            <p className="text-sm text-muted-foreground">{projectId?"Only materials marked Search when needed are listed. Manage them in the project editor. Indexes are built locally when you search.":"Text, code, and text-based PDFs · 4 MiB per file · up to 32 saved documents. Original bytes and indexes remain on this Mac."}</p>
            {library.isError && <p role="alert" className="text-sm text-destructive">The local library could not be loaded.</p>}
            {library.isLoading && <p role="status">Loading local documents…</p>}
            {!library.isLoading && library.data?.length===0 && <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{projectId?"Add project materials in the project editor and choose Search when needed.":"Add a document to begin."}</p>}
            <ul className="grid gap-2">{library.data?.map(item=><li key={item.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-border p-3">
              <label className="flex min-w-0 flex-1 items-start gap-3"><Checkbox  className="mt-1 " checked={selected.includes(item.id)} disabled={!!busy || (selected.length>=4 && !selected.includes(item.id))} onCheckedChange={()=>scope(item.id)}/><span className="min-w-0"><strong className="block break-words text-sm font-medium">{item.name}</strong><span className="text-sm text-muted-foreground">{item.characters.toLocaleString()} characters · {item.chunks?`${item.chunks} indexed chunks`:"Needs indexing"}</span></span></label>
              {!item.chunks && <Button variant="outline" size="sm" disabled={!!busy || !installed} onClick={()=>void work("Indexing document…",({signal})=>projectId?reindexProjectDocument(projectId,item.id,signal):reindexLocalDocument(item.id,signal))}>Index again</Button>}
              {!projectId&&<Button variant="ghost" size="sm" disabled={!!busy} aria-label={`Delete document: ${item.name}`} onClick={()=>setRemove(item.id)}>Delete</Button>}
              {remove===item.id && <div className="basis-full rounded-lg bg-muted p-3 text-sm"><p>Delete this library copy and its index? Snapshots already saved in chats are kept.</p><div className="mt-2 flex gap-2"><Button variant="destructive" size="sm" disabled={!!busy} onClick={()=>void work("Deleting document…",async({signal,isCurrent})=>{await removeLocalDocument(item.id,signal);if(!isCurrent())return;setResults(undefined);setChosen([]);setSelected(current=>current.filter(id=>id!==item.id));setRemove(undefined);})}>Delete library copy</Button><Button variant="ghost" size="sm" disabled={!!busy} onClick={()=>setRemove(undefined)}>Keep document</Button></div></div>}
            </li>)}</ul>
          </section>
          <form className="grid gap-3 border-t border-border pt-4" onSubmit={event=>{event.preventDefault();void search();}}>
            <label className="grid gap-2 text-sm font-medium">What are you looking for?<Input disabled={!!busy && busy!=="Searching selected documents locally…"} value={query} maxLength={400} onChange={event=>{reset();setQuery(event.target.value);}} placeholder="Ask a question about the selected documents"/></label>
            <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!!busy || !installed || !selected.length || !query.trim()}>Search selected documents</Button><span className="text-sm text-muted-foreground">{selected.length} / 4 selected · Chinese-focused retrieval</span></div>
          </form>
          {busy && <div role="status" className="flex items-center justify-between gap-2 text-sm"><span>{busy}</span>{(busy==="Searching selected documents locally…" || busy==="Indexing documents locally…") && <Button variant="ghost" onClick={()=>{reset();setError("Operation stopped. Completed documents stay in the library.");void cache.invalidateQueries({queryKey:localDocumentsKey});}}>Stop</Button>}</div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {results && <section aria-label="Local search results" className="grid gap-3">
            <Button variant="outline" disabled={!!busy||!chosen.length} onClick={()=>void copySelected()}>Copy selected text</Button>{copied&&<p role="status" className="text-sm">Selected source text copied.</p>}
            <h3 className="font-semibold">{results.hits.length} results · {results.elapsed_ms} ms</h3><p className="text-sm text-muted-foreground">Similarity is a ranking signal, not a confidence score. Open the cited lines or pages to check the original text.</p>
            {results.hits.map((hit,index)=><article key={`${hit.document_id}:${hit.ordinal}`} className="grid gap-3 rounded-xl border border-border p-4"><label className="flex items-start gap-3"><Checkbox  className="mt-1 " disabled={!!busy} checked={chosen.includes(index)} onCheckedChange={()=>setChosen(current=>current.includes(index)?current.filter(value=>value!==index):[...current,index])}/><span className="text-sm font-medium">{hit.source.name} · {hit.source.sections.map(section=>section.id).join(", ")} · similarity {hit.score.toFixed(3)}</span></label><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{hit.text}</p><Button variant="link" className="h-auto justify-start p-0" onClick={()=>setPreview(hit.source)}>View cited source sections</Button></article>)}
            {onUseSources ? <><p className="text-sm text-muted-foreground">Search runs on this Mac. Only selected original sections are attached; your chosen answer model receives them when you send. Other chat and project context may also be included.</p><Button disabled={!!busy || !chosen.length} onClick={()=>void attach()}>Use selected results in chat</Button></> : <p className="text-sm text-muted-foreground">Open a conversation to use selected results in chat.</p>}
          </section>}
        </div>
      </DialogContent>
    </Dialog>
    {preview && <DocumentPreview document={preview} onClose={()=>setPreview(undefined)}/>}
  </>;
}
