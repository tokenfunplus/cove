import type { DebateSpeechInput, SpeechConfiguration, SpeechJob, SpeechPreview, SpeechSettings } from "@cove/api-contract";
import { fetchLocalService, LocalServiceError, request } from "./client";

const json = (value: unknown, method = "POST"): RequestInit => ({method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(value)});
export const getSpeechConfiguration = (signal?: AbortSignal) => request<SpeechConfiguration>("/api/speech/settings",{signal});
export const saveSpeechSettings = (settings: SpeechSettings) => request<SpeechConfiguration>("/api/speech/settings",json(settings,"PUT"));
export const readAnswer = (conversation_id: string,message_id: string,selection?: string) => request<SpeechJob>("/api/speech",json({conversation_id,message_id,...(selection?{selection}:{})}));
export const readDebateTurn = (input: DebateSpeechInput) => request<SpeechJob>("/api/speech/debate",json(input));
export const previewSpeech = (input: SpeechPreview) => request<SpeechJob>("/api/speech/preview",json(input));
export const getSpeechJob = (id: string,signal?: AbortSignal) => request<SpeechJob>(`/api/speech/${encodeURIComponent(id)}`,{signal});
export const stopSpeech = (id: string) => request<void>(`/api/speech/${encodeURIComponent(id)}`,{method:"DELETE",keepalive:true});
export async function speechAudio(id: string,index?: number,signal?: AbortSignal) {
  const path = `/api/speech/${encodeURIComponent(id)}/${index===undefined?"audio":`chunks/${index}`}`;
  const response = await fetchLocalService(path,{signal});
  if(!response.ok)throw new LocalServiceError(await response.json());
  return response.blob();
}
