import { Disclosure, DisclosureTrigger, DisclosureContent } from "@/components/ui/disclosure";
import { useState } from "react";
import { ArrowUpRight, AudioLines, Code2, FileSearch, Image as ImageIcon, Languages, ListFilter, ScanText, Sparkles, Tags, Volume2, Waves } from "lucide-react";
import type { LocalModel } from "@/lib/local-model-catalog";
import { localModelsCopy as copy } from "@/messages/local-models";
import { localModelsStyles as styles } from "@/styles/local-models";
import { LocalModelControl } from "./LocalModelControl";

const purposeIcons = { search: FileSearch, rerank: ListFilter, voice: AudioLines, speak: Volume2, write: Sparkles, code: Code2, translate: Languages, ocr: ScanText, vision: ImageIcon, classify: Tags, audio: Waves };

export function LocalModelDiscoveryCard({ model, manage, onUseChat, onUseSearch, onUseSpeech }: {
  model: LocalModel;
  manage: boolean;
  onUseChat?: (modelId: string) => Promise<boolean | undefined>;
  onUseSearch?: () => void;
  onUseSpeech?: (modelId:string)=>void;
}) {
  const [useError, setUseError] = useState("");
  const [using, setUsing] = useState(false);
  const Icon = purposeIcons[model.purpose];
  const ready = model.availability === "ready";
  const size = model.weightMB < 1 ? Math.round(model.weightMB * 1000) + " KB" : model.weightMB + " MB";

  async function useChat() {
    setUsing(true);
    setUseError("");
    try {
      if (!await onUseChat?.(model.id)) setUseError("The local chat catalog is not ready yet. Try again after it loads.");
    } catch {
      setUseError("The local chat model could not be selected. Try again.");
    } finally {
      setUsing(false);
    }
  }

  return <article className={ready ? styles.card : styles.exploreCard} aria-labelledby={`local-model-${model.id}`}>
    {ready ? <header>
    <div className={styles.cardTop}>
      <span className={ready ? styles.icon : styles.exploreIcon}><Icon className="size-4" aria-hidden="true" /></span>
      <span className={styles.badge}>{model.role}</span>
      <span className={styles.weight}>~{size}</span>
    </div>
    <h5 id={`local-model-${model.id}`} className={styles.benefit}>{model.benefit}</h5>
    <p className={styles.model}>{model.name}</p>
    </header> : <header className={styles.exploreHeader}>
      <span className={styles.exploreIcon}><Icon className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><h5 id={`local-model-${model.id}`} className="text-sm font-semibold leading-relaxed">{model.benefit}</h5><p className={styles.model}>{model.name}</p></div>
      <span className={styles.weight}>~{size}</span>
    </header>}
    <div className={ready ? "flex flex-1 flex-col" : "min-w-0 pl-11"}>
    <p className={styles.example}>{model.example}</p>
    <div className={styles.metadata}><span>{model.languageLabel}</span><span>{ready ? model.format : copy.availabilities.explore}</span></div>
    {ready && <p className={styles.limitation}>{model.limitation}</p>}
    {useError && <p role="alert" className="mt-3 text-sm text-destructive">{useError}</p>}
    {manage && ready && <div className="mt-auto"><LocalModelControl id={model.id} compact onUse={model.purpose==="speak"?()=>onUseSpeech?.(model.id):model.id === "bge-small-zh" ? onUseSearch : onUseChat ? () => void useChat() : undefined} useLabel={model.purpose==="speak"?"Speech settings":model.id === "bge-small-zh" ? "Open document search" : "Use in this chat"} useDisabled={using} /></div>}
    <Disclosure className={styles.details}>
      <DisclosureTrigger>{copy.details}</DisclosureTrigger><DisclosureContent>
      {!ready && <p className="mt-3"><strong className="font-medium text-foreground">{copy.limitation}: </strong>{model.limitation}</p>}
      <dl>
        <dt>Publisher</dt><dd>{model.publisher}</dd>
        <dt>Format</dt><dd>{model.format}</dd>
        <dt>{copy.source}</dt><dd>{model.source}</dd>
        <dt>{copy.license}</dt><dd><a href={model.licenseUrl} target="_blank" rel="noopener noreferrer">{model.license}<span className="sr-only"> license for {model.name} (external website)</span></a></dd>
        <dt>{copy.runtime}</dt><dd>{model.runtime}</dd>
        {model.revision && <><dt>{copy.revision}</dt><dd className="break-all font-mono text-xs">{model.revision}</dd></>}
      </dl>
      <ul className="my-3 grid gap-1">{model.files.map(file => <li key={file}><code>{file}</code></li>)}</ul>
      <p>{model.setup}</p>
      <div className={styles.actions}>
        <a href={model.filesUrl} target="_blank" rel="noopener noreferrer">{copy.files}<ArrowUpRight className="size-3.5" aria-hidden="true" /><span className="sr-only"> for {model.name} (external website)</span></a>
        <a href={model.modelUrl} target="_blank" rel="noopener noreferrer">{copy.model}<ArrowUpRight className="size-3.5" aria-hidden="true" /><span className="sr-only">: {model.name} (external website)</span></a>
      </div>
    </DisclosureContent></Disclosure>
    </div>
  </article>;
}
