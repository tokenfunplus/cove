export type LocalModelPurpose = "search" | "rerank" | "voice" | "speak" | "write" | "code" | "translate" | "ocr" | "vision" | "classify" | "audio";
export type LocalModelLanguage = "en" | "zh" | "multilingual" | "independent";
export type LocalModelAvailability = "ready" | "explore";

export type LocalModel = {
  id: string;
  name: string;
  publisher: string;
  purpose: LocalModelPurpose;
  role: "Tool" | "Chat model";
  availability: LocalModelAvailability;
  benefit: string;
  example: string;
  limitation: string;
  languages: LocalModelLanguage[];
  languageLabel: string;
  weightMB: number;
  format: string;
  runtime: string;
  license: string;
  licenseUrl: string;
  files: string[];
  setup: string;
  modelUrl: string;
  filesUrl: string;
  source: "Publisher" | "Community conversion";
  revision?: string;
};
