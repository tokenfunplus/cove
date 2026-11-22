import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Disclosure, DisclosureTrigger, DisclosureContent } from "@/components/ui/disclosure";
import { useEffect, useRef, useState } from "react";
import { Play, Save, Volume2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { SpeechConfiguration, SpeechProfile, SpeechSettings } from "@cove/api-contract";
import { useSpeechConfiguration } from "@/api/hooks/useSpeech";
import { saveSpeechSettings } from "@/api/speech";
import { speechKey } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import { useLocalSpeech, SpeechPlaybackControls } from "@/components/chat/LocalSpeech";
import { FrontSelect } from "@/components/ui/front-select";
import { Slider } from "@/components/ui/slider";

export function SpeechSettingsPanel({onDiscover,initialModelId}:{onDiscover:()=>void;initialModelId?:string}){
  const configuration=useSpeechConfiguration();const cache=useQueryClient();const speech=useLocalSpeech();
  const [draft,setDraft]=useState<SpeechSettings>();const speechRef=useRef(speech);speechRef.current=speech;
  const [editing,setEditing]=useState(initialModelId??"");const [preview,setPreview]=useState("");
  const [saving,setSaving]=useState(false);const [feedback,setFeedback]=useState<{error:boolean;text:string}>();
  const baseline=useRef<SpeechSettings | undefined>(undefined);const draftRef=useRef(draft);draftRef.current=draft;
  const dirty=Boolean(draft&&JSON.stringify(draft)!==JSON.stringify(baseline.current));const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  useEffect(()=>{if(configuration.data&&!dirtyRef.current){baseline.current=structuredClone(configuration.data.settings);setDraft(structuredClone(configuration.data.settings));}},[configuration.data]);
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
  async function save(){if(!draft)return;setSaving(true);setFeedback(undefined);speech?.stop();try{const submitted=structuredClone(draft);const result=await saveSpeechSettings(submitted);baseline.current=structuredClone(result.settings);const unchanged=JSON.stringify(draftRef.current)===JSON.stringify(submitted);cache.setQueryData<SpeechConfiguration>(speechKey,result);if(unchanged)setDraft(structuredClone(result.settings));setFeedback({error:false,text:unchanged?"Speech settings saved.":"Speech settings saved. Your newer changes are not saved yet."});}catch(error){setFeedback({error:true,text:error instanceof Error?error.message:"Speech settings could not be saved."});}finally{setSaving(false);}}
  const modelOption=(id:string,name:string,installed:boolean)=>({value:id,label:name+(installed?"":" · Not installed")});
  return <section aria-label="Local speech settings" className="grid gap-5">
    <header><h4 className="flex items-center gap-2 text-base font-semibold"><Volume2 className="size-4 text-primary" aria-hidden="true"/>Read aloud on this Mac</h4><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Use the sound button below an answer to listen. Speech stays on this Mac and works offline after installation.</p></header>
    {!models.some(item=>item.installed)&&<div className="grid justify-items-start gap-2 rounded-xl border border-dashed border-border p-4"><p className="text-sm font-medium">Start with a local voice</p><p className="text-xs text-muted-foreground">Download an English or Chinese speech model, then choose its voice here.</p><Button size="sm" onClick={onDiscover}>Find speech models in Discover</Button></div>}
    <FrontSelect label="Reading model" ariaLabel="Reading model" value={draft.mode==="auto"?"auto":draft.model_id} onValueChange={value=>{if(value!=="auto"){setEditing(value);setPreview("");}update(value==="auto"?{mode:"auto"}:{mode:"manual",model_id:value});}} options={[{value:"auto",label:"Automatic · English or Chinese"},...models.map(item=>modelOption(item.id,item.name,item.installed))]}/>
    {draft.mode==="auto"&&<div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">{([['en','English',draft.english_model_id],['zh','Chinese',draft.chinese_model_id]] as const).map(([language,label,value])=><FrontSelect key={language} label={label} ariaLabel={`${label} reading model`} value={value} onValueChange={value=>update(language==="en"?{english_model_id:value}:{chinese_model_id:value})} options={[{value:"",label:"Choose an installed model automatically"},...models.filter(item=>item.languages.includes(language)).map(item=>modelOption(item.id,item.name,item.installed))]}/>)}</div>}
    {model&&profile&&<div className="grid gap-4 rounded-xl border border-border p-4">
      <FrontSelect label="Voice options for" ariaLabel="Voice options for" value={model.id} onValueChange={value=>{setEditing(value);setPreview("");}} options={models.map(item=>modelOption(item.id,item.name,item.installed))}/>
      <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="text-sm font-semibold">{model.name}</h5><span className="text-xs text-muted-foreground">{model.installed?"Installed locally":"Download required"}</span></div>
      <FrontSelect label="Voice" ariaLabel="Speech voice" value={profile.voice_id} onValueChange={value=>updateProfile({voice_id:value})} options={model.voices.map(voice=>({value:voice.id,label:voice.name}))} searchable={model.voices.length>12} searchPlaceholder="Search voices" emptyText="No matching voices"/>
      <label className="grid gap-2 text-xs font-medium"><span className="flex items-center justify-between">Reading speed<output>{profile.speed.toFixed(2)}×</output></span><Slider aria-label="Reading speed" min={0.5} max={2} step={0.05} value={profile.speed} onValueChange={value=>updateProfile({speed:value})}/></label>
      {model.engine==="pocket"&&<p className="text-xs text-muted-foreground">Speed changes playback. Downloaded audio keeps its original pace.</p>}
      {(model.engine==="melo"||model.engine==="pocket")&&<Disclosure className="text-xs"><DisclosureTrigger className="cursor-pointer font-medium">Model options</DisclosureTrigger><DisclosureContent>{model.engine==="melo"?<label className="mt-3 grid gap-2">Voice variation · {profile.noise_scale.toFixed(2)}<Slider aria-label="Voice variation" min={0.1} max={1} step={0.05} value={profile.noise_scale} onValueChange={value=>updateProfile({noise_scale:value})}/><span className="text-muted-foreground">Lower values make delivery more consistent.</span></label>:<label className="mt-3 grid gap-2">Temperature · {profile.temperature.toFixed(2)}<Slider aria-label="Speech temperature" min={0.1} max={1} step={0.05} value={profile.temperature} onValueChange={value=>updateProfile({temperature:value})}/><span className="text-muted-foreground">Keep 0.30 for the default voice behavior.</span></label>}</DisclosureContent></Disclosure>}
      <label className="grid gap-2 text-xs font-medium">Try this voice<Textarea aria-label="Voice preview text" rows={3} maxLength={400} value={sample} onChange={event=>setPreview(event.target.value)} className="w-full resize-y rounded-xl border border-input bg-muted/30 p-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"/></label>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!model.installed||!model.runtime_ready||!sample.trim()||!speech} onClick={()=>speech?.preview({text:sample,model_id:model.id,profile})}><Play className="size-3.5" aria-hidden="true"/>Preview voice</Button>{!model.installed&&<Button size="sm" onClick={onDiscover}>Find this model in Discover</Button>}</div>
      {speech?.playback?.kind==="preview"&&<div className="rounded-xl bg-muted/40 p-3"><SpeechPlaybackControls/></div>}
    </div>}
    <div className="grid gap-4">
      <label className="grid gap-2 text-xs font-medium"><span className="flex justify-between">Volume<output>{Math.round(draft.volume*100)}%</output></span><Slider aria-label="Speech volume" min={0} max={1} step={0.05} value={draft.volume} onValueChange={value=>update({volume:value})}/></label>
      <label className="flex items-start gap-2 text-sm"><Checkbox  checked={draft.include_code} onCheckedChange={checked=>update({include_code:(checked === true)})} className="mt-0.5 "/><span>Include code in readings<span className="mt-1 block text-xs text-muted-foreground">Off by default. Markdown formatting, citation markers, and link addresses are skipped.</span></span></label>
      <FrontSelect label="CPU usage" ariaLabel="Speech CPU usage" value={String(draft.threads)} onValueChange={value=>update({threads:Number(value)})} options={[{value:"1",label:"Low · 1 thread"},{value:"2",label:"Balanced · 2 threads"},{value:"4",label:"Faster · 4 threads"}]}/>
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">One reading plays at a time. Starting another reading stops the previous one. Audio is temporary unless you download it; removing a speech model keeps your saved answers.</p>
    {feedback&&<p role={feedback.error?"alert":"status"} className={feedback.error?"text-sm text-destructive":"text-sm text-primary"}>{feedback.text}</p>}
    <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4"><Button variant="ghost" size="sm" onClick={onDiscover}>Discover speech models</Button><Button size="sm" disabled={!dirty||saving} onClick={()=>void save()}><Save className="size-3.5" aria-hidden="true"/>{saving?"Saving…":"Save speech settings"}</Button></div>
  </section>;
}
