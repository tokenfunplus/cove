import { useEffect, useId, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, CircleAlert, Eye, EyeOff, Globe, KeyRound, LoaderCircle, LockKeyhole, Search, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { Collapsible } from "radix-ui";
import type { WebSearchSettings, WebSearchPolicy } from "@cove/api-contract";
import { getWebSearchSettings, saveWebSearchSettings, deleteWebSearchKey, testWebSearchConnection } from "@/api/web-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FrontSelect } from "@/components/ui/front-select";
import { Input } from "@/components/ui/input";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { webSearchStyles as styles } from "@/styles/web-search";

const providers = [
  { id: "tavily", name: "Tavily", mark: "T" },
  { id: "linkup", name: "Linkup", mark: "L" },
  { id: "exa", name: "Exa", mark: "E" },
] as const;
const primaryLimits = [
  { field: "max_searches", label: "Search requests", hint: "Discover sources across the web.", min: 1, max: 20 },
  { field: "max_pages", label: "Page reads", hint: "Open sources for more detail.", min: 1, max: 20 },
] as const;
const advancedLimits = [
  { field: "max_results", label: "Results per search", hint: "Sources returned by each search request.", min: 1, max: 10 },
  { field: "max_rounds", label: "Total tool calls", hint: "Combined search and page-read calls per response.", min: 1, max: 32 },
  { field: "timeout_seconds", label: "Web phase timeout", hint: "Seconds available for web research.", min: 15, max: 180, step: 15 },
] as const;

function domains(text: string) {
  return text.split(/[,\n]+/).map(value => value.trim()).filter(Boolean);
}

export function WebSearchSettingsPanel({ onSaved }: { onSaved: (settings: WebSearchSettings) => void }) {
  const id = useId();
  const advancedTrigger = useRef<HTMLButtonElement>(null);
  const [settings, setSettings] = useState<WebSearchSettings>();
  const [policy, setPolicy] = useState<WebSearchPolicy>();
  const [includeDomains, setIncludeDomains] = useState("");
  const [excludeDomains, setExcludeDomains] = useState("");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "remove">();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  function load(value: WebSearchSettings) {
    setSettings(value);
    setPolicy(value.policy);
    setIncludeDomains((value.policy.include_domains ?? []).join(", "));
    setExcludeDomains((value.policy.exclude_domains ?? []).join(", "));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getWebSearchSettings()
      .then(value => { if (active) { load(value); setError(""); } })
      .catch(() => { if (active) setError("Web search settings could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const configured = settings?.providers.some(item => item.provider === policy?.provider && item.configured);
  const providerName = providers.find(item => item.id === policy?.provider)?.name ?? "your search provider";
  const currentPolicy = () => policy ? { ...policy, include_domains: domains(includeDomains), exclude_domains: domains(excludeDomains) } : undefined;

  async function save() {
    const next = currentPolicy();
    if (!next) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      const result = await saveWebSearchSettings(next, key);
      load(result); setKey(""); setShowKey(false); onSaved(result);
      setNotice("Web search settings saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Web search settings could not be saved.");
    } finally { setBusy(undefined); }
  }

  async function testConnection() {
    const next = currentPolicy();
    if (!next) return;
    setBusy("test"); setError(""); setNotice("");
    try { await testWebSearchConnection(next); setNotice("Search connection test passed."); }
    catch (error) { setError(error instanceof Error ? error.message : "Connection test failed."); }
    finally { setBusy(undefined); }
  }

  async function remove() {
    if (!policy || !settings) return;
    setBusy("remove"); setError(""); setNotice("");
    try {
      await deleteWebSearchKey(policy.provider);
      const removed = { ...settings, providers: settings.providers.map(item => item.provider === policy.provider ? { ...item, configured: false } : item) };
      setSettings(removed); setKey(""); setShowKey(false); onSaved(removed);
      setNotice("Search API key removed. Configure a key before the next search.");
      try {
        const result = await getWebSearchSettings();
        setSettings(result); onSaved(result);
      } catch {
        setError("The search API key was removed, but settings could not be refreshed. Reopen Settings to try again.");
      }
    } catch { setError("The search API key could not be removed."); }
    finally { setBusy(undefined); }
  }

  const feedback = error ? <p role="alert" className={cn(styles.feedback, "border-destructive/20 bg-destructive-muted text-destructive")}><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p> : notice ? <p role="status" className={cn(styles.feedback, "border-success/20 bg-accent text-success")}><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{notice}</p> : null;

  return (
    <section className={styles.panel} aria-label="Web search settings" aria-busy={loading}>
      <div className={styles.heading}>
        <span className={styles.headingIcon}><Globe size={20} aria-hidden="true" /></span>
        <div><h2 className={styles.title}>Web search</h2><p className={styles.description}>Let models find current information and cite their sources.</p></div>
      </div>
      {!policy && feedback}
      {!policy ? loading ? <div role="status" className="flex items-center gap-2 py-8 text-xs text-muted-foreground"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />Loading search settings…</div> : <Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>Reload Web search settings</Button> : (
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-4">
            <section className={styles.card} aria-labelledby={`${id}-connection`}>
              <div className={styles.cardHeader}>
                <div><h3 id={`${id}-connection`} className={styles.cardTitle}><KeyRound size={14} className="text-muted-foreground" aria-hidden="true" />Connection</h3></div>
                <Badge variant={configured ? "secondary" : "outline"} className={cn("mt-0.5 gap-1.5 rounded-full", configured && "text-success")}><span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-muted-foreground/50")} />{configured ? "Connected" : "Not connected"}</Badge>
              </div>
              <div className={styles.cardBody}>
                <FrontSelect
                  id={`${id}-provider`}
                  label="Default search provider"
                  ariaLabel="Default search provider"
                  value={policy.provider}
                  disabled={Boolean(busy)}
                  className={styles.providerSelect}
                  onValueChange={value => {
                    setPolicy({ ...policy, provider: value as WebSearchPolicy["provider"] });
                    setKey(""); setShowKey(false); setNotice(""); setError("");
                  }}
                  options={providers.map(item => ({
                    value: item.id,
                    selectedLabel: <span className={styles.providerOption}><span aria-hidden="true" className={styles.providerMark}>{item.mark}</span>{item.name}</span>,
                    label: <span className={styles.providerOption}><span aria-hidden="true" className={styles.providerMark}>{item.mark}</span><span>{item.name}</span>{settings?.providers.find(status => status.provider === item.id)?.configured && <span className="ml-3 flex items-center gap-1 text-[10px] text-success"><Check size={12} aria-hidden="true" />Connected</span>}</span>,
                  }))}
                />
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${id}-key`}>{configured ? "Replace search API key" : "Search API key"}</label>
                  <div className={styles.credential}>
                    <KeyRound className={styles.credentialIcon} aria-hidden="true" />
                    <Input id={`${id}-key`} type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder={configured ? "Leave blank to keep the saved key" : `Enter your ${providerName} API key`} aria-describedby={`${id}-key-hint`} />
                    <Tooltip content={showKey ? "Hide API key" : "Show API key"}><Button type="button" variant="ghost" size="icon-sm" className={styles.credentialToggle} aria-label={showKey ? "Hide API key" : "Show API key"} aria-pressed={showKey} disabled={!key || Boolean(busy)} onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />}</Button></Tooltip>
                  </div>
                  <div className={styles.credentialActions}>
                    <p id={`${id}-key-hint`} className={styles.keyStatus}><LockKeyhole size={12} aria-hidden="true" />{configured ? "Key saved in macOS Keychain" : "Stored in macOS Keychain"}</p>
                    {configured && <div className="flex items-center gap-1"><Button type="button" size="xs" variant="ghost" disabled={Boolean(key)} onClick={() => void testConnection()}>{busy === "test" ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={12} aria-hidden="true" />}Test connection</Button><Tooltip content="Remove search key"><Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:bg-destructive-muted hover:text-destructive" aria-label="Remove search key" onClick={() => void remove()}>{busy === "remove" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}</Button></Tooltip></div>}
                  </div>
                  <p className={styles.hint}>Testing uses one search. Failed validation keeps your saved key.</p>
                </div>
              </div>
          <p className={styles.privacy}><LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>Queries go to {providerName}, page reads contact source sites, and retrieved text goes to your model. Search runs outside NearAI encrypted inference.</span></p>
            </section>

            <section className={styles.card} aria-labelledby={`${id}-limits`}>
              <div className={styles.cardHeader}><div><h3 id={`${id}-limits`} className={styles.cardTitle}><Search size={14} className="text-muted-foreground" aria-hidden="true" />Usage limits</h3><p className={styles.description}>Maximum requests for each model response.</p></div><Badge variant="outline" className="rounded-full">Per model</Badge></div>
              <div className={styles.rows}>{primaryLimits.map(limit => <div key={limit.field} className={styles.row}>
                <div className={styles.rowCopy}><label htmlFor={`${id}-${limit.field}`} className={styles.rowLabel}>{limit.label}</label><p id={`${id}-${limit.field}-hint`} className={styles.rowHint}>{limit.hint}</p></div>
                <NumberStepper id={`${id}-${limit.field}`} label={limit.label} describedBy={`${id}-${limit.field}-hint`} value={policy[limit.field]} min={limit.min} max={limit.max} disabled={Boolean(busy)} onValueChange={value => setPolicy(current => current ? { ...current, [limit.field]: value } : current)} />
              </div>)}</div>
              <p className={styles.budgetNote}><Globe className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>Four models can use up to <strong className="font-medium text-foreground">{policy.max_searches * 4} searches</strong> with these limits. Failed requests count; cache hits do not.</span></p>
            </section>

            <Collapsible.Root className={styles.card} onOpenChange={open => {
              if (open) requestAnimationFrame(() => {
                const trigger = advancedTrigger.current;
                const scroller = trigger?.closest<HTMLElement>("[data-active-settings-section]");
                if (trigger && scroller) scroller.scrollTop += trigger.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
              });
            }}>
              <Collapsible.Trigger asChild><Button ref={advancedTrigger} aria-label="Advanced settings" type="button" variant="ghost" className={styles.advancedTrigger}><span className="flex items-center gap-2"><SlidersHorizontal size={14} className="text-muted-foreground" aria-hidden="true" /><span className="flex items-center gap-3"><span className="text-[13px] font-semibold">Advanced settings</span><span className="hidden text-[11px] text-muted-foreground sm:inline">Depth, timeouts &amp; filters</span></span></span><ChevronDown size={15} aria-hidden="true" className="advanced-chevron shrink-0 text-muted-foreground transition-transform" /></Button></Collapsible.Trigger>
              <Collapsible.Content className={styles.advancedBody}>
                <FrontSelect id={`${id}-depth`} label="Search depth" ariaLabel="Search depth" value={policy.depth} disabled={Boolean(busy)} className={styles.providerSelect} onValueChange={value => setPolicy({ ...policy, depth: value as WebSearchPolicy["depth"] })} options={[
                  { value: "standard", selectedLabel: "Standard", label: <span><span className="block text-xs font-medium">Standard</span><span className="block text-[11px] text-muted-foreground">Everyday searches</span></span> },
                  { value: "deep", selectedLabel: "Deep", label: <span><span className="block text-xs font-medium">Deep</span><span className="block text-[11px] text-muted-foreground">Broader research; may use more credits</span></span> },
                ]} />
                <div className={styles.advancedRows}>{advancedLimits.map(limit => <div key={limit.field} className={styles.row}><div className={styles.rowCopy}><label htmlFor={`${id}-${limit.field}`} className={styles.rowLabel}>{limit.label}</label><p id={`${id}-${limit.field}-hint`} className={styles.rowHint}>{limit.hint}</p></div><NumberStepper id={`${id}-${limit.field}`} label={limit.label} describedBy={`${id}-${limit.field}-hint`} value={policy[limit.field]} min={limit.min} max={limit.max} step={"step" in limit ? limit.step : 1} disabled={Boolean(busy)} onValueChange={value => setPolicy(current => current ? { ...current, [limit.field]: value } : current)} /></div>)}</div>
                <div className={styles.filters}>
                  <div className={styles.field}><label className={styles.label} htmlFor={`${id}-include`}>Include domains</label><Input id={`${id}-include`} className="h-10 rounded-xl bg-popover text-xs" value={includeDomains} onChange={event => setIncludeDomains(event.target.value)} placeholder="example.com, docs.example.com" aria-describedby={`${id}-domains-hint`} /></div>
                  <div className={styles.field}><label className={styles.label} htmlFor={`${id}-exclude`}>Exclude domains</label><Input id={`${id}-exclude`} className="h-10 rounded-xl bg-popover text-xs" value={excludeDomains} onChange={event => setExcludeDomains(event.target.value)} placeholder="example.com" aria-describedby={`${id}-domains-hint`} /></div>
                </div>
                <p id={`${id}-domains-hint`} className={styles.hint}>Separate domains with commas. Filters apply to search results. Request limits count API requests; provider credits and pricing vary by service and depth.</p>
              </Collapsible.Content>
            </Collapsible.Root>
          </fieldset>

          <div className={styles.footer}>{feedback}<div className="flex flex-wrap items-center justify-between gap-3"><p className={styles.hint}>Enable the globe in a conversation to start searching.</p><Button type="submit" size="sm" className="max-sm:w-full" disabled={Boolean(busy)}>{busy === "save" && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}{busy === "save" ? "Saving…" : key ? "Test and save" : "Save settings"}</Button></div></div>
        </form>
      )}
    </section>
  );
}
