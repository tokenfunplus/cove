import { cn } from "@/lib/utils";

// Tailwind recipes for models presentation. Semantic colors come from theme/tokens.css.
export const modelsStyles = {
  modelSelector: cn(String.raw`
    model-selector relative min-w-0
  `),
  modelSelector_topline: cn(String.raw`
    model-selector__topline flex gap-2.5 items-end max-[500px]:gap-[7px]
  `),
  modelSelector_fields: cn(String.raw`
    model-selector__fields grid grid-cols-[minmax(120px,_150px)_minmax(150px,_320px)] gap-2.5 min-w-0
    [&_>_div]:min-w-0 max-[1100px]:flex-1
    max-[1100px]:grid-cols-[minmax(95px,_0.7fr)_minmax(120px,_1.3fr)] max-[500px]:gap-[7px]
    max-[500px]:grid-cols-[minmax(76px,_0.6fr)_minmax(95px,_1.4fr)]
    max-[500px]:[&_.front-select\_\_search-icon]:hidden max-[500px]:[&_.front-select\_\_selected-value]:left-2
    max-[500px]:[&_.front-select\_\_input]:pl-2
  `),
  modelSelector_providerSelect: cn(String.raw`
    model-selector__provider-select w-full h-10 py-0 px-3 text-xs
    rounded-[calc(var(--radius)*0.75)]
  `),
  modelSelector_fieldLabel: cn(String.raw`
    model-selector__field-label flex gap-2 items-center
  `),
  modelSelector_fieldState: cn(String.raw`
    model-selector__field-state flex gap-1 text-muted-foreground
    [&_svg]:animate-[cove-spin_1.4s_linear_infinite]
  `),
  modelSelector_comparisonToggle: cn(String.raw`
    model-selector__comparison-toggle h-10 py-0 px-3 bg-popover border-border shadow-none hover:translate-y-0
    rounded-[calc(var(--radius)*0.75)] whitespace-nowrap text-[11px]
    [&[aria-expanded="true"]]:text-primary [&[aria-expanded="true"]]:bg-accent
    [&_strong]:rounded-[calc(var(--radius)*0.375)] [&_strong]:text-[10px] [&_strong]:py-0.5
    [&_strong]:px-[5px] [&_strong]:bg-popover [&[aria-expanded="true"]_>_svg:last-child]:rotate-180
    max-[1100px]:[&_>_span]:hidden max-[500px]:p-2 max-[500px]:gap-1
    max-[500px]:[&_>_svg:last-child]:hidden
  `),
  modelSelector_comparison: cn(String.raw`
    model-selector__comparison absolute top-full right-0 z-40 mt-2 w-[min(370px,calc(100vw_-_32px))]
    max-h-[min(52dvh,440px)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-4 shadow-popover
    [&:not([hidden])]:animate-[cove-rise_200ms_var(--ease-out)]
  `),
  modelSelector_comparisonHeading: cn(String.raw`
    model-selector__comparison-heading flex items-center justify-between pb-3 mb-3 border-b border-border text-sm font-semibold
    [&_.model-selector\_\_count]:text-xs [&_.model-selector\_\_count]:text-muted-foreground
  `),
  modelSelector_chips: cn(String.raw`
    model-selector__chips grid gap-3
  `),
  modelSelector_chip: cn(String.raw`
    model-selector__chip grid grid-cols-[minmax(0,_1fr)_auto] items-center gap-x-1 min-w-0 [&_.front-select]:min-w-0
  `),
  modelSelector_chipProvider: cn(String.raw`
    model-selector__chip-provider col-span-full mb-1.5 text-[11px] font-semibold text-muted-foreground
  `),
  modelSelector_chipRemove: cn(String.raw`
    model-selector__chip-remove size-8 shadow-none border-0 bg-transparent p-1 text-muted-foreground hover:text-destructive
  `),
  modelSelector_chipModelSelect: cn(String.raw`
    model-selector__chip-model-select h-9 py-0 text-xs
  `),
  modelSelector_addButton: cn(String.raw`
    model-selector__add-button mt-3 w-full h-9 text-xs text-primary bg-accent border-transparent shadow-none hover:translate-y-0
  `),
  modelSelector_addSearch: cn(String.raw`
    model-selector__add-search flex items-center gap-2 py-1 px-2.5 border-b border-border
    [&_input]:border-0 [&_input]:shadow-none [&_input]:bg-transparent [&_input]:px-0
    [&_input]:rounded-none [&_input]:text-xs
  `),
  modelSelector_addOptions: cn(String.raw`
    model-selector__add-options max-h-[min(180px,22dvh)] overflow-y-auto
  `),
  modelOption: cn(String.raw`
    model-option flex items-center justify-between gap-2 min-w-0 w-full
  `),
  modelOption_id: cn(String.raw`
    model-option__id overflow-hidden text-ellipsis whitespace-nowrap
  `),
  modelOption_badge: cn(String.raw`
    model-option__badge shrink-0 text-[10px] py-[3px] px-1.5 rounded-[calc(var(--radius)*0.375)] bg-peach
    text-peach-foreground [&.model-option\_\_badge--private\_tee]:bg-accent
    [&.model-option\_\_badge--private\_tee]:text-primary [&.model-option\_\_badge--incognito]:bg-rose
    [&.model-option\_\_badge--incognito]:text-rose-foreground
  `),
  modelSelector_status: cn(String.raw`
    model-selector__status text-destructive text-[10px] [&:not(:empty)]:pt-[7px]
  `),
  modelSelector_empty: cn(String.raw`
    model-selector__empty p-3 text-muted-foreground text-[11px]
  `),
  providerRequired: cn(String.raw`
    provider-required flex items-center gap-2.5 flex-wrap py-3.5 px-4.5 [margin:14px_22px_0] border
    border-border bg-peach text-peach-foreground rounded-[calc(var(--radius)*1.0625)] text-xs shrink-0
    [&_p]:flex-1 [&_p]:min-w-[120px] [&_p]:leading-[1.7] [&_button]:text-[11px]
  `),
  providerRequired_icon: cn(String.raw`
    provider-required__icon flex
  `),
} as const;
