import bundledPresets from "../../../../services/local-service/internal/provider/presets.json";
import type { ProviderAuthMethod, ProviderProfile } from "@cove/api-contract";

type ProviderPreset = { id: string; name: string; endpoint: string; auth_method: ProviderAuthMethod; models: string[] };
export const providerPresets: ProviderPreset[] = bundledPresets as ProviderPreset[];

export function providerPresetId(profile?: Pick<ProviderProfile, "kind" | "endpoint">): string {
  if (profile?.kind === "nearai") return "nearai";
  const endpoint = normalizedPresetEndpoint(profile?.endpoint ?? "");
  return providerPresets.find(preset => normalizedPresetEndpoint(preset.endpoint) === endpoint)?.id ?? "openai_compatible";
}

function normalizedPresetEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "";
    return url.origin + url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  } catch {
    return "";
  }
}

export function allowsNoAuthentication(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    return ["http:", "https:"].includes(url.protocol) && (host === "localhost" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host));
  } catch {
    return false;
  }
}
