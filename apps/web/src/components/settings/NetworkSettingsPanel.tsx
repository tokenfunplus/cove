import { useEffect, useId, useState } from "react";
import type { DownloadNetworkSettings, DownloadNetworkTest, DownloadNetworkView } from "@cove/api-contract";
import { getDownloadNetwork, saveDownloadNetwork, testDownloadNetwork } from "@/api/download-network";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FrontSelect } from "@/components/ui/front-select";
import { LoaderCircle, Network } from "lucide-react";

const defaults: DownloadNetworkSettings = { mode: "system", proxy_url: "" };
const modes = [
  { value: "system", label: "System proxy (default)" },
  { value: "manual", label: "Manual proxy" },
  { value: "direct", label: "Direct connection" },
];

export function NetworkSettingsPanel() {
  const id = useId();
  const [view, setView] = useState<DownloadNetworkView>();
  const [mode, setMode] = useState<DownloadNetworkSettings["mode"]>("system");
  const [proxy, setProxy] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"test" | "save">();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<DownloadNetworkTest>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void getDownloadNetwork().then(value => {
      if (!active) return;
      setView(value); setMode(value.configuration.mode); setProxy(value.configuration.proxy_url); setError("");
    }).catch(() => {
      if (active) setError("Download network settings could not be loaded. Retry, or save a new configuration to recover.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const draft = (): DownloadNetworkSettings => ({ mode, proxy_url: mode === "manual" ? proxy.trim() : "" });
  const clearFeedback = () => { setError(""); setNotice(""); setResult(undefined); };
  const changed = JSON.stringify(draft()) !== JSON.stringify(view?.configuration ?? defaults);
  async function run(kind: "test" | "save") {
    clearFeedback(); setBusy(kind);
    try {
      if (kind === "test") setResult(await testDownloadNetwork(draft()));
      else {
        const saved = await saveDownloadNetwork(draft());
        setView(saved); setMode(saved.configuration.mode);
        if (saved.configuration.mode === "manual") setProxy(saved.configuration.proxy_url);
        setNotice("Saved. Retry the download to use these settings. Downloads already in progress keep their current connection.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The network operation failed. Try again.");
    } finally { setBusy(undefined); }
  }
  return <section className="grid max-w-2xl gap-5" aria-labelledby={`${id}-title`}>
    <header><h2 id={`${id}-title`} className="flex items-center gap-2 text-xl font-semibold"><Network size={20} aria-hidden="true" />Network</h2>
      <p className="mt-2 text-sm text-muted-foreground">Choose how Cove downloads local chat, document search, and speech models.</p></header>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading network settings…</p> : <form className="grid gap-5" onSubmit={event => { event.preventDefault(); void run("save"); }}>
      <fieldset disabled={Boolean(busy)} className="grid gap-4 rounded-xl border border-border p-4">
        <FrontSelect id={`${id}-mode`} label="Download connection" value={mode} options={modes} disabled={Boolean(busy)} onValueChange={value => { setMode(value as DownloadNetworkSettings["mode"]); clearFeedback(); }} />
        {mode === "system" && <p className="text-sm text-muted-foreground">{view?.system_proxy_supported === false ? "Uses proxy environment variables when available. macOS system proxy support is unavailable in this build." : "Follows macOS system proxy settings, including automatic proxy configuration and bypass rules. If no system proxy is configured, uses proxy environment variables when available."}</p>}
        {mode === "direct" && <p className="text-sm text-muted-foreground">Connects directly to model sources without a proxy.</p>}
        {mode === "manual" && <div className="grid gap-2">
          <label htmlFor={`${id}-proxy`} className="text-sm font-medium">Proxy address</label>
          <Input id={`${id}-proxy`} value={proxy} onChange={event => { setProxy(event.target.value); clearFeedback(); }} placeholder="http://127.0.0.1:7890" autoComplete="off" spellCheck={false} required aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">Use HTTP, HTTPS, or SOCKS5 with a host and port. For a local proxy app, copy its proxy address here and keep that app running. Proxies requiring a username or password are not supported.</p>
        </div>}
      </fieldset>
      <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Applies to model downloads only. Cove's local service and inference workers always connect directly. Provider connections, web search, and app updates keep their existing network settings.</div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void run("test")}>{busy === "test" && <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />}{busy === "test" ? "Testing…" : "Test connection"}</Button>
        <Button type="submit" disabled={Boolean(busy) || (Boolean(view) && !changed)}>{busy === "save" ? "Saving…" : "Save settings"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Test connection checks Hugging Face and GitHub using the values above. It does not save settings or install a model.</p>
    </form>}
    {result && <div role="status" className="grid gap-2 rounded-xl border border-border p-4 text-sm"><p className="font-medium">{result.ok ? "Download sources are reachable." : "Some download sources could not be reached."}</p><ul className="grid gap-2">{result.checks.map(check => <li key={check.source}><span className={check.ok ? "text-primary" : "text-destructive"}>{check.ok ? "✓" : "!"} {check.source}</span><p className="mt-1 text-muted-foreground">{check.message}</p></li>)}</ul></div>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {error && <div className="grid gap-2"><p role="alert" className="text-sm text-destructive">{error}</p>{!view && !loading && <Button className="justify-self-start" variant="outline" disabled={Boolean(busy)} onClick={() => setReload(value => value + 1)}>Reload settings</Button>}</div>}
  </section>;
}
