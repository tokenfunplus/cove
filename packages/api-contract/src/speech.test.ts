import { expect, test } from "vitest";
import fixture from "../fixtures/speech-settings.json";
import schema from "../schemas/speech-settings.schema.json";
import type { SpeechSettings } from "./index";

test("speech settings retain language defaults separately from per-model voice preferences",()=>{
 const settings:SpeechSettings={...fixture,mode:fixture.mode as SpeechSettings["mode"]} satisfies SpeechSettings;
 expect(settings.english_model_id).toBe("kitten-nano-en");
 expect(settings.chinese_model_id).toBe("kokoro-zh");
 expect(settings.profiles[settings.english_model_id].speed).toBe(1);
 expect(schema.required.sort()).toEqual(Object.keys(settings).sort());
 expect(schema.properties.profiles.additionalProperties.properties.speed.maximum).toBe(2);
});
