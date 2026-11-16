import { cn } from "@/lib/utils";

// Tailwind recipes for chat presentation. Semantic colors come from theme/tokens.css.
export const chatStyles = {
  focusMessages: cn(String.raw`
    px-4 py-0 pb-5 max-[767px]:px-3 max-[767px]:py-0 max-[767px]:pb-4
    [&>:first-child]:mt-5 max-[767px]:[&>:first-child]:mt-4
    [&_.model-comparison-grid]:w-full [&_.model-comparison-grid]:max-w-[1680px]
    [&_.model-comparison-grid\_\_cards]:grid-cols-2 max-[767px]:[&_.model-comparison-grid\_\_cards]:grid-cols-1
    [&_.message]:max-w-[960px]
    [&_.message\_\_markdown]:text-[15px] [&_.message\_\_markdown]:leading-[1.85]
    [&_.model-answer-card\_\_body_.message\_\_markdown]:text-[15px]
    [&_.model-answer-card\_\_body_.message\_\_markdown]:leading-[1.85]
    [&_.model-answer-card\_\_header]:sticky [&_.model-answer-card\_\_header]:top-0
    [&_.model-answer-card\_\_header]:z-10 [&_.model-answer-card\_\_header]:bg-popover
  `),
  focusComposer: cn(String.raw`
    max-w-[1200px] [padding:6px_16px_10px]
    [&_textarea]:min-h-8 [&_textarea]:max-h-[min(144px,20dvh)]
    [&_textarea]:w-0 [&_textarea]:flex-1 [&_textarea]:py-1 [&_textarea]:leading-6
    max-[767px]:[padding:6px_12px_max(8px,env(safe-area-inset-bottom))]
  `),
  focusComposerBox: "flex flex-wrap items-end gap-2 rounded-xl p-2 max-[767px]:rounded-xl",
  focusNoteBand: "max-w-[1200px] px-4 py-1 max-[767px]:px-3",
  focusNoteInner: "flex-nowrap gap-2 rounded-lg px-2.5 py-1.5 max-[767px]:flex-nowrap",
  focusNoteText: "text-[11px] leading-4 max-[767px]:basis-auto max-[767px]:text-[10px]",
  focusNoteAction: "h-7 rounded-md px-2 text-[10px] max-[767px]:w-auto",
  noteBand_cta: cn(
    String.raw`note-band__cta max-[767px]:w-full shrink-0 text-[10px] bg-popover max-[767px]:ml-auto`,
  ),
  conversationPanel: cn(String.raw`
    conversation-panel relative flex flex-1 min-w-0 min-h-0 flex-col
  `),
  messageList: cn(String.raw`
    message-list flex-1 min-h-0 overflow-y-auto overscroll-contain py-7 px-[clamp(20px,_4vw,_60px)]
    [&.message-list--empty]:[background-image:var(--surface-pattern,none)] [&.message-list--empty]:bg-size-[48px_48px]
    [&.message-list--empty]:flex [&.message-list--empty]:flex-col [&.message-list--empty]:justify-start
    max-[767px]:py-5.5 max-[767px]:px-4.5
  `),
  conversationPanel_empty: cn(String.raw`
    conversation-panel__empty m-auto p-7.5 text-muted-foreground
  `),
  conversationPanel_archived: cn(String.raw`
    conversation-panel__archived py-3 px-6 bg-peach text-peach-foreground text-xs
  `),
  generationStop: cn(String.raw`
    generation-stop h-7 gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground
  `),
  generationStop_label: cn(String.raw`
    generation-stop__label text-[11px]
  `),
  conversationPanel_latest: cn(String.raw`
    conversation-panel__latest absolute left-[50%] [transform:translateX(-50%)]
    rounded-full bg-popover shadow-popover z-10 whitespace-nowrap
    enabled:active:[transform:translateX(-50%)_scale(0.98)]
  `),
  generationComposer: cn(String.raw`
    generation-composer w-full max-w-[810px] [align-self:center] shrink-0 [padding:10px_25px_14px]
    [&_textarea]:block [&_textarea]:min-h-13 [&_textarea]:max-h-[min(180px,_22dvh)]
    [&_textarea]:field-sizing-content [&_textarea]:resize-none [&_textarea]:p-0 [&_textarea]:border-0
    [&_textarea]:rounded-none [&_textarea]:shadow-none [&_textarea]:bg-transparent
    [&_textarea]:text-[13px] [&_textarea]:leading-[1.7]
    max-[767px]:[padding:10px_14px_max(12px,_env(safe-area-inset-bottom))]
  `),
  generationComposer_models: cn(String.raw`
    generation-composer__models flex items-center gap-1.5 flex-wrap [margin:0_8px_9px] text-[11px]
    text-muted-foreground max-[767px]:mx-1
  `),
  generationComposer_label: cn(String.raw`
    generation-composer__label mr-1 max-[767px]:hidden
  `),
  generationComposer_chip: cn(String.raw`
    generation-composer__chip inline-flex items-center gap-[5px] max-w-[250px] overflow-hidden
    text-ellipsis whitespace-nowrap rounded-[calc(var(--radius)*0.375)] bg-muted py-1 px-1.5 text-[11px]
    [&_b]:font-medium max-[767px]:[&_b]:hidden max-[767px]:max-w-[150px]
  `),
  generationComposer_hint: cn(String.raw`
    generation-composer__hint text-primary
  `),
  generationComposer_box: cn(String.raw`
    generation-composer__box px-4 pt-3.5 pb-2.5 rounded-[calc(var(--radius)*1.5)]
    [border:1px_solid_var(--border-strong)] bg-popover
    [box-shadow:0_8px_28px_-20px_color-mix(in_srgb,var(--primary)_25%,transparent)]
    [transition:box-shadow_var(--duration),_border-color_var(--duration)] focus-within:border-ring
    focus-within:[box-shadow:0_0_0_4px_color-mix(in_srgb,_var(--primary)_8%,_transparent),_0_8px_28px_-20px_color-mix(in_srgb,var(--primary)_25%,transparent)]
    [&_>_label]:block [&_>_label]:absolute [&_>_label]:w-[1px] [&_>_label]:h-[1px]
    [&_>_label]:[clip-path:inset(50%)] [&_>_label]:overflow-hidden
    max-[767px]:rounded-[calc(var(--radius)*1.3125)]
  `),
  generationComposer_bar: cn(String.raw`
    generation-composer__bar flex justify-between items-center gap-2.5 mt-2
  `),
  generationComposer_contextNote: cn(String.raw`
    generation-composer__context-note text-muted-foreground text-[10px] tracking-[0.01em]
  `),
  generationComposer_send: cn(String.raw`
    generation-composer__send w-[35px] h-[35px] p-0 bg-primary text-primary-foreground border-0
    rounded-[calc(var(--radius)*0.75)] enabled:hover:bg-primary-hover
    enabled:hover:brightness-95
  `),
  generationComposer_mode: cn(String.raw`
    generation-composer__mode text-[11px] text-muted-foreground inline-flex items-center gap-[5px] [&_>_span]:w-[5px] [&_>_span]:h-[5px]
    [&_>_span]:rounded-full [&_>_span]:bg-primary
  `),
  generationComposer_foot: cn(String.raw`
    generation-composer__foot flex items-center justify-center gap-[5px] mt-[7px] text-muted-foreground
    text-[10px] leading-[1.5] text-center [&_svg]:shrink-0 max-[767px]:text-[10px]
  `),
  noteBand: cn(String.raw`
    note-band w-full max-w-[1060px] [align-self:center] py-2 px-[25px] shrink-0 max-[767px]:px-3.5
  `),
  noteBand_inner: cn(String.raw`
    note-band__inner flex items-center gap-[9px] border border-border rounded-[calc(var(--radius)*0.875)]
    bg-peach py-2.5 px-3 max-[767px]:flex-wrap
  `),
  noteBand_no: cn(String.raw`
    note-band__no max-[767px]:hidden text-peach-foreground
  `),
  noteBand_text: cn(String.raw`
    note-band__text max-[767px]:basis-full max-[767px]:text-[11px] flex-1 text-[10px] text-peach-foreground leading-[1.6]
  `),
} as const;
