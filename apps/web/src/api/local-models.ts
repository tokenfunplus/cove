import { request } from "./client";
import type { AttachmentInput, LocalDocument, LocalModelStatus, LocalSearchResults, LocalSearchSelection, PreparedWebSource } from "@cove/api-contract";

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body), signal });
export const getLocalModels = (signal?: AbortSignal) => request<LocalModelStatus[]>("/api/local-models", {signal});
export const installLocalModel = (id: string) => request<void>(`/api/local-models/${encodeURIComponent(id)}/install`, {method:"POST"});
export const cancelLocalModel = (id: string) => request<void>(`/api/local-models/${encodeURIComponent(id)}/cancel`, {method:"POST"});
export const removeLocalModel = (id: string) => request<void>(`/api/local-models/${encodeURIComponent(id)}`, {method:"DELETE"});
export const getLocalDocuments = (signal?: AbortSignal) => request<LocalDocument[]>("/api/local-documents", {signal});
export const importLocalDocument = (input: AttachmentInput, signal?: AbortSignal) => request<void>("/api/local-documents", json(input,signal));
export const removeLocalDocument = (id: string, signal?: AbortSignal) => request<void>(`/api/local-documents/${encodeURIComponent(id)}`, {method:"DELETE",signal});
export const reindexLocalDocument = (id: string, signal?: AbortSignal) => request<void>(`/api/local-documents/${encodeURIComponent(id)}/index`, {method:"POST",signal});
export const searchLocalDocuments = (document_ids: string[], query: string, signal?: AbortSignal) => request<LocalSearchResults>("/api/local-documents/search",json({document_ids,query},signal));
export const prepareLocalSources = (selections: LocalSearchSelection[], signal?: AbortSignal) => request<PreparedWebSource[]>("/api/local-documents/prepare",json({selections},signal));

const projectScope = (id?: string) => id ? `?project_id=${encodeURIComponent(id)}` : "";
export const getProjectDocuments = (id: string, signal?: AbortSignal) => request<LocalDocument[]>("/api/local-documents"+projectScope(id), {signal});
export const searchProjectDocuments = (id: string, document_ids: string[], query: string, signal?: AbortSignal) => request<LocalSearchResults>("/api/local-documents/search"+projectScope(id),json({document_ids,query},signal));
export const prepareProjectSources = (id: string, selections: LocalSearchSelection[], signal?: AbortSignal) => request<PreparedWebSource[]>("/api/local-documents/prepare"+projectScope(id),json({selections},signal));
export const reindexProjectDocument = (project: string,id:string,signal?:AbortSignal)=> request<void>(`/api/local-documents/${encodeURIComponent(id)}/index`+projectScope(project),{method:"POST",signal});
