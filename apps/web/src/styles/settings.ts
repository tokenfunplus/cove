import { cn } from "@/lib/utils";

// Tailwind recipes for settings presentation. Semantic colors come from theme/tokens.css.
export const settingsStyles = {
  prov_foot: cn(
    String.raw`prov__foot flex flex-wrap gap-2 p-[17px] border-t border-border [&_button]:text-xs [&_button[type="submit"]]:ml-auto`,
  ),
  settingsDialog: cn(String.raw`
    settings-dialog relative z-70
  `),
  conversationDialog: cn(String.raw`
    conversation-dialog relative z-70
  `),
  privacyStatusDialog: cn(String.raw`
    privacy-status-dialog relative z-70 z-65 [&_.conversation-dialog\_\_viewport]:justify-end
    [&_.conversation-dialog\_\_viewport]:p-3.5 max-[767px]:[&_.conversation-dialog\_\_viewport]:p-2
  `),
  settingsDialog_backdrop: cn(String.raw`
    settings-dialog__backdrop fixed inset-0 bg-foreground/40 [backdrop-filter:blur(7px)]
  `),
  conversationDialog_backdrop: cn(String.raw`
    conversation-dialog__backdrop fixed inset-0 bg-foreground/40 [backdrop-filter:blur(7px)]
  `),
  settingsDialog_viewport: cn(String.raw`
    settings-dialog__viewport fixed inset-0 flex items-center justify-center overflow-y-auto p-6
    max-[767px]:p-2.5 z-10
  `),
  conversationDialog_viewport: cn(String.raw`
    conversation-dialog__viewport fixed inset-0 flex items-center justify-center overflow-y-auto p-6
    max-[767px]:p-2.5 z-10
  `),
  settingsDialog_layer: cn(String.raw`
    w-full max-w-[1000px] border-0 bg-transparent shadow-none
  `),
  settingsDialog_panel: cn(String.raw`
    settings-dialog__panel flex flex-col w-full max-w-[1000px] h-[min(780px,_calc(100dvh_-_48px))]
    bg-card border border-border rounded-[calc(var(--radius)*1.875)] shadow-popover overflow-clip
    max-[767px]:h-[calc(100dvh_-_20px)] max-[767px]:rounded-[calc(var(--radius)*1.4375)]
    animate-[cove-rise_230ms_var(--ease-out)_both]
  `),
  settingsDialog_header: cn(String.raw`
    settings-dialog__header flex items-center gap-3 py-4 px-6.5 border-b border-border shrink-0
    [&_.eyebrow]:mb-1 [&_h2]:text-xl max-[767px]:p-4.5
  `),
  settingsDialog_mark: cn(String.raw`
    settings-dialog__mark w-9.5 h-9.5 p-2 rounded-[calc(var(--radius)*0.875)] bg-accent text-primary
  `),
  settingsDialog_close: cn(String.raw`
    settings-dialog__close ml-auto w-8.5 h-8.5 p-0 bg-muted border-0 rounded-[calc(var(--radius)*0.75)]
  `),
  settingsDialog_content: cn(String.raw`
    settings-dialog__content grid grid-cols-[200px_minmax(0,_1fr)] min-h-0 flex-1 max-[767px]:flex
    max-[767px]:flex-col
  `),
  settingsDialog_navigation: cn(String.raw`
    settings-dialog__navigation flex shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3
    [&_button]:h-10 [&_button]:justify-start [&_button]:gap-2.5 [&_button]:rounded-lg [&_button]:px-3
    [&_button]:font-medium [&_button]:text-[13px] [&_button]:text-muted-foreground
    [&_button[aria-selected="true"]]:bg-accent [&_button[aria-selected="true"]]:text-primary
    max-[767px]:flex-row max-[767px]:overflow-x-auto max-[767px]:border-r-0 max-[767px]:border-b max-[767px]:p-2
    max-[767px]:[&_button]:shrink-0 max-[767px]:[&_button]:justify-center max-[767px]:[&_button]:gap-1.5
    max-[767px]:[&_button]:px-1 max-[767px]:[&_button]:text-xs
  `),
  settingsDialog_sections: cn(String.raw`
    settings-dialog__sections min-h-0 flex-1 overflow-y-auto min-w-0 p-6.5 [&_>_.settings-dialog\_\_section]:hidden
    [&[data-active-settings-section="general"]_>_[data-settings-section="general"]]:block
    [&[data-active-settings-section="provider"]_>_[data-settings-section="provider"]]:block
    [&[data-active-settings-section="local-models"]_>_[data-settings-section="local-models"]]:block
    [&[data-active-settings-section="network"]_>_[data-settings-section="network"]]:block
    [&[data-active-settings-section="web-search"]]:scroll-pb-36
    [&[data-active-settings-section="web-search"]_>_[data-settings-section="web-search"]]:block
    [&[data-active-settings-section="chat-data"]_>_[data-settings-section="chat-data"]]:block
    max-[767px]:py-5 max-[767px]:px-4.5
  `),
  workspaceSettings_heading: cn(String.raw`
    workspace-settings__heading flex justify-between items-center gap-3 mb-[9px] [&_h2]:text-xl
  `),
  providerSettings_heading: cn(String.raw`
    provider-settings__heading flex justify-between items-center gap-3 mb-[9px] [&_h2]:text-xl
  `),
  chatData_heading: cn(String.raw`
    chat-data__heading flex justify-between items-center gap-3 mb-[9px] [&_h2]:text-xl
  `),
  settingsSection_lede: cn(String.raw`
    settings-section__lede text-muted-foreground text-xs leading-[1.8] mb-6
  `),
  workspaceSettings_row: cn(String.raw`
    workspace-settings__row grid grid-cols-[minmax(0,_1fr)_auto] gap-[7px_15px] items-center border-b
    border-border py-[17px] px-0 [&:first-child]:pt-0 max-[767px]:grid-cols-1
  `),
  workspaceSettings_rowKey: cn(String.raw`
    workspace-settings__row-key [&_span]:text-xs [&_span]:font-semibold [&_small]:hidden
  `),
  workspaceSettings_rowDetail: cn(String.raw`
    workspace-settings__row-detail col-start-1 text-xs leading-relaxed text-muted-foreground
  `),
  workspaceSettings_rowControl: cn(String.raw`
    workspace-settings__row-control col-start-2 row-start-1 row-end-3 flex flex-wrap gap-2 text-xs
    max-[767px]:col-start-1 max-[767px]:[grid-row:auto]
  `),
  seg: cn(String.raw`
    seg flex rounded-[calc(var(--radius)*0.75)] bg-muted p-1 [&_button]:bg-transparent
    [&_button]:border-0 [&_button]:rounded-[calc(var(--radius)*0.5625)] [&_button]:text-[11px]
    [&_button]:py-[7px] [&_button]:px-[11px] [&_.is-on]:text-primary [&_.is-on]:bg-popover
    [&_.is-on]:[box-shadow:0_2px_5px_color-mix(in_srgb,var(--foreground)_7%,transparent)]
  `),
  workspaceSettings_prompt: cn(String.raw`
    workspace-settings__prompt grid gap-[9px] text-xs font-[550] pt-5.5 [&_small]:font-normal
    [&_textarea]:font-normal [&_textarea]:text-xs
  `),
  workspaceSettings_parameters: cn(String.raw`
    workspace-settings__parameters [margin:20px_0_0] p-4 border border-border
    rounded-[calc(var(--radius)*1.125)] [&_legend]:text-xs [&_legend]:font-[550] [&_legend]:px-[5px]
  `),
  workspaceSettings_parameterFields: cn(String.raw`
    workspace-settings__parameter-fields grid grid-cols-3 gap-3 mt-3 max-[420px]:grid-cols-1 [&_label]:grid [&_label]:gap-[7px]
    [&_label]:text-[11px] [&_input]:py-[9px] [&_input]:px-2.5
    [&_input]:rounded-[calc(var(--radius)*0.6875)]
  `),
  workspaceSettings_actions: cn(String.raw`
    workspace-settings__actions flex justify-end mt-5 [&_button]:bg-primary
    [&_button]:text-primary-foreground [&_button]:[border-color:transparent]
    [&_button:hover:not(:disabled)]:bg-primary-hover
  `),
  providerStatus: cn(String.raw`
    provider-status rounded-full py-[5px] px-[9px] text-[11px] bg-muted text-muted-foreground text-center
    [&.provider-status--configured]:bg-accent [&.provider-status--configured]:text-success
    [&.provider-status--failed]:bg-destructive-muted [&.provider-status--failed]:text-destructive
  `),
  prov: cn(String.raw`
    prov overflow-hidden border border-border rounded-[calc(var(--radius)*1.375)] bg-popover
  `),
  prov_head: cn(String.raw`
    prov__head flex items-center gap-2 flex-wrap p-[17px] bg-accent
  `),
  prov_sq: cn(String.raw`
    prov__sq w-[9px] h-[9px] rounded-[calc(var(--radius)*0.1875)] bg-primary
  `),
  prov_name: cn(String.raw`
    prov__name text-[13px] font-semibold
  `),
  prov_kind: cn(String.raw`
    prov__kind ml-auto text-[11px] text-primary
  `),
  prov_status: cn(String.raw`
    prov__status w-full flex items-center gap-1.5 text-[11px] text-muted-foreground mt-[3px]
  `),
  prov_body: cn(String.raw`
    prov__body grid gap-4 p-5 [&_>_label]:grid [&_>_label]:grid-cols-[115px_minmax(0,_1fr)]
    [&_>_label]:items-center [&_>_label]:gap-2 [&_>_label]:text-[11px] [&_>_.front-select]:grid
    [&_>_.front-select]:grid-cols-[115px_minmax(0,_1fr)] [&_>_.front-select]:items-center
    [&_>_.front-select]:gap-2 [&_>_.front-select]:text-[11px] [&_label]:text-[11px]
    [&_label]:tracking-[0] [&_label]:[text-transform:none] [&_label]:font-medium [&_input]:text-xs
    [&_input]:rounded-[calc(var(--radius)*0.75)] [&_button]:text-xs
    [&_button]:rounded-[calc(var(--radius)*0.75)] [&_input]:py-2.5 [&_.front-select\_\_input]:px-8
    max-[767px]:p-[15px] max-[767px]:[&_>_label]:grid-cols-1
    max-[767px]:[&_>_.front-select]:grid-cols-1 [&_>_.field-select]:grid-cols-[115px_minmax(0,_1fr)]
    [&_>_.field-select]:items-center [&_>_.field-select]:gap-x-2
    [&_>_.field-select:not(:has(>_.field-select\_\_label))]:grid-cols-1
    max-[767px]:[&_>_.field-select]:grid-cols-1
  `),
  specLine: cn(String.raw`
    spec-line grid grid-cols-[115px_minmax(0,_1fr)] gap-2 text-[11px] items-center m-0 [&_dd]:m-0
    [&_dd]:text-muted-foreground max-[767px]:grid-cols-1
  `),
  rotate: cn(String.raw`
    rotate border-t border-border bg-muted py-4.5 px-5 [&:not(.is-open)]:hidden [&_label]:grid
    [&_label]:gap-2 [&_label]:text-[11px]
  `),
  rotate_label: cn(String.raw`
    rotate__label text-xs font-semibold mb-3
  `),
  rotate_hint: cn(String.raw`
    rotate__hint mt-2.5 text-[10px] text-muted-foreground leading-[1.7]
  `),
  providerSettings_message: cn(String.raw`
    provider-settings__message py-3 px-[15px] text-xs leading-[1.7] mt-4
    rounded-[calc(var(--radius)*0.8125)] border border-border
    [&.provider-settings\_\_message--success]:text-success
    [&.provider-settings\_\_message--success]:bg-accent
    [&.provider-settings\_\_message--error]:text-destructive
    [&.provider-settings\_\_message--error]:bg-destructive-muted
  `),
  workspaceSettings_message: cn(String.raw`
    workspace-settings__message py-3 px-[15px] text-xs leading-[1.7] mt-4
    rounded-[calc(var(--radius)*0.8125)] border border-border
    [&.workspace-settings\_\_message--success]:text-success
    [&.workspace-settings\_\_message--success]:bg-accent
    [&.workspace-settings\_\_message--error]:text-destructive
    [&.workspace-settings\_\_message--error]:bg-destructive-muted
  `),
  dataStats: cn(String.raw`
    data-stats grid grid-cols-2 my-4 divide-x divide-border rounded-lg border border-border bg-popover
  `),
  dataStats_cell: cn(String.raw`
    data-stats__cell flex flex-col p-3.5
  `),
  dataStats_k: cn(String.raw`
    data-stats__k text-xs text-muted-foreground
  `),
  dataStats_v: cn(String.raw`
    data-stats__v my-1 text-xl font-semibold tabular-nums
  `),
  dataStats_s: cn(String.raw`
    data-stats__s text-[11px] text-muted-foreground
  `),
  chatData_export: cn(String.raw`
    chat-data__export grid-cols-[1fr] [&_.workspace-settings\_\_row-control]:col-start-1
    [&_.workspace-settings\_\_row-control]:[grid-row:auto]
    [&_.workspace-settings\_\_row-control]:pt-[7px]
  `),
  chatData_conversations: cn(String.raw`
    chat-data__conversations mt-6 [&_h3]:mb-3.5 [&_ul]:p-0 [&_ul]:m-0 [&_ul]:list-none [&_li]:flex
    [&_li]:items-center [&_li]:gap-3 [&_li]:py-[11px] [&_li]:px-0 [&_li]:border-b border-border
    [&_li_button]:text-destructive [&_li_button]:text-[10px] [&_li_button]:py-1.5 [&_li_button]:px-2
  `),
  chatData_conversationCopy: cn(String.raw`
    chat-data__conversation-copy min-w-0 flex-1 [&_strong]:block [&_strong]:whitespace-nowrap
    [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:text-xs [&_strong]:font-medium
    [&_time]:text-muted-foreground [&_time]:text-[9px]
  `),
  chatData_empty: cn(String.raw`
    chat-data__empty text-xs text-muted-foreground
  `),
  danger: cn(String.raw`
    danger flex items-center justify-between flex-wrap gap-3.5 mt-6 p-[17px]
    rounded-[calc(var(--radius)*1.125)] bg-destructive-muted
    [border:1px_solid_color-mix(in_srgb,_var(--destructive)_20%,_transparent)] [&_>_div]:flex-1
    [&_>_div]:min-w-[150px] [&_button]:text-[10px]
  `),
  danger_t: cn(String.raw`
    danger__t text-xs text-destructive font-semibold mb-1.5
  `),
  danger_d: cn(String.raw`
    danger__d text-[10px] text-muted-foreground leading-[1.7]
  `),
  conversationDialog_panel: cn(String.raw`
    conversation-dialog__panel w-full max-w-[460px] max-h-[calc(100dvh_-_48px)] overflow-y-auto p-7
    border border-border rounded-[calc(var(--radius)*1.75)] bg-card text-foreground shadow-popover
    [&_>_h2]:text-[21px] [&_>_h2]:mb-3 [&_>_p]:text-xs [&_>_p]:leading-[1.8]
    [&_>_p]:text-muted-foreground [&_form]:grid [&_form]:gap-3 [&_form]:mt-[15px] [&_form]:text-xs
    [&_form_>_label]:grid [&_form_>_label]:gap-[9px] max-[767px]:p-[23px]
    max-[767px]:rounded-[calc(var(--radius)*1.4375)] max-[767px]:max-h-[calc(100dvh_-_20px)]
    [&.privacy-status-panel]:p-0 [&.privacy-status-panel]:w-full [&.privacy-status-panel]:max-w-[430px]
    [&.privacy-status-panel]:h-full [&.privacy-status-panel]:max-h-none
    [&.privacy-status-panel]:overflow-hidden animate-[cove-rise_230ms_var(--ease-out)_both]
  `),
  conversationDialog_actions: cn(String.raw`
    conversation-dialog__actions flex justify-end flex-wrap gap-2 mt-6
  `),
  confirmationDialog_icon: cn(String.raw`
    confirmation-dialog__icon grid place-items-center w-11 h-11 mb-4.5 text-peach-foreground bg-peach
    rounded-[calc(var(--radius)*1)]
  `),
  confirmationDialog_confirm: cn(String.raw`
    confirmation-dialog__confirm bg-primary text-primary-foreground border-0
    [&.confirmation-dialog\_\_confirm--danger]:text-destructive
    [&.confirmation-dialog\_\_confirm--danger]:bg-destructive-muted
  `),
} as const;
