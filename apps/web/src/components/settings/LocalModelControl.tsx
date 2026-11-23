import { Disclosure, DisclosureTrigger, DisclosureContent } from "@/components/ui/disclosure";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";
import { useLocalModelAction, useLocalModels } from "@/api/hooks/useLocalModels";
import { Button } from "@/components/ui/button";
import { useLocalSpeech } from "@/components/chat/LocalSpeech";

export function LocalModelControl({id,onUse,useLabel="Use in this chat",useDisabled=false,compact=false}:{id:string;onUse?:()=>void;useLabel?:string;useDisabled?:boolean;compact?:boolean}) {
  const catalog=useLocalModels();const action=useLocalModelAction();const [confirm,setConfirm]=useState(false);
  const speech=useLocalSpeech();
  const model=catalog.data?.find(item=>item.id===id);
  if (!model) return catalog.isError ? <p className="mt-4 text-sm text-destructive">Local model status could not be loaded.</p> : null;
  const run=(kind:"install"|"cancel"|"remove")=>{if(kind==="remove"&&model.role==="tts")speech?.stop();setConfirm(false);action.mutate({id,action:kind});};
  return <div className="mt-4 grid gap-3 border-t border-border pt-4 text-sm">
    {!model.runtime_ready && <p className="text-muted-foreground">{model.role==="tts"?"Local speech":"Local inference"} requires Cove's bundled runtime on Apple Silicon with macOS 13.3 or later.</p>}
    {model.state==="downloading" ? <><p role="status">{model.downloaded_bytes>=model.bytes?"Verifying and installing":"Downloading"}: {(model.downloaded_bytes/1e6).toFixed(1)} / {(model.bytes/1e6).toFixed(1)} MB</p><Progress className="h-2 w-full accent-primary" max={model.bytes} value={model.downloaded_bytes} aria-label="Model download progress"/><Button variant="outline" disabled={action.isPending} onClick={()=>run("cancel")}>Cancel download</Button></> : model.state==="installed" ? <>
      <p className="font-medium text-primary">Installed locally · SHA-256 checked</p>
      {onUse && <Button disabled={useDisabled || !model.runtime_ready} onClick={onUse}>{useLabel}</Button>}
      {!compact && (confirm ? <div className="grid gap-2"><p>{model.role==="tts"?"Remove this speech model and stop its current reading? Other installed models and saved answers are kept.":id==="bge-small-zh" ? "Disable document search and remove its model and indexes, including project indexes? Library documents, project materials, and saved chat sources are kept." : "Remove this local chat model? It becomes unavailable for new answers. Other installed models and saved answers are kept."}</p><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={action.isPending} onClick={()=>run("remove")}>Remove model</Button><Button variant="ghost" onClick={()=>setConfirm(false)}>Keep model</Button></div></div> : <Button variant="ghost" onClick={()=>setConfirm(true)}>Remove local download</Button>)}
    </> : <Button disabled={action.isPending || !model.runtime_ready} onClick={()=>run("install")}>{action.isPending?"Starting download…":`${model.state==="failed"?"Retry or resume download":"Download and install"} · ${(model.bytes/1e6).toFixed(1)} MB`}</Button>}
    {model.state==="failed"&&<Button variant="ghost" disabled={action.isPending} onClick={()=>run("remove")}>Discard partial download</Button>}
    {model.state==="failed"&&<p className="text-xs text-muted-foreground">Retry resumes interrupted downloads when supported. Complete files are checked before installation. Cancel discards partial files.</p>}
    {(action.error || model.error) && <p role="alert" className="text-destructive">{action.error?.message ?? model.error}</p>}
    {!compact && <Disclosure className="text-muted-foreground"><DisclosureTrigger className="cursor-pointer">Installed artifact details</DisclosureTrigger><DisclosureContent><p className="mt-2 break-all">{model.filename}<br/>Revision: {model.revision}<br/>SHA-256: {model.sha256}<br/>Runtime: {model.runtime_version}</p></DisclosureContent></Disclosure>}
  </div>;
}
