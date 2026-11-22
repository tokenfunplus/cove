import { useEffect, useState } from "react";
import type { PreparedWebSource } from "@cove/api-contract";
import { Button } from "@/components/ui/button";
import { useLocalModels } from "@/api/hooks/useLocalModels";
import { LocalModelControl } from "./LocalModelControl";
import { LocalDocumentsDialog } from "./LocalDocumentsDialog";
import { LocalModelDiscovery } from "./LocalModelDiscovery";
import { SpeechSettingsPanel } from "./SpeechSettingsPanel";
import { localModelCatalog } from "@/lib/local-model-catalog";

type LocalEntry = {tab:"installed"|"discover"|"speech";purpose?:"speak";modelId?:string};
type PanelProps = {entry?:LocalEntry;manage?:boolean;onUseSources?:(sources:PreparedWebSource[])=>boolean;onUseChat?:(modelId:string)=>Promise<boolean|undefined>};
export function LocalModelsPanel(props:PanelProps){
 const [tab,setTab]=useState<LocalEntry["tab"]>(props.entry?.tab??"installed");
 const [discovered,setDiscovered]=useState(props.entry?.tab==="discover");
 const [speechModel,setSpeechModel]=useState(props.entry?.modelId);
 const [request,setRequest]=useState<{purpose?:"speak"}|undefined>(props.entry);
 useEffect(()=>{if(props.entry){setTab(props.entry.tab);setSpeechModel(props.entry.modelId);setRequest(props.entry);if(props.entry.tab==="discover")setDiscovered(true);}},[props.entry]);
 function useSpeech(modelId:string){setSpeechModel(modelId);setTab("speech");}
 function discoverSpeech(){setRequest({purpose:"speak"});setDiscovered(true);setTab("discover");}
 function selectTab(value: LocalEntry["tab"]) { setTab(value); if(value==="discover")setDiscovered(true); }
 if(!props.manage)return <LocalModelDiscovery {...props}/>;
 return <section aria-label="On this Mac" className="grid gap-5">
  <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><h3 className="text-xl font-semibold">On this Mac</h3>
  <div className="flex gap-1 rounded-xl bg-muted/50 p-1" role="group" aria-label="Local capability views">{(["installed","discover","speech"] as const).map(value=><Button key={value} size="sm" variant={tab===value?"secondary":"ghost"} aria-pressed={tab===value} onClick={()=>selectTab(value)}>{value==="installed"?"Installed":value==="discover"?"Discover":"Speech"}</Button>)}</div>
  <p className="w-full text-xs leading-relaxed text-muted-foreground">Local tools, voices, and chat models. Model files are downloaded once.</p></header>
  {tab==="installed"&&<InstalledCapabilities {...props} onUseSpeech={useSpeech} onDiscover={()=>selectTab("discover")}/>}
  {discovered&&<div hidden={tab!=="discover"}><LocalModelDiscovery {...props} onUseSpeech={useSpeech} request={request}/></div>}
  {tab==="speech"&&<SpeechSettingsPanel key={speechModel} initialModelId={speechModel} onDiscover={discoverSpeech}/>}
 </section>;
}
function InstalledCapabilities({onUseChat,onUseSources,onDiscover,onUseSpeech}:PanelProps&{onDiscover:()=>void;onUseSpeech:(id:string)=>void}){
 const models=useLocalModels();const [documents,setDocuments]=useState(false);const [using,setUsing]=useState(false);const [error,setError]=useState("");
 async function useChat(modelId:string){setUsing(true);setError("");try{if(!await onUseChat?.(modelId))setError("The local chat target is not ready yet. Try again after its catalog loads.");}catch{setError("The local chat model could not be selected. Try again.");}finally{setUsing(false);}}
 const installed=models.data?.filter(model=>model.state==="installed" || model.state==="downloading" || model.state==="failed")??[];
 return <>
  {models.isLoading&&<p role="status">Loading installed capabilities…</p>}
  {models.isError&&<p role="alert">Installed capabilities could not be loaded.</p>}
  {!models.isLoading&&!models.isError&&!installed.length&&<div className="grid justify-items-start gap-3 rounded-xl border border-dashed border-border p-5"><h4 className="font-medium">Start with something useful</h4><p className="text-sm text-muted-foreground">Add document search, a local reading voice, or an offline chat model.</p><Button onClick={onDiscover}>Discover local capabilities</Button></div>}
  {installed.map(model=><article key={model.id} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{model.id==="bge-small-zh"?"Search your documents":model.name}</h4><span className="text-xs text-muted-foreground">{model.role==="chat"?"Chat model":model.role==="tts"?"Speech tool":"Tool"} · On this Mac</span></div><p className="mt-2 text-sm text-muted-foreground">{model.id==="bge-small-zh"?"Find and preview original passages in selected documents. Search uses BGE Small Chinese.":localModelCatalog.find(item=>item.id===model.id)?.limitation ?? "Experimental local model. Verify all outputs."}</p><LocalModelControl id={model.id} onUse={model.role==="tts"?()=>onUseSpeech(model.id):model.id==="bge-small-zh"?()=>setDocuments(true):onUseChat?()=>void useChat(model.id):undefined} useLabel={model.role==="tts"?"Speech settings":model.id==="bge-small-zh"?"Open document search":"Use in this chat"} useDisabled={using}/></article>)}
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {documents&&<LocalDocumentsDialog onClose={()=>setDocuments(false)} onUseSources={onUseSources}/>}
 </>;
}
