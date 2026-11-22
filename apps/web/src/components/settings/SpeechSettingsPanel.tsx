import { useEffect, useRef, useState } from "react";
import { Play, Save, Volume2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { SpeechConfiguration, SpeechProfile, SpeechSettings } from "@cove/api-contract";
import { useSpeechConfiguration } from "@/api/hooks/useSpeech";
import { saveSpeechSettings } from "@/api/speech";
import { speechKey } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import { useLocalSpeech, SpeechPlaybackControls } from "@/components/chat/LocalSpeech";
import { localModelsStyles } from "@/styles/local-models";

export function SpeechSettingsPanel({onDiscover,initialModelId}:{onDiscover:()=>void;initialModelId?:string}){
  const configuration=useSpeechConfiguration();const cache=useQueryClient();const speech=useLocalSpeech();
  const [draft,setDraft]=useState<SpeechSettings>();const speechRef=useRef(speech);speechRef.current=speech;
  const [editing,setEditing]=useState(initialModelId??"");const [preview,setPreview]=useState("");
  const [saving,setSaving]=useState(false);const [feedback,setFeedback]=useState<{error:boolean;text:string}>();
  const dirty=Boolean(draft&&JSON.stringify(draft)!==JSON.stringify(configuration.data?.settings));const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  useEffect(()=>{if(configuration.data&&!dirtyRef.current)setDraft(structuredClone(configuration.data.settings));},[configuration.data]);
  useEffect(()=>()=>{if(speechRef.current?.playback?.kind==="preview")speechRef.current.stop();},[]);
  if(configuration.isLoading)return <p role="status">Loading speech settings…</p>;
  if(configuration.isError)return <div role="alert" className="grid justify-items-start gap-3"><p>Speech settings could not be loaded.</p><Button variant="outline" onClick={()=>void configuration.refetch()}>Try again</Button></div>;
  if(!draft||!configuration.data)return null;
  const models=configuration.data.models;
  const selectedId=editing||(draft.mode==="manual"?draft.model_id:"")||models.find(model=>model.installed)?.id||models[0]?.id;
  const model=models.find(model=>model.id===selectedId)??models[0];
  const profile=model?draft.profiles[model.id]:undefined;
  const sample=preview||(model?.languages.includes("zh")?"\u4f60\u597d\uff0c\u8fd9\u662f Cove \u7684\u672c\u5730\u6717\u8bfb\u3002\u4f60\u53ef\u4ee5\u9009\u62e9\u559c\u6b22\u7684\u58f0\u97f3\uff0c\u8c03\u6574\u8bed\u901f\u3002":"Hello, this is Cove reading on your Mac. Choose a voice and a comfortable reading pace.");
  function update(patch:Partial<SpeechSettings>){setFeedback(undefined);setDraft(value=>value?{...value,...patch}:value);}
  function updateProfile(patch:Partial<SpeechProfile>){if(!model||!profile)return;update({profiles:{...draft!.profiles,[model.id]:{...profile,...patch}}});}
  async function save(){if(!draft)return;setSaving(true);setFeedback(undefined);speech?.stop();try{const result=await saveSpeechSettings(draft);cache.setQueryData<SpeechConfiguration>(speechKey,result);setDraft(structuredClone(result.settings));setFeedback({error:false,text:"Speech settings saved."});}catch(error){setFeedback({error:true,text:error instanceof Error?error.message:"Speech settings could not be saved."});}finally{setSaving(false);}}
  const modelOption=(id:string,name:string,installed:boolean)=><option key={id} value={id}>{name}{installed?"":" · Not installed"}</option>;
  return <section aria-label="Local speech settings" className="grid gap-5">
    <header><h4 className="flex items-center gap-2 text-base font-semibold"><Volume2 className="size-4 text-primary" aria-hidden="true"/>Read aloud on this Mac</h4><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Use the sound button below an answer to listen. Speech stays on this Mac and works offline after installation.</p></header>
    {!models.some(item=>item.installed)&&<div className="grid justify-items-start gap-2 rounded-xl border border-dashed border-border p-4"><p className="text-sm font-medium">Start with a local voice</p><p className="text-xs text-muted-foreground">Download an English or Chinese speech model, then choose its voice here.</p><Button size="sm" onClick={onDiscover}>Find speech models in Discover</Button></div>}
    <label className="grid gap-2 text-sm font-medium">Reading model<span className={localModelsStyles.select}><select aria-label="Reading model" value={draft.mode==="auto"?"auto":draft.model_id} onChange={event=>{if(event.target.value!=="auto"){setEditing(event.target.value);setPreview("");}update(event.target.value==="auto"?{mode:"auto"}:{mode:"manual",model_id:event.target.value});}}><option value="auto">Automatic · English or Chinese</option>{models.map(item=>modelOption(item.id,item.name,item.installed))}</select></span></label>
    {draft.mode==="auto"&&<div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">{([['en','English',draft.english_model_id],['zh','Chinese',draft.chinese_model_id]] as const).map(([language,label,value])=><label key={language} className="grid gap-2 text-xs font-medium">{label}<span className={localModelsStyles.select}><select aria-label={`${label} reading model`} value={value} onChange={event=>update(language==="en"?{english_model_id:event.target.value}:{chinese_model_id:event.target.value})}><option value="">Choose an installed model automatically</option>{models.filter(item=>item.languages.includes(language)).map(item=>modelOption(item.id,item.name,item.installed))}</select></span></label>)}</div>}
    {model&&profile&&<div className="grid gap-4 rounded-xl border border-border p-4">
      {<label className="grid gap-2 text-xs font-medium">Voice options for<span className={localModelsStyles.select}><select aria-label="Voice options for" value={model.id} onChange={event=>{setEditing(event.target.value);setPreview("");}}>{models.map(item=>modelOption(item.id,item.name,item.installed))}</select></span></label>}
      <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="text-sm font-semibold">{model.name}</h5><span className="text-xs text-muted-foreground">{model.installed?"Installed locally":"Download required"}</span></div>
      <label className="grid gap-2 text-xs font-medium">Voice<span className={localModelsStyles.select}><select aria-label="Speech voice" value={profile.voice_id} onChange={event=>updateProfile({voice_id:event.target.value})}>{model.voices.map(voice=><option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></span></label>
      <label className="grid gap-2 text-xs font-medium"><span className="flex items-center justify-between">Reading speed<output>{profile.speed.toFixed(2)}×</output></span><input aria-label="Reading speed" type="range" min="0.5" max="2" step="0.05" value={profile.speed} onChange={event=>updateProfile({speed:Number(event.target.value)})} className="w-full accent-primary"/></label>
      {model.engine==="pocket"&&<p className="text-xs text-muted-foreground">Speed changes playback. Downloaded audio keeps its original pace.</p>}
      {(model.engine==="melo"||model.engine==="pocket")&&<details className="text-xs"><summary className="cursor-pointer font-medium">Model options</summary>{model.engine==="melo"?<label className="mt-3 grid gap-2">Voice variation · {profile.noise_scale.toFixed(2)}<input aria-label="Voice variation" type="range" min="0.1" max="1" step="0.05" value={profile.noise_scale} onChange={event=>updateProfile({noise_scale:Number(event.target.value)})}/><span className="text-muted-foreground">Lower values make delivery more consistent.</span></label>:<label className="mt-3 grid gap-2">Temperature · {profile.temperature.toFixed(2)}<input aria-label="Speech temperature" type="range" min="0.1" max="1" step="0.05" value={profile.temperature} onChange={event=>updateProfile({temperature:Number(event.target.value)})}/><span className="text-muted-foreground">Keep 0.30 for the default voice behavior.</span></label>}</details>}
      <label className="grid gap-2 text-xs font-medium">Try this voice<textarea aria-label="Voice preview text" rows={3} maxLength={400} value={sample} onChange={event=>setPreview(event.target.value)} className="w-full resize-y rounded-xl border border-input bg-muted/30 p-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"/></label>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!model.installed||!model.runtime_ready||!sample.trim()||!speech} onClick={()=>speech?.preview({text:sample,model_id:model.id,profile})}><Play className="size-3.5" aria-hidden="true"/>Preview voice</Button>{!model.installed&&<Button size="sm" onClick={onDiscover}>Find this model in Discover</Button>}</div>
      {speech?.playback?.kind==="preview"&&<div className="rounded-xl bg-muted/40 p-3"><SpeechPlaybackControls/></div>}
    </div>}
    <div className="grid gap-4">
      <label className="grid gap-2 text-xs font-medium"><span className="flex justify-between">Volume<output>{Math.round(draft.volume*100)}%</output></span><input aria-label="Speech volume" type="range" min="0" max="1" step="0.05" value={draft.volume} onChange={event=>update({volume:Number(event.target.value)})} className="w-full accent-primary"/></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.include_code} onChange={event=>update({include_code:event.target.checked})} className="mt-0.5 accent-primary"/><span>Include code in readings<span className="mt-1 block text-xs text-muted-foreground">Off by default. Markdown formatting, citation markers, and link addresses are skipped.</span></span></label>
      <label className="grid gap-2 text-xs font-medium">CPU usage<span className={localModelsStyles.select}><select aria-label="Speech CPU usage" value={draft.threads} onChange={event=>update({threads:Number(event.target.value)})}><option value={1}>Low · 1 thread</option><option value={2}>Balanced · 2 threads</option><option value={4}>Faster · 4 threads</option></select></span></label>
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">One reading plays at a time. Starting another reading stops the previous one. Audio is temporary unless you download it; removing a speech model keeps your saved answers.</p>
    {feedback&&<p role={feedback.error?"alert":"status"} className={feedback.error?"text-sm text-destructive":"text-sm text-primary"}>{feedback.text}</p>}
    <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4"><Button variant="ghost" size="sm" onClick={onDiscover}>Discover speech models</Button><Button size="sm" disabled={!dirty||saving} onClick={()=>void save()}><Save className="size-3.5" aria-hidden="true"/>{saving?"Saving…":"Save speech settings"}</Button></div>
  </section>;
}
