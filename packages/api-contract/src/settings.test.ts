import { expect, test } from "vitest";
import fixture from "../fixtures/settings.json";
import type { WorkspaceSettings } from "./index";

test("the workspace settings fixture remains compatible with the typed contract", () => {
  const settings = {
    ...fixture,
    theme: fixture.theme as WorkspaceSettings["theme"],
    locale: fixture.locale as WorkspaceSettings["locale"],
    active_model_set: []
  } satisfies WorkspaceSettings;

  expect(settings).toEqual({
    theme: "system",
    locale: "system",
    system_prompt: "",
    temperature: null,
    top_p: null,
    max_tokens: null,
    active_model_set: []
  });
});
