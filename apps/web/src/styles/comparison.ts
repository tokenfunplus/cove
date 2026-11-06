import { cn } from "@/lib/utils";

// Tailwind recipes for comparison presentation. Semantic colors come from theme/tokens.css.
export const comparisonStyles = {
  modelComparisonGrid: cn(String.raw`
    model-comparison-grid max-w-[1120px] mx-auto mt-0 mb-6 min-w-0
  `),
  modelComparisonGrid_cards: cn(String.raw`
    model-comparison-grid__cards grid grid-cols-2 gap-3.5 items-stretch max-[1000px]:grid-cols-1
  `),
  modelComparisonGrid_page: cn(String.raw`
    model-comparison-grid__page min-w-0 relative flex
  `),
  modelAnswerCard: cn(String.raw`
    model-answer-card w-full flex flex-col border border-border rounded-[calc(var(--radius)*1.375)] p-4.5
    min-w-0 bg-popover [transition:border-color_200ms,_box-shadow_200ms]
    [&.model-answer-card--selected]:border-primary
    [&.model-answer-card--selected]:[box-shadow:0_0_0_3px_color-mix(in_srgb,_var(--primary)_10%,_transparent)]
    max-[767px]:p-[15px] max-[767px]:rounded-[calc(var(--radius)*1.125)]
  `),
  modelAnswerCard_header: cn(String.raw`
    model-answer-card__header flex items-start gap-[9px] flex-wrap pb-3.5 border-b border-border
    [&_>_div:first-of-type]:flex-1 [&_>_div:first-of-type]:min-w-0 [&_p]:text-[11px]
    [&_p]:text-muted-foreground [&_p]:mt-1 [&_h3]:text-sm [&_h3]:[overflow-wrap:anywhere]
  `),
  modelAnswerCard_identity: cn(String.raw`
    model-answer-card__identity flex items-center flex-wrap gap-[7px] w-full order-2 empty:hidden
  `),
  modelAnswerCard_selected: cn(String.raw`
    model-answer-card__selected inline-flex py-[3px] px-[7px] bg-accent text-primary
    rounded-[calc(var(--radius)*0.5)] text-[9px] font-semibold
  `),
  modelAnswerCard_time: cn(String.raw`
    model-answer-card__time text-[11px] text-muted-foreground
  `),
  modelAnswerCard_body: cn(String.raw`
    model-answer-card__body px-0 pt-4 pb-2.5 min-w-0 [&_.message\_\_markdown]:text-sm
    [&_.message\_\_markdown]:leading-[1.9]
  `),
  modelAnswerCard_actions: cn(String.raw`
    model-answer-card__actions flex flex-wrap gap-2 pt-3.5 mt-auto [&_button]:text-xs
  `),
  pick: cn(String.raw`
    pick bg-accent text-primary [border-color:transparent] [&[aria-pressed="true"]]:bg-primary
    [&[aria-pressed="true"]]:text-primary-foreground
  `),
  modelComparisonGrid_spec: cn(String.raw`
    model-comparison-grid__spec flex flex-wrap items-center gap-x-4 gap-y-1 pt-2.5 text-[11px]
    text-muted-foreground [&_b]:font-medium [&_b]:text-foreground [&_b]:tabular-nums
  `),
} as const;
