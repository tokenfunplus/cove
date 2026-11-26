import speechRegistry from "../../../../services/local-service/internal/speech/models.json";
import { expect, test } from "vitest";
import { filterLocalModels, localModelCatalog, localModelCatalogMaxWeightMB, localModelPurposes } from "./local-model-catalog";

test("the catalog covers each advertised task and reserves Cove installation for integrated models", () => {
  expect(new Set(localModelCatalog.map(model => model.id)).size).toBe(localModelCatalog.length);
  for (const purpose of localModelPurposes) {
    expect(filterLocalModels({query:"",purpose,language:"all",maxWeightMB:500}).length).toBeGreaterThan(0);
  }
  expect(localModelCatalog.filter(model => model.availability === "ready").map(model => model.id).sort()).toEqual(["bge-small-zh", "gemma3-1b-chat", "kitten-nano-en", "kokoro-en", "kokoro-zh", "melo-zh-en", "pocket-tts-en", "qwen-small-chat", "qwen25-1-5b-chat", "qwen25-coder-1-5b-chat", "qwen3-abliterated-chat"]);
  expect(filterLocalModels({query:"",purpose:"all",language:"all",maxWeightMB:localModelCatalogMaxWeightMB})).toHaveLength(localModelCatalog.length);
});

test("source entries expose bounded file selections, HTTPS provenance, and pinned revisions where supplied", () => {
  for (const model of localModelCatalog) {
    expect(model.files.length).toBeGreaterThan(0);
    expect(model.weightMB).toBeGreaterThan(0);
    expect(model.weightMB).toBeLessThanOrEqual(localModelCatalogMaxWeightMB);
    expect(model.license).not.toBe("");
    for (const url of [model.filesUrl, model.modelUrl, model.licenseUrl]) expect(new URL(url).protocol).toBe("https:");
    if (model.revision) {
      expect(model.revision).toMatch(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
      if(model.revision.length===40)expect(model.filesUrl).toContain(model.revision);
    }
  }
});


test("every speech download matches the native installation manifest",()=>{
 const speech=localModelCatalog.filter(model=>model.purpose==="speak");
 expect(speech.map(model=>model.id).sort()).toEqual(speechRegistry.map(model=>model.id).sort());
 for(const model of speech){const native=speechRegistry.find(item=>item.id===model.id)!;expect(model.availability).toBe("ready");expect(model.weightMB).toBe(Math.round(native.bytes/100000)/10);expect(model.files).toEqual(native.required);}
});
