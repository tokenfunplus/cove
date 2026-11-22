import { cn } from "@/lib/utils";

const sidebarRow = String.raw`
  flex justify-start w-full min-h-[43px] text-left py-2.5 pr-[35px] pl-[11px] border
  border-transparent rounded-[calc(var(--radius)*0.8125)] bg-transparent
  font-normal h-auto shadow-none
`;

// Tailwind recipes for workspace presentation. Semantic colors come from theme/tokens.css.
export const workspaceStyles = {
  focusSurface: "surface h-[100dvh] bg-background",
  focusWorkspace: "workspace h-full w-full overflow-hidden bg-card",
  focusBody: "workspace__body grid h-full grid-cols-1",
  focusHeader: "workspace__header relative flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2 max-[500px]:px-3",
  focusIdentity: "workspace__header-identity flex min-w-0 flex-1 items-center gap-2.5",
  focusBadge: "shrink-0 rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-primary",
  focusTitle: "masthead__title min-w-0 truncate text-xs font-medium",
  focusModel: "hidden max-w-[30vw] truncate border-l border-border pl-2.5 text-[11px] text-muted-foreground min-[768px]:block",
  focusUtilities: "workspace__header-utilities flex shrink-0 items-center gap-1.5",
  focusEnter: "workspace__focus-enter size-10 p-0 rounded-[calc(var(--radius)*0.75)] shadow-none max-[500px]:w-9",
  focusExit: "workspace__focus-exit h-8 gap-1.5 rounded-lg px-2.5 text-xs shadow-none",
  workspace_privacyStatus: cn(
    String.raw`workspace__privacy-status h-auto rounded-full bg-transparent px-2.5 py-[7px] text-[10px] shadow-none [&[data-privacy-tone="confidential"]]:bg-accent [&[data-privacy-tone="confidential"]]:text-primary [&[data-privacy-tone="gateway"]]:bg-accent [&[data-privacy-tone="gateway"]]:text-primary max-[980px]:size-8 max-[980px]:p-0 max-[980px]:[&>span]:hidden`,
  ),
  mobileSidebarDialog_panel: cn(
    String.raw`mobile-sidebar-dialog__panel fixed inset-y-2.5 left-2.5 w-[min(300px,calc(100vw-35px))] rounded-[calc(var(--radius)*1.625)] border border-border shadow-popover animate-[cove-sidebar_260ms_var(--ease-out)_both]`,
  ),
  surface: cn(String.raw`
    surface h-[100dvh] p-[var(--shell-pad,18px)]
    [background:radial-gradient(_ellipse_at_10%_0%,_color-mix(in_srgb,_var(--ambient)_65%,_transparent),_transparent_45%_),_var(--background)]
    max-[1100px]:p-2.5 max-[980px]:p-0
  `),
  workspace: cn(String.raw`
    workspace h-full max-w-[1800px] m-auto border border-border rounded-[var(--shell-radius,calc(var(--radius)*2.6))] overflow-hidden bg-card
    shadow-panel max-[1100px]:rounded-[calc(var(--radius)*1.5625)] max-[980px]:border-0
    max-[980px]:rounded-none
  `),
  workspace_body: cn(String.raw`
    workspace__body h-full grid grid-cols-[var(--panel-width,254px)_minmax(0,_1fr)]
    [transition:grid-template-columns_260ms_var(--ease-out)]
    [&.workspace\_\_body--sidebar-collapsed]:grid-cols-[70px_minmax(0,_1fr)]
    max-[1100px]:grid-cols-[230px_minmax(0,_1fr)]
    max-[1100px]:[&.workspace\_\_body--sidebar-collapsed]:grid-cols-[70px_minmax(0,_1fr)]
    max-[980px]:grid-cols-1 max-[980px]:[&.workspace\_\_body--sidebar-collapsed]:grid-cols-1
  `),
  workspace_main: cn(String.raw`
    workspace__main relative min-w-0 min-h-0 flex flex-col
  `),
  conversationSidebar: cn(String.raw`
    conversation-sidebar bg-sidebar border-r border-border flex flex-col min-h-0 [padding:22px_16px_14px]
    overflow-hidden [&.conversation-sidebar--collapsed]:px-[13px]
    [&.conversation-sidebar--collapsed_.workspace-sidebar\_\_brand]:flex-col
    [&.conversation-sidebar--collapsed_.workspace-sidebar\_\_brand]:gap-4
    [&.conversation-sidebar--collapsed_.workspace-sidebar\_\_identity_>_div:last-child]:hidden
    [&.conversation-sidebar--collapsed_.conversation-list]:hidden
    [&.conversation-sidebar--collapsed_.conversation-list\_\_search]:hidden
    [&.conversation-sidebar--collapsed_.conversation-list\_\_empty]:hidden
    [&.conversation-sidebar--collapsed_.history-toolbar]:hidden
    [&.conversation-sidebar--collapsed_.history-filter-chips]:hidden
    [&.conversation-sidebar--collapsed_.conversation-list-shell_:is(button,a)_>_span]:hidden
    [&.conversation-sidebar--collapsed_.conversation-list-shell_:is(button,a)]:justify-center
    [&.conversation-sidebar--collapsed_.conversation-list-shell_:is(button,a)]:px-0
  `),
  workspaceSidebar_brand: cn(String.raw`
    workspace-sidebar__brand flex items-center justify-between gap-2 [padding:0_2px_24px] shrink-0
  `),
  workspaceSidebar_identity: cn(String.raw`
    workspace-sidebar__identity flex items-center gap-2.5 min-w-0 [&_strong]:text-base
    [&_strong]:tracking-[-0.04em] [&_strong]:whitespace-nowrap [&_.eyebrow]:text-[9px]
    [&_.eyebrow]:mt-[3px] [&_.eyebrow]:whitespace-nowrap
  `),
  brandMark: cn(String.raw`
    brand-mark w-9.5 h-9.5 text-primary shrink-0
  `),
  workspaceSidebar_toggle: cn(String.raw`
    workspace-sidebar__toggle p-[7px] border-0 bg-transparent text-muted-foreground shrink-0 h-auto
    shadow-none
  `),
  conversationListShell: cn(String.raw`
    conversation-list-shell min-h-0 flex-1 flex flex-col
  `),
  conversationList_new: cn(String.raw`
    conversation-list__new w-full rounded-2xl p-3 text-primary-foreground bg-primary
    [border-color:transparent] [box-shadow:0_7px_14px_-10px_var(--primary)]
    enabled:hover:bg-primary-hover enabled:hover:text-primary-foreground
    shadow-none
  `),
  conversationList_search: cn(String.raw`
    conversation-list__search flex items-center gap-[7px] border border-border
    rounded-[calc(var(--radius)*0.75)] py-0 px-[9px] [margin:13px_0_17px]
    [background:color-mix(in_srgb,_var(--card)_65%,_transparent)] text-muted-foreground
    [&_input]:border-0 [&_input]:bg-transparent [&_input]:py-2.5 [&_input]:px-0 [&_input]:text-[11px]
    [&_input]:rounded-none [&_input]:shadow-none focus-within:[outline:2px_solid_var(--ring)]
    focus-within:[outline-offset:2px] [&_kbd]:text-[9px] [&_kbd]:whitespace-nowrap
  `),
  conversationList: cn(String.raw`
    conversation-list flex-1 min-h-0 overflow-y-auto my-0 mx-[-5px] py-0 px-[5px]
  `),
  conversationList_group: cn(String.raw`
    conversation-list__group mb-4.5
  `),
  conversationList_sectionLabel: cn(String.raw`
    conversation-list__section-label text-[10px] font-[550] text-muted-foreground [padding:0_10px_7px]
  `),
  conversationRow: cn(String.raw`
    conversation-row relative mb-[3px]
  `),
  projectNavigation: cn("project-navigation", sidebarRow, "mb-2 gap-2 aria-[current=page]:bg-accent aria-[current=page]:text-primary aria-[current=page]:font-semibold"),
  conversation: cn("conversation", sidebarRow, String.raw`
    [&.conversation--selected]:bg-accent [&.conversation--selected]:text-primary [&.conversation--selected]:font-semibold
  `),
  conversation_title: cn(String.raw`
    conversation__title text-[13px] overflow-hidden text-ellipsis whitespace-nowrap
  `),
  conversationActions: cn(String.raw`
    conversation-actions absolute right-[3px] top-1.5
  `),
  conversationActions_trigger: cn(String.raw`
    conversation-actions__trigger w-7.5 h-7.5 p-0 border-0 bg-transparent text-muted-foreground
    shadow-none
  `),
  conversationList_footer: cn(String.raw`
    conversation-list__footer mt-auto pt-3 border-t border-border grid gap-0.5
  `),
  conversationList_privacy: cn(String.raw`
    conversation-list__privacy h-9 w-full justify-start gap-[9px] rounded-lg border-0 bg-transparent px-3 text-xs text-muted-foreground shadow-none
  `),
  conversationList_archiveToggle: cn(String.raw`
    conversation-list__archive-toggle flex justify-start gap-[9px] text-muted-foreground py-[9px] px-3
    border-0 bg-transparent text-xs no-underline rounded-[calc(var(--radius)*0.75)]
    [&[aria-pressed="true"]]:text-primary [&[aria-pressed="true"]]:bg-accent h-9 shadow-none
  `),
  conversationList_settings: cn(String.raw`
    conversation-list__settings flex justify-start gap-[9px] text-muted-foreground py-[9px] px-3 border-0
    bg-transparent text-xs no-underline rounded-[calc(var(--radius)*0.75)] h-9 shadow-none
  `),
  conversationList_feedback: cn(String.raw`
    conversation-list__feedback flex h-9 items-center justify-start gap-[9px] text-muted-foreground py-[9px] px-3 border-0
    bg-transparent text-xs no-underline rounded-[calc(var(--radius)*0.75)] [&:hover]:bg-accent
  `),
  conversationList_empty: cn(String.raw`
    conversation-list__empty py-3.5 px-2.5 text-muted-foreground text-xs
  `),
  workspace_header: cn(String.raw`
    workspace__header shrink-0 relative grid grid-cols-[minmax(80px,_1fr)_auto] items-center gap-3.5
    [padding:var(--header-pad,20px_28px_16px)] border-b border-border max-[1100px]:py-4 max-[1100px]:px-5
    max-[980px]:grid-cols-[32px_minmax(0,_1fr)_auto] max-[980px]:[padding:14px_16px_12px]
    max-[980px]:gap-[12px_8px]
  `),
  masthead_eyebrow: cn(String.raw`
    masthead__eyebrow [font-family:var(--label-font,inherit)] text-[10px] text-muted-foreground mb-1 [&_i]:hidden max-[980px]:text-[9px]
  `),
  masthead_title: cn(String.raw`
    masthead__title [font-family:var(--heading-font,inherit)] text-[17px] font-semibold tracking-[-0.025em] overflow-hidden whitespace-nowrap
    text-ellipsis max-[980px]:text-[15px]
  `),
  workspace_headerIdentity: cn(String.raw`
    workspace__header-identity min-w-0
  `),
  workspace_headerModel: cn(String.raw`
    workspace__header-model row-start-2 col-span-full min-w-0 max-[980px]:col-span-full
  `),
  workspace_headerUtilities: cn(String.raw`
    workspace__header-utilities col-start-2 [grid-row:1] flex gap-2 items-center
    max-[980px]:[grid-column:3] max-[980px]:gap-[5px]
  `),
  themeBtn: cn(String.raw`
    theme-btn border-0 w-8.5 h-8.5 p-0 bg-muted rounded-[calc(var(--radius)*0.75)] shadow-none
  `),
  masthead_sidebarOpen: cn(String.raw`
    masthead__sidebar-open border-0 w-8.5 h-8.5 p-0 bg-muted rounded-[calc(var(--radius)*0.75)]
  `),
  workspace_privateConnection: cn(String.raw`
    workspace__private-connection py-[7px] px-2.5 text-[10px] rounded-full bg-transparent
    max-[1100px]:[&_>_span]:hidden max-[980px]:[&_>_svg:last-child]:hidden max-[980px]:w-8
    max-[980px]:h-8 max-[980px]:p-0 h-auto shadow-none
  `),
  mobileSidebarDialog: cn(String.raw`
    mobile-sidebar-dialog relative z-60
  `),
  mobileSidebarDialog_backdrop: cn(String.raw`
    mobile-sidebar-dialog__backdrop fixed inset-0 bg-foreground/35 [backdrop-filter:blur(5px)]
  `),
  masthead_connection: cn(String.raw`
    masthead__connection max-[1100px]:hidden
  `),
} as const;
