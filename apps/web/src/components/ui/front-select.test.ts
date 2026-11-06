import { expect, test } from "vitest";
import {
  filterFrontSelectOptions,
  type FrontSelectOption,
} from "./front-select";

test("searchable FrontSelect options match model ids even when the label is a React node", () => {
  const options: FrontSelectOption[] = [
    {
      value: "openai/gpt-4.1-mini",
      keywords: "openai/gpt-4.1-mini",
      label: null,
    },
    {
      value: "moonshotai/kimi-k3",
      keywords: "moonshotai/kimi-k3",
      label: null,
    },
    {
      value: "Qwen/Qwen3.8-27B",
      keywords: "Qwen/Qwen3.8-27B",
      label: "Qwen/Qwen3.8-27B",
    },
  ];

  expect(
    filterFrontSelectOptions(options, "kimi").map((option) => option.value),
  ).toEqual(["moonshotai/kimi-k3"]);
  expect(
    filterFrontSelectOptions(options, "qwen").map((option) => option.value),
  ).toEqual(["Qwen/Qwen3.8-27B"]);
  expect(
    filterFrontSelectOptions(options, "gpt-4.1").map((option) => option.value),
  ).toEqual(["openai/gpt-4.1-mini"]);
});
