import { type WorkspaceSettings } from "@cove/api-contract";

export const defaultWorkspaceSettings: WorkspaceSettings = {
  theme: "system",
  locale: "en",
  system_prompt: "",
  temperature: null,
  top_p: null,
  max_tokens: null,
  active_model_set: [],
};

export function isSystemPromptWithinLimit(value: string): boolean {
  return Array.from(value).length <= 8192;
}

type ModelParameterFormValues = {
  temperature: string;
  topP: string;
  maxTokens: string;
};

export function modelParameterFormValue(value: number | null): string {
  return value === null ? "" : String(value);
}

export function parseModelParameters(
  values: ModelParameterFormValues,
): Pick<WorkspaceSettings, "temperature" | "top_p" | "max_tokens"> | undefined {
  const temperature = parseOptionalDecimal(values.temperature, 0, 2);
  const topP = parseOptionalDecimal(values.topP, 0, 1);
  const maxTokens = parseOptionalInteger(values.maxTokens, 1);
  if (
    temperature === undefined ||
    topP === undefined ||
    maxTokens === undefined
  )
    return undefined;
  return { temperature, top_p: topP, max_tokens: maxTokens };
}

function parseOptionalDecimal(
  value: string,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function parseOptionalInteger(
  value: string,
  minimum: number,
): number | null | undefined {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : undefined;
}
