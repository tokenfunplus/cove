import { cn } from "@/lib/utils";

// Tailwind recipes for messages presentation. Semantic colors come from theme/tokens.css.
export const messagesStyles = {
  mathInline: "[overflow-wrap:normal] [&_.katex]:text-[1.1em] [&_.katex-html]:whitespace-normal",
  mathDisplay: "max-w-full min-w-0 overflow-x-auto overflow-y-hidden py-2 [overflow-wrap:normal] focus-visible:outline-ring [&_.katex-display]:m-0 [&_.katex-display]:w-max [&_.katex-display]:min-w-full [&_.katex]:text-[1.1em] [&[data-math-source]]:whitespace-pre-wrap [&[data-math-source]]:break-words",
  assistantContent: "space-y-3",
  reasoning: "group/reasoning overflow-hidden rounded-xl border border-border bg-muted/30",
  reasoningSummary: "flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-ring [&::-webkit-details-marker]:hidden",
  reasoningChevron: "shrink-0 transition-transform group-open/reasoning:rotate-90 motion-reduce:transition-none",
  reasoningStatus: "ml-auto text-[10px] font-normal",
  reasoningBody: "px-3 pb-3",
  codeBlock_pre: "!m-0 !rounded-none !border-0",
  codeBlock_error: "px-3 text-xs text-destructive",
  codeBlock_language: "truncate font-mono",
  codeBlock_toolbar: "flex items-center justify-between gap-3 border-b border-border px-3 py-1 text-xs text-muted-foreground",
  codeBlock: "my-3 overflow-hidden rounded-xl border border-border bg-muted",
  message: cn(String.raw`
    message w-full max-w-[760px] mx-auto mt-0 mb-7 min-w-0 [&.message--user]:flex
    [&.message--user]:items-end [&.message--user]:flex-col [&.message--user]:gap-1.5
  `),
  message_role: cn(String.raw`
    message__role flex flex-wrap items-center gap-2 text-muted-foreground text-[10px] mb-3
    [&_b]:text-foreground [&_b]:font-semibold [&_code]:text-[11px] [&_code]:pl-2 [&_code]:border-l [&_code]:border-border-strong
    [&_.message\_\_verification-lanes]:basis-full [&_.message\_\_verification-lanes]:order-last [&_code]:max-w-full
    [&_code]:[overflow-wrap:anywhere] [&.message\_\_role--user]:m-0 [&.message\_\_role--user]:text-[10px]
  `),
  message_roleName: cn(String.raw`
    message__role-name [font-family:var(--label-font,inherit)] text-[11px]
  `),
  message_timestamp: cn(String.raw`
    message__timestamp text-[9px] text-muted-foreground ml-auto
  `),
  message_bubble: cn(String.raw`
    message__bubble max-w-[82%] py-[13px] px-4.5 rounded-[calc(var(--radius)*1.3)_calc(var(--radius)*1.3)_calc(var(--radius)*0.4)_calc(var(--radius)*1.3)] bg-accent text-foreground
    whitespace-pre-wrap text-[13px] leading-[1.75] max-[767px]:max-w-[92%]
  `),
  message_body: cn(String.raw`
    message__body [overflow-wrap:anywhere] break-normal [&.message\_\_body--pending]:flex
    [&.message\_\_body--pending]:items-center [&.message\_\_body--pending]:gap-2
    [&.message\_\_body--pending]:py-2.5 [&.message\_\_body--pending]:px-0
    [&.message\_\_body--pending]:text-xs [&.message\_\_body--pending]:text-muted-foreground
  `),
  message_markdown: cn(String.raw`
    message__markdown text-foreground text-sm leading-[1.85] [&_>_*_+_*]:mt-3.5
    [&_h1]:[font-family:var(--heading-font,inherit)] [&_h1]:leading-[1.4] [&_h1]:tracking-[-0.02em]
    [&_h2]:[font-family:var(--heading-font,inherit)] [&_h2]:leading-[1.4] [&_h2]:tracking-[-0.02em]
    [&_h3]:[font-family:var(--heading-font,inherit)] [&_h3]:leading-[1.4] [&_h3]:tracking-[-0.02em] [&_h1]:text-2xl
    [&_h2]:text-xl [&_h3]:text-[17px] [&_ul]:pl-6 [&_ol]:pl-6 [&_ul]:list-disc [&_ol]:list-decimal
    [&_li_+_li]:mt-1.5 [&_pre]:max-w-full [&_pre]:bg-muted [&_pre]:border [&_pre]:border-border
    [&_pre]:rounded-[calc(var(--radius)*1)] [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:whitespace-pre
    [&_pre]:text-xs [&_pre]:leading-[1.7] [&_:not(pre)_>_code]:bg-muted
    [&_:not(pre)_>_code]:rounded-[calc(var(--radius)*0.3125)] [&_:not(pre)_>_code]:py-0.5
    [&_:not(pre)_>_code]:px-[5px] [&_:not(pre)_>_code]:text-[0.87em] max-[767px]:text-[13px]
  `),
  message_privacyToggle: cn(String.raw`
    message__privacy-toggle h-7 mt-3 gap-1.5 px-1.5 -ml-1.5 rounded-md border-0 bg-transparent
    text-[11px] font-medium text-muted-foreground shadow-none hover:bg-muted hover:text-foreground
    [&[aria-expanded="true"]_svg:last-child]:rotate-180
  `),
  message_privacyFootnote: cn(String.raw`
    message__privacy-footnote mt-1 border-l-2 border-border-strong pl-3 py-1 text-xs leading-relaxed
    text-foreground [&_strong]:font-medium
  `),
  message_privacyFootnote_src: cn(String.raw`
    message__privacy-footnote__src mt-1 text-[11px] text-muted-foreground
  `),
  message_snapshot: cn(String.raw`
    message__snapshot mt-2 border-t border-border text-muted-foreground
    [&[open]_.message\_\_snapshot-chevron]:rotate-180 [&_>_summary]:flex [&_>_summary]:items-center
    [&_>_summary]:justify-between [&_>_summary]:gap-3 [&_>_summary]:py-2 [&_>_summary]:list-none
    [&_>_summary::-webkit-details-marker]:hidden [&_>_summary:hover]:text-foreground
    [&_>_summary:focus-visible]:outline-ring
  `),
  message_snapshotSummary: cn(String.raw`
    message__snapshot-summary flex min-w-0 items-center gap-2 [&_svg]:shrink-0
    [&_>_span:last-child]:flex [&_>_span:last-child]:flex-wrap [&_>_span:last-child]:items-baseline
    [&_>_span:last-child]:gap-x-2 [&_>_span:last-child]:min-w-0 [&_strong]:text-[11px] [&_strong]:font-medium
    [&_small]:text-[11px] [&_small]:truncate
  `),
  message_snapshotSecurity: cn(String.raw`
    message__snapshot-security flex shrink-0 items-center gap-1.5 text-[10px]
  `),
  message_snapshotDetails: cn(String.raw`
    message__snapshot-details rounded-lg border border-border bg-popover px-3.5 py-2.5 text-xs
    [&_dl]:m-0 [&_dl_>_div]:grid [&_dl_>_div]:grid-cols-[minmax(66px,25%)_minmax(0,1fr)]
    [&_dl_>_div]:gap-3 [&_dl_>_div]:py-1 [&_dt]:text-muted-foreground [&_dd]:text-foreground
    [&_dd]:m-0 [&_dd]:[overflow-wrap:anywhere]
  `),
  message_snapshotNotice: cn(String.raw`
    message__snapshot-notice mt-2 grid gap-1 border-t border-border pt-2 text-[11px] leading-relaxed
    [&_span]:font-medium [&_small]:text-[11px]
  `),
  message_state: cn(String.raw`
    message__state p-3 bg-peach text-peach-foreground rounded-[calc(var(--radius)*0.75)] text-xs
  `),
  message_generationProgress: cn(String.raw`
    message__generation-progress flex flex-wrap items-center gap-2 py-1 px-0 text-xs text-muted-foreground
  `),
} as const;
