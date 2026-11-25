import type { CardRun, CardSubmission } from "@cove/api-contract";
import { request } from "./client";
export const loadInteractiveCard = (id: string) =>
  request<CardRun>(
    `/api/generations/${encodeURIComponent(id)}/interactive-card`,
    { method: "POST" },
  );
export const saveInteractiveCard = (input: CardSubmission) =>
  request<CardRun>(
    `/api/generations/${encodeURIComponent(input.generation_id)}/interactive-card`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
