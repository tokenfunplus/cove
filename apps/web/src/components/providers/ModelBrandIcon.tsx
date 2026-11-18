import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

const brands = {
  openai: { name: "OpenAI", icon: "openai", mono: true },
  anthropic: { name: "Anthropic", icon: "claude-color" },
  google: { name: "Google", icon: "gemini-color" },
  deepseek: { name: "DeepSeek", icon: "deepseek-color" },
  qwen: { name: "Qwen", icon: "qwen-color" },
  meta: { name: "Meta", icon: "meta-color" },
  mistral: { name: "Mistral", icon: "mistral-color" },
  xai: { name: "xAI", icon: "grok", mono: true },
  moonshot: { name: "Moonshot AI", icon: "kimi-color" },
  zhipu: { name: "Zhipu AI", icon: "zhipu-color" },
  minimax: { name: "MiniMax", icon: "minimax-color" },
  cohere: { name: "Cohere", icon: "cohere-color" },
  perplexity: { name: "Perplexity", icon: "perplexity-color" },
  nvidia: { name: "NVIDIA", icon: "nvidia-color" },
  microsoft: { name: "Microsoft", icon: "microsoft-color" },
  amazon: { name: "Amazon", icon: "aws-color" },
} satisfies Record<string, { name: string; icon: string; mono?: boolean }>;
type Brand = keyof typeof brands;

export function modelBrand(modelId: string, owner?: string): Brand | undefined {
  const id = modelId.toLowerCase();
  const families: [Brand, RegExp][] = [
    ["anthropic", /anthropic|claude/],
    ["google", /gemini|google\//],
    ["deepseek", /deepseek/],
    ["qwen", /qwen/],
    ["meta", /meta-llama|(?:^|\/)llama/],
    ["mistral", /mistral|mixtral|codestral|devstral/],
    ["xai", /(?:^|\/)(?:grok|x-ai|xai)/],
    ["moonshot", /moonshot|(?:^|\/)kimi/],
    ["zhipu", /zhipu|z-ai|(?:^|\/)glm/],
    ["minimax", /minimax/],
    ["cohere", /cohere|command-r/],
    ["perplexity", /perplexity|(?:^|\/)sonar/],
    ["nvidia", /nvidia|nemotron/],
    ["microsoft", /microsoft|(?:^|\/)phi-/],
    ["amazon", /amazon|(?:^|\/)nova-/],
    ["openai", /openai\/|(?:^|\/)(?:gpt-|chatgpt-|o[134](?:-|$))/],
  ];
  const family = families.find(([, pattern]) => pattern.test(id));
  if (family) return family[0];
  const aliases: Record<string, Brand> = {
    alibaba: "qwen",
    "x-ai": "xai",
    moonshotai: "moonshot",
    "z-ai": "zhipu",
    zai: "zhipu",
    mistralai: "mistral",
    aws: "amazon",
  };
  const publisher = owner?.trim().toLowerCase() ?? "";
  return (
    aliases[publisher] ??
    (Object.hasOwn(brands, publisher) ? (publisher as Brand) : undefined)
  );
}

export function ModelBrandIcon({
  modelId,
  owner,
  className,
}: {
  modelId: string;
  owner?: string;
  className?: string;
}) {
  const key = modelBrand(modelId, owner);
  const brand: { name: string; icon: string; mono?: boolean } | undefined = key
    ? brands[key]
    : undefined;
  return brand ? (
    <img
      src={`/assets/model-icons/${brand.icon}.svg`}
      alt=""
      aria-hidden="true"
      title={brand.name}
      width={24}
      height={24}
      className={cn(
        "size-6 shrink-0 object-contain",
        brand.mono && "dark:invert",
        className,
      )}
    />
  ) : (
    <Cpu
      aria-hidden="true"
      className={cn("size-6 shrink-0 text-muted-foreground", className)}
    />
  );
}
