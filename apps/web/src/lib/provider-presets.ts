import bundledPresets from "../../../../services/local-service/internal/provider/presets.json";
import type { ProviderAuthMethod, ProviderProfile } from "@cove/api-contract";

type ProviderPreset = { id: string; name: string; endpoint: string; auth_method: ProviderAuthMethod; models: string[] };
export const providerPresets: ProviderPreset[] = bundledPresets as ProviderPreset[];

export function providerPresetId(profile?: Pick<ProviderProfile, "kind" | "endpoint">): string {
  if (profile?.kind === "nearai") return "nearai";
  const endpoint = profile?.endpoint.replace(/\/+$/, "").replace(/\/v1$/, "");
  return providerPresets.find(preset => preset.endpoint.replace(/\/v1$/, "") === endpoint)?.id ?? "openai_compatible";
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
