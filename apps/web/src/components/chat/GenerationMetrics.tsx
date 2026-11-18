import { answerToolsCopy as toolCopy } from "@/messages/answer-tools";
import { useEffect, useState } from "react";
import type {
  GenerationMetrics as Metrics,
  ProviderSnapshot,
} from "@cove/api-contract";
import { Input } from "@/components/ui/input";
import { answerToolsStyles as styles } from "@/styles/answer-tools";

export function estimateGenerationCost(
  metrics: Metrics,
  inputRate: string,
  outputRate: string,
) {
  if (
    !inputRate.trim() ||
    !outputRate.trim() ||
    metrics.input_tokens === undefined ||
    metrics.output_tokens === undefined
  )
    return undefined;
  const rates = [Number(inputRate), Number(outputRate)];
  if (
    rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1000000)
  )
    return undefined;
  return (
    (metrics.input_tokens * rates[0] + metrics.output_tokens * rates[1]) /
    1000000
  );
}

export function GenerationMetrics({
  metrics,
  snapshot,
  embedded = false,
}: {
  metrics?: Metrics;
  snapshot?: ProviderSnapshot;
  embedded?: boolean;
}) {
  const storageKey = `cove:model-pricing:${JSON.stringify([snapshot?.provider_id, snapshot?.model_id])}`;
  const [rates, setRates] = useState<[string, string]>(["", ""]);
  useEffect(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "null",
      );
      setRates(
        Array.isArray(value) &&
          value.length === 2 &&
          value.every((item) => typeof item === "string")
          ? (value as [string, string])
          : ["", ""],
      );
    } catch {
      setRates(["", ""]);
    }
  }, [storageKey]);
  const seconds = (value?: number) =>
    value === undefined
      ? toolCopy.notRecorded
      : `${(value / 1000).toFixed(2)} s`;
  const speed =
    metrics?.output_tokens !== undefined &&
    metrics.output_duration_ms &&
    metrics.output_duration_ms > 0
      ? metrics.output_tokens / (metrics.output_duration_ms / 1000)
      : undefined;
  const cost = metrics ? estimateGenerationCost(metrics, ...rates) : undefined;
  const Container = embedded ? "section" : "details";
  const Heading = embedded ? "h3" : "summary";
  return (
    <Container
      className={
        embedded
          ? "grid gap-2 rounded-xl border border-border p-3 text-xs"
          : styles.stats
      }
    >
      <Heading className={embedded ? "font-semibold" : undefined}>
        {toolCopy.performance}
        {metrics
          ? ` · ${seconds(metrics.duration_ms)}${metrics.output_tokens === undefined ? "" : ` · ${metrics.output_tokens.toLocaleString()} output tokens`}`
          : " · Not recorded"}
      </Heading>
      <dl className={styles.statGrid}>
        <div>
          <dt>{toolCopy.totalTime}</dt>
          <dd>{seconds(metrics?.duration_ms)}</dd>
        </div>
        <div>
          <dt>{toolCopy.firstText}</dt>
          <dd>{seconds(metrics?.time_to_first_token_ms)}</dd>
        </div>
        <div>
          <dt>{toolCopy.inputTokens}</dt>
          <dd>
            {metrics?.input_tokens?.toLocaleString() ?? toolCopy.notReported}
          </dd>
        </div>
        <div>
          <dt>{toolCopy.outputTokens}</dt>
          <dd>
            {metrics?.output_tokens?.toLocaleString() ?? toolCopy.notReported}
          </dd>
        </div>
        <div>
          <dt>{toolCopy.outputSpeed}</dt>
          <dd>
            {speed === undefined
              ? toolCopy.notAvailable
              : `${speed.toFixed(1)} tokens/s`}
          </dd>
        </div>
        <div>
          <dt>{toolCopy.estimatedCost}</dt>
          <dd>
            {cost === undefined ? toolCopy.notAvailable : `$${cost.toFixed(6)}`}
          </dd>
        </div>
      </dl>
      <div className="space-y-3 px-3 pb-3">
        <p className={styles.hint}>
          {toolCopy.timingIntro}{" "}
          {metrics?.source === "browser"
            ? toolCopy.browserTiming
            : toolCopy.serviceTiming}
          {toolCopy.speedNotice}
        </p>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-2 text-muted-foreground">
            {toolCopy.rates}
          </legend>
          {[toolCopy.inputRate, toolCopy.outputRate].map((label, index) => (
            <label key={label} className="space-y-1">
              {label}
              <Input
                aria-label={label}
                type="number"
                min="0"
                max="1000000"
                step="any"
                placeholder={toolCopy.notSet}
                value={rates[index]}
                onChange={(event) =>
                  setRates((current) =>
                    index === 0
                      ? [event.target.value, current[1]]
                      : [current[0], event.target.value],
                  )
                }
                onBlur={() => {
                  try {
                    localStorage.setItem(storageKey, JSON.stringify(rates));
                  } catch {
                    /* Rates remain available for this session. */
                  }
                }}
              />
            </label>
          ))}
        </fieldset>
        <p className={styles.hint}>{toolCopy.costNotice}</p>
      </div>
    </Container>
  );
}
