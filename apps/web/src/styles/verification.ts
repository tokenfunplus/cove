import { cn } from "@/lib/utils";

// Tailwind recipes for verification presentation. Semantic colors come from theme/tokens.css.
export const verificationStyles = {
  message_verificationLink: "h-auto min-h-6 gap-1 rounded-sm px-0 py-0 text-[11px] font-medium text-inherit underline decoration-dotted underline-offset-4 shadow-none hover:bg-transparent hover:text-current hover:decoration-solid cursor-pointer",
  viewer_summary: "cursor-pointer text-sm font-medium",
  viewer_details: "mt-4 rounded-lg border border-border p-3",
  viewer_notice: "mb-4 text-xs text-muted-foreground",
  viewer_title: "text-lg font-semibold",
  viewer_heading: "mb-3 flex items-center justify-between gap-3",
  viewer_iframe: "min-h-0 w-full flex-1 rounded-lg border-0",
  viewer_status: "text-sm text-muted-foreground",
  viewer_overlay: "absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center",
  viewer_frame: "relative flex h-[min(65dvh,640px)] min-h-64 flex-col overflow-hidden rounded-xl border border-border bg-white p-3 sm:p-5 dark:bg-card",
  viewer_empty: "my-4 text-sm text-muted-foreground",
  message_verificationLanes: cn(String.raw`
    message__verification-lanes flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground
    [&_ul]:list-none [&_ul]:m-0 [&_ul]:p-0
  `),
  message_verificationState: cn(String.raw`
    inline-flex shrink-0 items-center gap-1.5 font-medium
    data-[status=verified]:text-success data-[status=failed]:text-destructive
    [&+ul]:border-l [&+ul]:border-border-strong [&+ul]:pl-2
  `),
  message_verificationTrigger: cn(String.raw`
    message__verification-trigger mt-1 h-7 gap-1.5 rounded-md border-0 bg-transparent text-muted-foreground text-[11px] font-medium px-1.5 -ml-1.5 shadow-none hover:text-foreground hover:bg-muted
  `),
  verificationDialog_panel: cn(String.raw`
    verification-dialog__panel w-full max-w-[740px]
  `),
  verificationDialog_topline: cn(String.raw`
    verification-dialog__topline flex items-center justify-between gap-2 mb-5.5
  `),
  signatureDialog_heading: cn(String.raw`
    signature-dialog__heading flex items-center justify-between gap-2 mb-5.5 [&_h2]:text-[22px]
  `),
  verificationDialog_tabs: cn(String.raw`
    verification-dialog__tabs flex p-1 rounded-[calc(var(--radius)*0.8125)] bg-muted [&_button]:border-0
    [&_button]:bg-transparent [&_button]:text-[11px] [&_.is-active]:bg-popover
    [&_.is-active]:text-primary
    [&_.is-active]:[box-shadow:0_2px_6px_color-mix(in_srgb,var(--foreground)_7%,transparent)]
    max-[767px]:[&_button]:text-[10px] max-[767px]:[&_button]:p-2
  `),
  verificationDialog_close: cn(String.raw`
    verification-dialog__close w-[33px] h-[33px] p-0 border-0 bg-muted
    rounded-[calc(var(--radius)*0.6875)] text-xl shrink-0
  `),
  signatureDialog_close: cn(String.raw`
    signature-dialog__close w-[33px] h-[33px] p-0 border-0 bg-muted rounded-[calc(var(--radius)*0.6875)]
    text-xl shrink-0
  `),
  privacyStatusPanel_close: cn(String.raw`
    privacy-status-panel__close w-[33px] h-[33px] p-0 border-0 bg-muted
    rounded-[calc(var(--radius)*0.6875)] text-xl shrink-0
  `),
  verificationDialog_identity: cn(String.raw`
    verification-dialog__identity [&_>_p]:text-[10px] [&_>_p]:text-primary [&_>_p]:mb-2 [&_h2]:text-2xl
    [&_h2]:leading-[1.3]
  `),
  verificationDialog_provider: cn(String.raw`
    verification-dialog__provider inline-block mt-1.5 text-muted-foreground text-xs
  `),
  verificationDialog_hint: cn(String.raw`
    verification-dialog__hint my-4 mx-0 text-xs text-muted-foreground leading-[1.8]
  `),
  verificationDialog_empty: cn(String.raw`
    verification-dialog__empty my-4 mx-0 text-xs text-muted-foreground leading-[1.8]
  `),
  verificationDialog_evidenceList: cn(String.raw`
    verification-dialog__evidence-list grid gap-2.5
  `),
  verificationDialog_evidenceCard: cn(String.raw`
    verification-dialog__evidence-card border border-border rounded-[calc(var(--radius)*1.0625)]
    bg-popover p-4 [&_summary]:flex [&_summary]:items-center [&_summary]:justify-between
    [&_summary]:text-xs [&_summary]:font-[550] [&_summary_strong]:text-primary
    [&_summary_strong]:text-[11px] [&_p]:text-[11px] [&_p]:text-muted-foreground [&_p]:mt-[13px]
    [&_p]:leading-[1.7] [&_pre]:text-[10px] [&_pre]:p-[13px] [&_pre]:mt-3
    [&_pre]:rounded-[calc(var(--radius)*0.6875)] [&_pre]:bg-muted [&_pre]:max-h-[300px]
    [&_pre]:overflow-auto
  `),
  verificationDialog_facts: cn(String.raw`
    verification-dialog__facts grid gap-2 [margin:14px_0_0] [&_>_div]:grid
    [&_>_div]:grid-cols-[125px_minmax(0,_1fr)] [&_>_div]:gap-3 [&_>_div]:text-[11px]
    [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:[overflow-wrap:anywhere]
  `),
  verificationDialog_quoteLabel: cn(String.raw`
    verification-dialog__quote-label flex items-center justify-between gap-2.5 mt-3 text-[11px]
  `),
  verificationDialog_related: cn(String.raw`
    verification-dialog__related text-[10px] text-muted-foreground leading-[1.8] mt-3
  `),
  signatureDialog_panel: cn(String.raw`
    signature-dialog__panel w-full max-w-[680px]
  `),
  signatureDialog_success: cn(String.raw`
    signature-dialog__success flex items-center gap-2.5 p-4 text-success bg-accent
    rounded-[calc(var(--radius)*1.0625)] mb-5 [&_span]:grid [&_span]:gap-[5px] [&_span]:flex-1
    [&_strong]:text-xs [&_small]:text-[10px] [&_small]:text-primary [&_code]:text-[9px]
    max-[767px]:flex-wrap
  `),
  signatureDialog_fields: cn(String.raw`
    signature-dialog__fields m-0 grid gap-3.5
  `),
  signatureDialog_fact: cn(String.raw`
    signature-dialog__fact flex justify-between gap-3.5 text-[11px] [&_dt]:text-muted-foreground
    [&_dd]:m-0
  `),
  signatureDialog_field: cn(String.raw`
    signature-dialog__field [&_dt]:flex [&_dt]:items-center [&_dt]:justify-between [&_dt]:text-[11px]
    [&_dt]:mb-1.5 [&_dd]:m-0 [&_button]:py-1.5 [&_button]:px-2 [&_button]:text-[10px] [&_pre]:p-3.5
    [&_pre]:rounded-[calc(var(--radius)*0.8125)] [&_pre]:text-[10px] [&_pre]:leading-[1.7]
    [&_pre]:max-h-[200px] [&_pre]:overflow-auto [&_pre]:bg-muted
  `),
  signatureDialog_notes: cn(String.raw`
    signature-dialog__notes mt-5 text-muted-foreground text-[10px] leading-[1.8] [&_p_+_p]:mt-2
  `),
  privacyStatusPanel: cn(String.raw`
    privacy-status-panel flex flex-col w-full max-w-[430px] min-h-0 bg-card border border-border
    rounded-[calc(var(--radius)*1.625)] shadow-popover overflow-hidden
    max-[767px]:rounded-[calc(var(--radius)*1.4375)] animate-[cove-drawer_260ms_var(--ease-out)_both]
  `),
  privacyStatusPanel_head: cn(String.raw`
    privacy-status-panel__head flex items-center justify-between gap-3 p-5 border-b border-border max-[767px]:p-5
  `),
  privacyStatusPanel_title: cn(String.raw`
    privacy-status-panel__title text-[23px]
  `),
  privacyStatusPanel_body: cn(String.raw`
    privacy-status-panel__body overflow-y-auto flex-1 min-h-0 p-5.5
  `),
  seal: cn(String.raw`
    seal p-4.5 rounded-[calc(var(--radius)*1.25)] bg-accent mb-6 [&.seal--unverified]:bg-peach
    [&.seal--partial]:bg-peach [&[data-attested="false"]]:bg-peach
  `),
  seal_row: cn(String.raw`
    seal__row flex items-center gap-2.5
  `),
  seal_icon: cn(String.raw`
    seal__icon grid place-items-center w-9.5 h-9.5 rounded-[calc(var(--radius)*0.875)] bg-popover
    text-primary shrink-0
  `),
  seal_t: cn(String.raw`
    seal__t text-sm font-semibold
  `),
  seal_d: cn(String.raw`
    seal__d text-xs text-muted-foreground leading-[1.8] mt-[5px]
  `),
  dsec: cn(String.raw`
    dsec mb-[23px]
  `),
  dsec_title: cn(String.raw`
    dsec__title mb-2 text-sm font-semibold
  `),
  dsec_stat: cn(String.raw`
    dsec__stat flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs
    text-muted-foreground mb-2.5 [&_>_b]:text-foreground [&_>_b]:text-xl [&_>_b]:tracking-[-0.04em]
    [&_i]:text-xs [&_i]:not-italic
  `),
  drow: cn(String.raw`
    drow flex gap-[7px] items-center text-xs py-[9px] px-0 border-b border-border
    text-muted-foreground [&_b]:text-foreground [&_b]:font-medium [&_code]:ml-auto [&_code]:text-[9px]
    [&_code]:text-primary
  `),
  privacyStatusPanel_messages: cn(String.raw`
    privacy-status-panel__messages text-[11px] [&_summary]:py-[9px] [&_summary]:px-0 [&_ul]:list-none
    [&_ul]:p-0
  `),
  privacyStatusPanel_message: cn(String.raw`
    privacy-status-panel__message border border-border rounded-[calc(var(--radius)*0.8125)] mt-2.5 p-3
    [&_summary]:grid [&_summary]:gap-[5px] [&_summary]:[overflow-wrap:anywhere]
    [&_summary_span:nth-child(2)]:text-muted-foreground [&_summary_span:nth-child(2)]:text-[9px]
    [&_summary_span[role="status"]]:text-primary [&_summary_span[role="status"]]:text-[9px]
  `),
  privacyStatusPanel_messageBody: cn(String.raw`
    privacy-status-panel__message-body max-h-[180px] overflow-auto text-[11px] leading-[1.8]
    whitespace-pre-wrap my-2.5 mx-0
  `),
  privacyStatusPanel_messageActions: cn(String.raw`
    privacy-status-panel__message-actions flex flex-wrap gap-1.5 [&_button]:py-[7px] [&_button]:px-[9px]
    [&_button]:text-[9px]
  `),
  privacyStatusPanel_hint: cn(String.raw`
    privacy-status-panel__hint text-[9px] leading-[1.8] text-muted-foreground
  `),
  privacyStatusPanel_foot: cn(String.raw`
    privacy-status-panel__foot text-[11px] leading-[1.8] text-muted-foreground border-t border-border
    py-3.5 px-5.5
  `),
  privateConnectionProgress: cn(String.raw`
    private-connection-progress fixed z-55 right-7.5 bottom-7.5 w-[min(410px,_calc(100vw_-_36px))]
    rounded-[calc(var(--radius)*1.5)] p-6 border border-border bg-popover shadow-popover [&_h2]:text-lg
    [&_h2]:leading-[1.5] max-[767px]:right-4.5 max-[767px]:bottom-4.5
    animate-[cove-rise_230ms_var(--ease-out)_both]
  `),
  privateConnectionProgress_close: cn(String.raw`
    private-connection-progress__close absolute top-2.5 right-2.5 border-0 bg-transparent py-1 px-2
  `),
  privateConnectionProgress_identity: cn(String.raw`
    private-connection-progress__identity text-[9px] text-muted-foreground [margin:4px_20px_12px_0]
  `),
  privateConnectionProgress_steps: cn(String.raw`
    private-connection-progress__steps grid gap-3.5 list-none p-0 [margin:20px_0_0] [&_li]:flex
    [&_li]:items-center [&_li]:gap-2.5 [&_li]:text-[11px] [&_li]:text-muted-foreground
    [&_[data-state="complete"]]:text-success
    [&_[data-state="complete"]_.private-connection-progress\_\_marker]:bg-accent
    [&_[data-state="failed"]]:text-destructive
    [&_[data-state="active"]_.private-connection-progress\_\_marker]:[border:2px_solid_var(--border)]
    [&_[data-state="active"]_.private-connection-progress\_\_marker]:[border-top-color:var(--primary)]
    [&_[data-state="active"]_.private-connection-progress\_\_marker]:animate-[cove-spin_1.4s_linear_infinite]
  `),
  privateConnectionProgress_marker: cn(String.raw`
    private-connection-progress__marker grid place-items-center w-5.5 h-5.5 rounded-full bg-muted
    text-[10px]
  `),
  privateConnectionProgress_details: cn(String.raw`
    private-connection-progress__details mt-4.5
  `),
  privateGenerationProgress: cn(String.raw`
    private-generation-progress min-w-0 text-xs text-muted-foreground
    [&_>_p]:flex [&_>_p]:items-center [&_>_p]:gap-2 [&_>_p]:leading-relaxed [&_>_p]:text-foreground
    [&_ol]:mt-2.5 [&_ol]:grid [&_ol]:gap-1.5 [&_ol]:border-l [&_ol]:border-border [&_ol]:pl-3
    [&_li]:flex [&_li]:items-center [&_li]:gap-2 [&_li_>_span]:text-[10px] [&_li_>_span]:tabular-nums
    [&_[data-state=complete]]:text-success [&_[data-state=active]]:text-foreground
    [&.private-generation-progress--compact_ol]:hidden
  `),
  privateGenerationProgress_spinner: cn(String.raw`
    private-generation-progress__spinner inline-block w-[13px] h-[13px]
    [border:2px_solid_var(--border-strong)] [border-top-color:var(--primary)] rounded-full shrink-0
    animate-[cove-spin_1.4s_linear_infinite]
  `),
} as const;
