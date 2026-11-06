import { request } from "@/api/client";
import {
  type ProviderProfile,
  type ProviderProfileInput,
  type ProviderValidationResponse,
} from "@cove/api-contract";

export function getProviderProfiles(): Promise<ProviderProfile[]> {
  return request<ProviderProfile[]>("/api/models");
}

export function getProviderCatalog(
  id: string,
): Promise<ProviderValidationResponse> {
  return request<ProviderValidationResponse>(
    `/api/models/${encodeURIComponent(id)}/catalog`,
  );
}

export function saveProviderProfile(
  input: ProviderProfileInput,
): Promise<ProviderProfile> {
  const path = input.id
    ? `/api/models/${encodeURIComponent(input.id)}`
    : "/api/models";
  return request<ProviderProfile>(path, {
    method: input.id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function testProviderConnection(
  input: ProviderProfileInput,
): Promise<ProviderValidationResponse> {
  return request<ProviderValidationResponse>("/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteProviderProfile(id: string): Promise<void> {
  return request<void>(`/api/models/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function deleteProviderKey(id: string): Promise<void> {
  return request<void>(`/api/models/${encodeURIComponent(id)}/key`, {
    method: "DELETE",
  });
}
