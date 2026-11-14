import { cn } from "@/lib/utils";

// Tailwind recipes for primitives presentation. Semantic colors come from theme/tokens.css.
export const primitivesStyles = {
  status: cn(
    String.raw`status flex items-center gap-1.5 text-muted-foreground text-[10px] whitespace-nowrap [&.status--unavailable_.workspace\_\_security-icon]:bg-destructive [&.status--connecting_.workspace\_\_security-icon]:bg-peach-foreground`,
  ),
  emptyState_action: cn(String.raw`
    empty-state__action text-primary-foreground bg-primary [border-color:transparent]
    [box-shadow:0_7px_18px_-12px_var(--primary)] enabled:hover:bg-primary-hover
    enabled:hover:text-primary-foreground enabled:hover:[transform:translateY(-2px)]
  `),
  btn: cn(String.raw`
    btn [&.btn--danger]:text-destructive [&.btn--danger]:bg-destructive-muted
    [&.btn--danger]:[border-color:transparent]
  `),
  coveMark: cn(String.raw`
    cove-mark block w-full h-full
  `),
  dot: cn(String.raw`
    dot inline-block w-1.5 h-1.5 rounded-full bg-success shrink-0 [&.dot--grey]:bg-muted-foreground
  `),
  workspace_securityIcon: cn(String.raw`
    workspace__security-icon inline-block w-1.5 h-1.5 rounded-full bg-success shrink-0
  `),
  frontSelect: cn(String.raw`
    front-select grid min-w-0 content-end gap-1.5
  `),
  frontSelect_inputShell: cn(String.raw`
    front-select__input-shell relative min-w-0 [&:focus-within_.front-select\_\_selected-value]:invisible
    [&:focus-within_.front-select\_\_input]:text-foreground
  `),
  frontSelect_selectedValue: cn(String.raw`
    front-select__selected-value absolute z-1 [inset:0_32px_0_31px] text-xs flex items-center pointer-events-none
    overflow-hidden
  `),
  frontSelect_input: cn(String.raw`
    front-select__input h-10 py-0 px-8 w-full rounded-[calc(var(--radius)*0.75)] text-xs bg-popover [&:not(:focus)]:text-transparent
  `),
  frontSelect_searchIcon: cn(String.raw`
    front-select__search-icon absolute left-[11px] top-[50%] [transform:translateY(-50%)]
    text-muted-foreground pointer-events-none
  `),
  frontSelect_toggle: cn(String.raw`
    front-select__toggle absolute right-1 inset-y-1 h-auto w-7 p-0 text-muted-foreground
    bg-transparent border-0 rounded-md shadow-none hover:bg-muted
  `),
  frontSelect_options: cn(String.raw`
    pointer-events-auto front-select__options z-100 max-w-[calc(100vw_-_28px)] border border-border
    rounded-xl p-1 text-foreground bg-popover shadow-popover [--anchor-gap:6px]
    [--anchor-padding:14px] w-[max(var(--input-width,_var(--button-width,_220px)),_220px)]
    [--anchor-max-height:min(320px,45dvh)] max-h-[min(320px,45dvh)] overflow-y-auto overscroll-contain
    scroll-py-9 [transition:opacity_120ms,_transform_120ms_var(--ease-out)]
  `),
  conversationActions_menu: cn(String.raw`
    conversation-actions__menu z-100 max-w-[calc(100vw_-_28px)] border border-border rounded-2xl p-1.5
    text-foreground bg-popover shadow-popover [--anchor-gap:8px] [--anchor-padding:14px] min-w-[185px]
    [&_button]:flex [&_button]:justify-start [&_button]:text-left [&_button]:w-full [&_button]:border-0
    [&_button]:bg-transparent [&_button]:rounded-[calc(var(--radius)*0.625)]
    [&_button[data-focus]]:bg-accent [&[data-closed]]:invisible [&[data-closed]]:pointer-events-none
    [transition:opacity_120ms,_transform_120ms_var(--ease-out)] [&[data-closed]]:[opacity:0]
    [&[data-closed]]:[transform:translateY(-4px)]
  `),
  modelSelector_addMenuItems: cn(String.raw`
    model-selector__add-menu-items mt-2 w-full rounded-lg border border-border bg-card p-1.5 text-foreground
    [&[data-closed]]:invisible [&[data-closed]]:pointer-events-none
    [transition:opacity_120ms,_transform_120ms_var(--ease-out)]
  `),
  workspace_verificationMenuItems: cn(String.raw`
    workspace__verification-menu-items z-100 max-w-[calc(100vw_-_28px)] border border-border rounded-2xl
    p-1.5 text-foreground bg-popover shadow-popover [--anchor-gap:8px] [--anchor-padding:14px]
    [&_button]:flex [&_button]:justify-start [&_button]:text-left [&_button]:w-full [&_button]:border-0
    [&_button]:bg-transparent [&_button]:rounded-[calc(var(--radius)*0.625)]
    [&_button[data-focus]]:bg-accent absolute top-[calc(100%_+_8px)] right-0 min-w-[215px]
    [&[data-closed]]:invisible [&[data-closed]]:pointer-events-none
    [transition:opacity_120ms,_transform_120ms_var(--ease-out)]
  `),
  message_verificationMenuItems: cn(String.raw`
    message__verification-menu-items z-100 max-w-[calc(100vw_-_28px)] border border-border rounded-2xl
    p-1.5 text-foreground bg-popover shadow-popover [--anchor-gap:8px] [--anchor-padding:14px]
    [&_button]:flex [&_button]:justify-start [&_button]:text-left [&_button]:w-full [&_button]:border-0
    [&_button]:bg-transparent [&_button]:rounded-[calc(var(--radius)*0.625)]
    [&_button[data-focus]]:bg-accent min-w-[215px] [&[data-closed]]:invisible [&[data-closed]]:pointer-events-none
    [transition:opacity_120ms,_transform_120ms_var(--ease-out)]
  `),
  frontSelect_optionsHeading: cn(String.raw`
    front-select__options-heading sticky top-0 z-1 flex items-center justify-between gap-3
    border-b border-border bg-popover px-3 py-2 text-muted-foreground text-[10px] font-medium
  `),
  modelSelector_addProviderName: cn(String.raw`
    model-selector__add-provider-name block py-[9px] px-2.5 text-muted-foreground text-[10px]
    font-semibold
  `),
  frontSelect_option: cn(String.raw`
    front-select__option flex min-h-9 items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-xs leading-5
    [&[data-focus]]:bg-muted [&[data-selected]]:bg-accent [&[data-selected]]:text-primary
    [&[data-disabled]]:opacity-40 [&[data-disabled]]:cursor-not-allowed
  `),
  modelSelector_addOption: cn(String.raw`
    model-selector__add-option p-2.5 rounded-[calc(var(--radius)*0.625)] cursor-pointer text-xs
    [&[data-focus]]:bg-accent [&[data-focus]]:text-primary flex justify-between items-center gap-2.5
  `),
  frontSelect_empty: cn(String.raw`
    front-select__empty p-3.5 text-muted-foreground text-xs
  `),
  conversationActions_delete: cn(String.raw`
    conversation-actions__delete text-destructive
  `),
  workspace_verificationMenu: cn(String.raw`
    workspace__verification-menu relative
  `),
  message_verificationMenu: cn(String.raw`
    message__verification-menu relative
  `),
  fieldSelect: cn(String.raw`
    field-select relative grid content-end gap-1.5 min-w-0
  `),
  fieldSelect_label: cn(String.raw`
    field-select__label block text-muted-foreground text-[11px] leading-4 font-medium
  `),
  fieldSelect_trigger: cn(String.raw`
    field-select__trigger min-w-0 h-10 w-full text-left justify-between py-0 px-3 bg-popover rounded-[calc(var(--radius)*0.75)] text-xs
    [&_>_span]:min-w-0 [&_>_span]:overflow-hidden [&_>_span]:text-ellipsis
  `),
} as const;
