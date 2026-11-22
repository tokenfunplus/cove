import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2, Pause, Play, Settings2, Square, Volume2, X } from "lucide-react";
import type { SpeechJob, SpeechPreview } from "@cove/api-contract";
import * as api from "@/api/speech";
import { LocalServiceError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import { settingsStyles } from "@/styles/settings";
import { Tooltip } from "@/components/ui/tooltip";
import type { AnswerSource } from "./AnswerActions";

export type SpeechResult = "finished" | "stopped" | "failed";
type Playback = {phase:"preparing"|"playing"|"buffering"|"paused"|"finished"|"failed";kind:"answer"|"preview"|"debate";sourceId?:string;label?:string;job?:SpeechJob;error?:string};
type SpeechControl = {
  playback?:Playback; read:(source:AnswerSource,selection?:string)=>void; preview:(input:SpeechPreview)=>void;
  readDebateTurn:(debateId:string,turnId:string,label:string)=>Promise<SpeechResult>; ensureReady:()=>Promise<boolean>;
  stop:()=>void; pause:()=>void; resume:()=>void; download:()=>void; openSettings:()=>void;
};
const SpeechContext=createContext<SpeechControl|undefined>(undefined);
export const useLocalSpeech=()=>useContext(SpeechContext);

export function LocalSpeechProvider({children,conversationId,onDiscover,onSettings}:{children:ReactNode;conversationId?:string;onDiscover:()=>void;onSettings:()=>void}){
  const [playback,setPlayback]=useState<Playback>();
  const [missing,setMissing]=useState(false);
  const epoch=useRef(0);const jobId=useRef<string|undefined>(undefined);const audio=useRef<HTMLAudioElement|undefined>(undefined);
  const urls=useRef(new Set<string>());const queue=useRef<string[]>([]);const paused=useRef(false);const hasAudio=useRef(false);const complete=useRef(false);const controller=useRef<AbortController|undefined>(undefined);
  const audioFailure=useRef<string|undefined>(undefined);
  const callbacks=useRef({onDiscover,onSettings});callbacks.current={onDiscover,onSettings};
  const stop=useCallback(()=>{
    epoch.current++;controller.current?.abort();controller.current=undefined;
    const id=jobId.current;jobId.current=undefined;if(id)void api.stopSpeech(id).catch(()=>{});
    if(audio.current){audio.current.onended=null;audio.current.onerror=null;audio.current.pause();audio.current.removeAttribute("src");audio.current.load();}
    for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();queue.current=[];hasAudio.current=false;paused.current=false;complete.current=false;audioFailure.current=undefined;
    setPlayback(undefined);
  },[]);
  useEffect(()=>{stop();return stop;},[conversationId,stop]);
  useEffect(()=>{const end=()=>stop();window.addEventListener("pagehide",end);return()=>window.removeEventListener("pagehide",end);},[stop]);

  const playNext=useRef<()=>void>(()=>{});
  playNext.current=()=>{
    const player=audio.current;if(!player||paused.current||hasAudio.current)return;
    const next=queue.current.shift();
    if(!next){setPlayback(value=>value?{...value,phase:complete.current?"finished":"buffering"}:value);return;}
    const version=epoch.current;hasAudio.current=true;player.src=next;
    player.onended=()=>{if(version!==epoch.current)return;URL.revokeObjectURL(next);urls.current.delete(next);hasAudio.current=false;playNext.current();};
    player.onerror=()=>{if(version!==epoch.current)return;player.pause();audioFailure.current="This browser could not play the local audio.";setPlayback(value=>value?{...value,phase:"failed",error:audioFailure.current}:value);};
    void player.play().then(()=>{if(version===epoch.current)setPlayback(value=>value?{...value,phase:"playing"}:value);}).catch(()=>{if(version===epoch.current){paused.current=true;setPlayback(value=>value?{...value,phase:player.error?"failed":"paused",...(player.error?{error:"This browser could not play the local audio. Download it or try another browser."}:{})}:value);}});
  };
  async function begin(start:()=>Promise<SpeechJob>,kind:Playback["kind"],sourceId?:string,label?:string):Promise<SpeechResult>{
    stop();setMissing(false);const version=epoch.current;
    setPlayback({phase:"preparing",kind,sourceId,label});
    try{
      // Do not abort admission: a late reply must still be canceled by job ID.
      const job=await start();
      if(version!==epoch.current){void api.stopSpeech(job.id).catch(()=>{});return "stopped";}
      jobId.current=job.id;const abort=new AbortController();controller.current=abort;
      const player=new Audio();audio.current=player;player.volume=job.volume??0.9;player.playbackRate=job.playback_rate;
      let downloaded=0;
      setPlayback({phase:"preparing",kind,sourceId,label,job});
      while(version===epoch.current){
        if(audioFailure.current)throw new Error(audioFailure.current);
        const status=await api.getSpeechJob(job.id,abort.signal);
        if(version!==epoch.current)return "stopped";
        if(status.state==="failed"||status.state==="stopped")throw new Error(status.error||"Reading stopped.");
        setPlayback(value=>value?{...value,job:status}:value);
        for(;downloaded<status.ready_chunks;downloaded++){
          const blob=await api.speechAudio(job.id,downloaded,abort.signal);
          if(version!==epoch.current)return "stopped";
          const url=URL.createObjectURL(blob);urls.current.add(url);queue.current.push(url);playNext.current();
        }
        if(status.state==="completed"){complete.current=true;if(!hasAudio.current&&!queue.current.length)setPlayback(value=>value?{...value,phase:"finished"}:value);if(!hasAudio.current&&!queue.current.length)break;}
        await new Promise(resolve=>setTimeout(resolve,status.state==="completed"?1000:350));
      }
      return version===epoch.current?"finished":"stopped";
    }catch(error){
      if(version!==epoch.current)return "stopped";
      const requiresModel=error instanceof LocalServiceError&&error.envelope.error.code==="speech_model_required";
      const message=error instanceof Error?error.message:"Local speech is unavailable.";
      stop();if(requiresModel)setMissing(true);setPlayback({phase:"failed",kind,sourceId,label,error:message});
      return "failed";
    }
  }
  async function ensureReady(){
    const version=epoch.current;
    const configuration=await api.getSpeechConfiguration();
    if(version!==epoch.current)return false;
    const {settings,models}=configuration;
    const choices=settings.mode==="manual"?models.filter(model=>model.id===settings.model_id):models.filter(model=>
      model.languages.some(language=>{
        const preferred=language==="zh"?settings.chinese_model_id:settings.english_model_id;
        return !preferred||preferred===model.id;
      }));
    if(!choices.some(model=>model.installed)){setMissing(true);return false;}
    if(!choices.some(model=>model.installed&&model.runtime_ready))throw new Error("The local speech runtime is unavailable. Check Speech settings or update Cove.");
    return true;
  }
  const pause=()=>{paused.current=true;audio.current?.pause();setPlayback(value=>value?{...value,phase:"paused"}:value);};
  const resume=()=>{
    paused.current=false;const version=epoch.current;
    if(hasAudio.current&&audio.current){void audio.current.play().then(()=>{if(version===epoch.current)setPlayback(value=>value?{...value,phase:"playing"}:value);}).catch(()=>{if(version===epoch.current)paused.current=true;});}
    else playNext.current();
  };
  async function download(){
    const id=jobId.current;if(!id)return;
    try{const blob=await api.speechAudio(id);if(jobId.current!==id)return;const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="cove-reading.wav";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch{setPlayback(value=>value?{...value,error:"The audio could not be exported. Try again."}:value);}
  }
  const value:SpeechControl={playback,read:(source,selection)=>void begin(()=>api.readAnswer(source.conversationId,source.messageId,selection),"answer",source.messageId),readDebateTurn:(debateId,turnId,label)=>begin(()=>api.readDebateTurn({debate_id:debateId,turn_id:turnId}),"debate",turnId,label),ensureReady,preview:input=>void begin(()=>api.previewSpeech(input),"preview"),stop,pause,resume,download:()=>void download(),openSettings:()=>{stop();callbacks.current.onSettings();}};
  return <SpeechContext.Provider value={value}>{children}
    {(playback?.kind==="answer"||playback?.kind==="debate")&&<div role="region" aria-label="Local read aloud" className="fixed bottom-5 left-1/2 z-60 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-popover p-3 shadow-popover"><SpeechPlaybackControls/></div>}
    <Dialog open={missing} onClose={()=>setMissing(false)} className={settingsStyles.conversationDialog}>
      <DialogOverlay className={settingsStyles.conversationDialog_backdrop}/>
      <div className={settingsStyles.conversationDialog_viewport}><DialogContent className={settingsStyles.conversationDialog_panel}>
        <DialogTitle as="h2">Add a local voice</DialogTitle>
        <p>Download a speech model in On this Mac &gt; Discover, or choose an installed voice in Speech settings. Your conversation and unsent draft stay here. Debate read aloud stays off until you enable it again.</p>
        <div className={settingsStyles.conversationDialog_actions}>
          <Button variant="ghost" onClick={()=>setMissing(false)}>Cancel</Button>
          <Button variant="outline" onClick={()=>{setMissing(false);stop();callbacks.current.onSettings();}}>Speech settings</Button>
          <Button autoFocus onClick={()=>{setMissing(false);stop();callbacks.current.onDiscover();}}>Open Discover</Button>
        </div>
      </DialogContent></div>
    </Dialog>
  </SpeechContext.Provider>;
}

export function SpeechPlaybackControls(){
  const speech=useLocalSpeech();const state=speech?.playback;if(!speech||!state)return null;
  const preparing=state.phase==="preparing"||state.phase==="buffering";
  return <div className="grid gap-2 text-xs">
    <div className="flex items-center gap-2"><Volume2 className="size-4 shrink-0 text-primary" aria-hidden="true"/><div className="min-w-0 flex-1"><p className="font-medium" role="status">{state.phase==="playing"?"Reading on this Mac":state.phase==="paused"?"Reading paused":state.phase==="finished"?"Reading finished":state.phase==="failed"?"Reading unavailable":"Preparing audio on this Mac…"}</p>{state.label&&<p className="mt-1 truncate font-medium">{state.label}</p>}{state.job&&<p className="mt-1 truncate text-muted-foreground">{state.job.model_name} · {state.job.voice_name}</p>}</div><Button size="icon-xs" variant="ghost" aria-label="Close read aloud" onClick={speech.stop}><X aria-hidden="true"/></Button></div>
    <div className="flex flex-wrap items-center gap-1">
      {preparing?<span className="flex items-center gap-1.5 pr-2 text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true"/>{state.job?`${state.job.ready_chunks} / ${state.job.total_chunks} passages ready`:"Loading voice…"}</span>:state.phase==="playing"?<Button size="sm" variant="ghost" onClick={speech.pause}><Pause aria-hidden="true"/>Pause</Button>:state.phase==="paused"?<Button size="sm" variant="ghost" onClick={speech.resume}><Play aria-hidden="true"/>Resume</Button>:null}
      {!['finished','failed'].includes(state.phase)&&<Button size="sm" variant="ghost" onClick={speech.stop}><Square aria-hidden="true"/>Stop reading</Button>}
      {state.job?.state==="completed"&&<Button size="sm" variant="ghost" onClick={speech.download}><Download aria-hidden="true"/>Download audio</Button>}
      <Button size="sm" variant="ghost" onClick={speech.openSettings}><Settings2 aria-hidden="true"/>Speech settings</Button>
    </div>
    {state.error&&<p role="alert" className="text-destructive">{state.error}</p>}
  </div>;
}

export function ReadAloudButton({source,selection}:{source:AnswerSource;selection?:string}){
  const speech=useLocalSpeech();if(!speech||!source.body.trim())return null;
  const active=speech.playback?.sourceId===source.messageId&&!['finished','failed'].includes(speech.playback.phase);
  const preparing=active&&['preparing','buffering'].includes(speech.playback!.phase);
  const label=selection?"Read selected text aloud":active?"Stop reading this answer":"Read aloud on this Mac";
  return <Tooltip content={label} suppressRestoredFocus><Button size="icon-xs" variant="ghost" aria-label={label} aria-pressed={active} onClick={()=>active?speech.stop():speech.read(source,selection)} className={active?"text-primary":""}>{preparing?<Loader2 className="animate-spin" aria-hidden="true"/>:active?<Square aria-hidden="true"/>:<Volume2 aria-hidden="true"/>}</Button></Tooltip>;
}
