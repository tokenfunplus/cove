import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  providerCatalogQueryOptions,
  useProviders,
} from "@/api/hooks/useProviders";
import { labelStyle, selectStyle } from "./presentation";

export function useAppModelTarget(
  localRequired: boolean,
  allowVerified = false,
  cloudEnabled = false,
) {
  const profiles = useProviders();
  const [localOnly, setLocalOnly] = useState(true);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const policyLocal = localOnly || localRequired;
  const choices = (profiles.data ?? []).filter(
    (p) =>
      p.configured &&
      (!policyLocal || p.kind === "local") &&
      (p.kind === "local" || cloudEnabled || loopbackEndpoint(p.endpoint)) &&
      (p.kind !== "nearai" || allowVerified),
  );
  const profile = choices.find((p) => p.id === provider);
  const catalog = useQuery(providerCatalogQueryOptions(profile?.id ?? ""));
  return {
    profiles,
    catalog,
    policyLocal,
    profile,
    model,
    setModel,
    setLocalOnly,
    setProvider,
    choices,
    localRequired,
    cloudEnabled,
  };
}

export function AppModelTarget({
  target,
}: {
  target: ReturnType<typeof useAppModelTarget>;
}) {
  const {
    policyLocal,
    profile,
    model,
    setModel,
    setLocalOnly,
    setProvider,
    choices,
    localRequired,
    profiles,
    catalog,
  } = target;
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={policyLocal}
          disabled={localRequired}
          onChange={(e) => {
            setLocalOnly(e.target.checked);
            setProvider("");
            setModel("");
          }}
        />
        Only on this Mac
      </label>
      {!target.cloudEnabled && (
        <p className="text-sm text-muted-foreground">
          Cloud models are off for this app. Enable cloud access in its settings
          to use a remote destination.
        </p>
      )}
      <label className={labelStyle}>
        Model provider
        <select
          className={selectStyle}
          value={profile?.id ?? ""}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel("");
          }}
        >
          <option value="">Select a provider</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ·{" "}
              {p.kind === "local"
                ? "Cove-managed local model"
                : p.runtime_location}
            </option>
          ))}
        </select>
      </label>
      {profiles.isSuccess && choices.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Configure a compatible provider or install a local chat model in Cove
          settings.
        </p>
      )}
      {profile && (
        <label className={labelStyle}>
          Model
          <select
            className={selectStyle}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Select a model</option>
            {(catalog.data?.models ?? []).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

export function loopbackEndpoint(endpoint: string) {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === "localhost" || host === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(host) ||
      /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host);
  } catch {
    return false;
  }
}
