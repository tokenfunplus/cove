import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ModelOptionLabel, modelSearchText } from "./ModelOptionLabel";
import { ModelBrandIcon, modelBrand } from "./ModelBrandIcon";
import { englishConversationCopy as copy } from "@/messages";
import type { ProviderModelMetadata } from "@cove/api-contract";

const metadata: ProviderModelMetadata = {
  id: "deepseek/fixture",
  name: "DeepSeek Fixture",
  owner: "deepseek",
  privacy_mode: "incognito",
  verifiable: false,
  context_length: 1048576,
  max_output_tokens: 65536,
  input_price_per_million: 0,
  output_price_per_million: 1.2,
  capabilities: ["text_input", "image_input", "tools", "reasoning"],
};

test("model rows expose reported information and preserve free and missing prices", () => {
  const row = renderToStaticMarkup(
    <ModelOptionLabel
      modelId={metadata.id}
      metadata={metadata}
      copy={copy}
      showPrivacyMode
    />,
  );
  for (const label of [
    "DeepSeek Fixture",
    "deepseek/fixture",
    "1,048,576 context",
    "65,536 max output",
    "In $0 / Out $1.2 per 1M tokens",
    "Image input",
    "Tools",
    "Reasoning",
    "Incognito",
  ])
    expect(row).toContain(label);
  expect(row).toContain("/assets/model-icons/deepseek-color.svg");
  const missing = renderToStaticMarkup(
    <ModelOptionLabel modelId="unknown" copy={copy} />,
  );
  expect(missing).toContain("Details not supplied by Provider");
  expect(missing).not.toContain("$0");
  const partial = renderToStaticMarkup(
    <ModelOptionLabel
      modelId={metadata.id}
      metadata={{ ...metadata, input_price_per_million: undefined }}
      copy={copy}
    />,
  );
  expect(partial).toContain("In — / Out $1.2");
});

test("selected labels stay compact while name, publisher, and capabilities remain searchable", () => {
  const row = renderToStaticMarkup(
    <ModelOptionLabel
      compact
      modelId={metadata.id}
      metadata={metadata}
      copy={copy}
    />,
  );
  expect(row).toContain("DeepSeek Fixture");
  expect(row).not.toContain("per 1M tokens");
  expect(modelSearchText(metadata.id, metadata)).toContain(
    "image_input tools reasoning",
  );
  expect(modelSearchText(metadata.id, metadata)).toContain("Image input");
});

test("model brands follow model identity across gateways and unknown brands use a local fallback", () => {
  for (const [id, brand] of [
    ["deepseek/deepseek-fixture", "deepseek"],
    ["google/gemini-fixture", "google"],
    ["Qwen/Qwen-fixture", "qwen"],
    ["meta-llama/llama-fixture", "meta"],
    ["anthropic/claude-fixture", "anthropic"],
    ["gpt-fixture", "openai"],
    ["moonshotai/kimi-fixture", "moonshot"],
  ])
    expect(modelBrand(id!, "gateway")).toBe(brand);
  expect(modelBrand("unnamed", "alibaba")).toBe("qwen");
  expect(modelBrand("local-fixture", "gateway")).toBeUndefined();
  const fallback = renderToStaticMarkup(
    <ModelBrandIcon modelId="local-fixture" />,
  );
  expect(fallback).toContain("<svg");
  expect(fallback).not.toContain("<img");
});
