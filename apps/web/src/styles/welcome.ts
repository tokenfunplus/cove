import { cn } from "@/lib/utils";

// Tailwind recipes for welcome presentation. Semantic colors come from theme/tokens.css.
export const welcomeStyles = {
  conversationWelcome: cn(String.raw`
    conversation-welcome shrink-0 w-full max-w-[760px] m-auto py-0 px-0
    [@media(max-height:_800px)_and_(min-width:_768px)]:py-1.5
    [@media(max-height:_800px)_and_(min-width:_768px)]:px-0 max-[767px]:[padding:12px_0_20px]
    animate-[cove-rise_500ms_var(--ease-out)_both]
  `),
  conversationWelcome_illustration: cn(String.raw`
    conversation-welcome__illustration relative grid place-items-center w-[72px] h-[72px] mb-4.5
    rounded-[calc(var(--radius)*1.875)] bg-accent text-primary [transform:rotate(-7deg)]
    [&_.cove-mark]:w-14.5 [&_.cove-mark]:h-14.5 [@media(max-height:_800px)_and_(min-width:_768px)]:w-15
    [@media(max-height:_800px)_and_(min-width:_768px)]:h-15
    [@media(max-height:_800px)_and_(min-width:_768px)]:rounded-[calc(var(--radius)*1.3125)]
    [@media(max-height:_800px)_and_(min-width:_768px)]:mb-[13px]
    [@media(max-height:_800px)_and_(min-width:_768px)]:[&_.cove-mark]:w-[43px]
    [@media(max-height:_800px)_and_(min-width:_768px)]:[&_.cove-mark]:h-[43px] max-[767px]:w-16
    max-[767px]:h-16 max-[767px]:mb-4.5 max-[767px]:rounded-[calc(var(--radius)*1.375)]
    max-[767px]:[&_.cove-mark]:w-[45px] max-[767px]:[&_.cove-mark]:h-[45px]
    animate-[cove-float_4.5s_ease-in-out_infinite]
  `),
  conversationWelcome_spark: cn(String.raw`
    conversation-welcome__spark absolute right-[-11px] top-[-7px] grid place-items-center w-8 h-8
    rounded-[calc(var(--radius)*0.75)] bg-peach text-peach-foreground [transform:rotate(17deg)]
  `),
  conversationWelcome_eyebrow: cn(String.raw`
    conversation-welcome__eyebrow text-[11px] font-[550] text-primary mb-3
  `),
  conversationWelcome_title: cn(String.raw`
    conversation-welcome__title text-[length:var(--heading-size,clamp(30px,_3.6vw,_46px))] [font-family:var(--heading-font,inherit)] [font-weight:var(--heading-weight,620)] leading-[1.18]
    tracking-[-0.055em]
    [@media(max-height:_800px)_and_(min-width:_768px)]:text-[34px]
  `),
  conversationWelcome_sub: cn(String.raw`
    conversation-welcome__sub max-w-[480px] text-xs leading-[1.8] text-muted-foreground mt-4
    max-[767px]:text-[11px]
  `),
  conversationSuggestions: cn(String.raw`
    conversation-suggestions mt-7 [@media(max-height:_800px)_and_(min-width:_768px)]:mt-4.5
    max-[767px]:mt-5.5
  `),
  conversationSuggestions_heading: cn(String.raw`
    conversation-suggestions__heading mb-2.5 text-muted-foreground text-[10px]
  `),
  conversationSuggestions_list: cn(String.raw`
    conversation-suggestions__list grid grid-cols-3 gap-2.5 max-[767px]:grid-cols-1 max-[767px]:gap-2
  `),
  suggest: cn(String.raw`
    suggest grid justify-start [align-content:start] gap-[7px] text-left p-[15px] min-h-[112px] border
    border-border rounded-[calc(var(--radius)*1.25)] bg-popover
    [&:nth-child(2)]:[background:color-mix(in_srgb,_var(--peach)_45%,_var(--popover))]
    [&:nth-child(3)]:[background:color-mix(in_srgb,_var(--rose)_40%,_var(--popover))]
    enabled:hover:translate-y-0 enabled:hover:border-border-strong enabled:hover:bg-muted
    [&:nth-child(2)_.suggest\_\_no]:bg-peach [&:nth-child(2)_.suggest\_\_no]:text-peach-foreground
    [&:nth-child(3)_.suggest\_\_no]:bg-rose [&:nth-child(3)_.suggest\_\_no]:text-rose-foreground
    [@media(max-height:_800px)_and_(min-width:_768px)]:min-h-[95px]
    [@media(max-height:_800px)_and_(min-width:_768px)]:p-3 max-[767px]:grid-cols-[28px_minmax(0,_1fr)]
    max-[767px]:gap-[3px_12px] max-[767px]:min-h-auto max-[767px]:py-3 max-[767px]:px-3.5
    max-[767px]:rounded-[calc(var(--radius)*1)] animate-[cove-rise_450ms_var(--ease-out)_backwards]
    [&:nth-child(2)]:[animation-delay:65ms] [&:nth-child(3)]:[animation-delay:130ms] h-auto
    whitespace-normal shadow-none
  `),
  suggest_no: cn(String.raw`
    suggest__no grid place-items-center w-[27px] h-[27px] rounded-[calc(var(--radius)*0.625)] bg-accent
    text-primary mb-[3px] max-[767px]:row-start-1 max-[767px]:row-end-3 max-[767px]:m-0
    max-[767px]:[align-self:center]
  `),
  suggest_t: cn(String.raw`
    suggest__t text-[13px] leading-[1.5] max-[767px]:text-[11px]
  `),
  suggest_d: cn(String.raw`
    suggest__d text-muted-foreground text-[11px] leading-[1.5] font-normal max-[767px]:col-start-2
  `),
  conversationEmptyState: cn(String.raw`
    conversation-empty-state flex items-center justify-center flex-col gap-3.5 m-auto p-8 text-center
    max-w-[480px] [&_>_p:not(.eyebrow)]:text-muted-foreground [&_>_p:not(.eyebrow)]:text-[13px]
    [&_>_p:not(.eyebrow)]:leading-[1.7]
  `),
  emptyState_mark: cn(String.raw`
    empty-state__mark w-[70px] h-[70px] text-primary
  `),
} as const;
