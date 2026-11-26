import { curatedLocalModels } from "./local-model-catalog-data";
import type { LocalModel, LocalModelAvailability, LocalModelLanguage, LocalModelPurpose } from "./local-model-types";

export type { LocalModel, LocalModelAvailability, LocalModelLanguage, LocalModelPurpose } from "./local-model-types";

export const localModelCatalogReviewed = "2026-11-26";
export const localModelCatalogMaxWeightMB = 1500;
export const localModelCatalog: LocalModel[] = curatedLocalModels;
export const localModelPurposes: LocalModelPurpose[] = ["search", "rerank", "write", "code", "translate", "ocr", "voice", "speak", "audio", "vision", "classify"];

export function filterLocalModels(filters: {
  query: string;
  purpose: LocalModelPurpose | "all";
  language: LocalModelLanguage | "all";
  maxWeightMB: number;
  availability?: LocalModelAvailability | "all";
}) {
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return localModelCatalog.filter(model => {
    const text = [model.name, model.publisher, model.purpose, model.benefit, model.example, model.limitation, model.setup, model.languageLabel, model.role, model.format, model.runtime, model.license, ...model.files].join(" ").toLowerCase();
    return (filters.purpose === "all" || model.purpose === filters.purpose)
      && (filters.language === "all" || model.languages.includes(filters.language))
      && (!filters.availability || filters.availability === "all" || model.availability === filters.availability)
      && model.weightMB <= filters.maxWeightMB
      && terms.every(term => text.includes(term));
  });
}
