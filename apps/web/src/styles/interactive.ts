import { cn } from "@/lib/utils";

// Card interactions keep text-bearing surfaces still during pointer presses.
const stableButtonPress =
  "[&_[data-slot=button]:active:not([aria-haspopup])]:translate-y-0";

export const interactiveStyles = {
  card: cn(
    "group/interaction @container my-5 min-w-0 overflow-hidden rounded-3xl border border-primary/20 bg-card text-card-foreground shadow-panel [&_p]:whitespace-pre-wrap [&_p]:break-words",
    stableButtonPress,
  ),
  content: "p-5 @md:p-6",
  expandedPortal: "fixed inset-0 z-50 grid place-items-center p-4",
  expandedContent: cn(
    "flex h-[var(--interactive-panel-height,auto)] max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl p-5 sm:p-6",
    stableButtonPress,
  ),
  expandedBody:
    "min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
  expandedNotice:
    "mt-3 max-h-[35dvh] shrink-0 overflow-y-auto rounded-xl border border-destructive/20 bg-destructive-muted/30 p-3 [&_[role=alert]]:mt-0",
  stack:
    "group/canvas grid min-w-0 gap-5 @md:grid-cols-2 [&>*]:col-span-full @md:[&>[data-card-control=slider]]:col-span-1",
  header:
    "relative isolate flex min-w-0 items-center gap-4 overflow-hidden rounded-2xl border border-primary/10 bg-linear-to-br from-accent via-accent/40 to-peach/60 p-5 after:pointer-events-none after:absolute after:-right-8 after:-top-10 after:-z-10 after:size-40 after:rounded-full after:border-[24px] after:border-primary/5",
  headerIcon:
    "grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm [&_svg]:size-6",
  eyebrow:
    "mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary",
  title: "text-xl font-semibold leading-tight tracking-tight @md:text-2xl",
  hint: "text-xs leading-relaxed text-muted-foreground",
  choiceGroup: "grid min-w-0 gap-3 @md:grid-cols-2",
  choice: cn(
    "flex min-h-24 min-w-0 items-center gap-4 rounded-2xl border border-border bg-background/60 p-4 text-sm transition-[background-color,border-color,box-shadow] duration-250",
    "enabled:hover:border-primary/50 enabled:hover:shadow-panel enabled:active:shadow-sm",
    "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-panel disabled:opacity-100",
  ),
  choiceMark:
    "relative grid size-10 shrink-0 place-items-center rounded-xl bg-accent font-mono text-sm font-semibold text-primary transition-[background-color,color] duration-300 group-data-[state=checked]/radio:bg-primary-foreground/20 group-data-[state=checked]/radio:text-primary-foreground",
  choiceCheck:
    "absolute size-5 scale-0 -rotate-45 opacity-0 transition-[scale,rotate,opacity] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-data-[state=checked]/radio:scale-100 group-data-[state=checked]/radio:rotate-0 group-data-[state=checked]/radio:opacity-100",
  choiceIndex:
    "before:content-[attr(data-letter)] transition-opacity group-data-[state=checked]/radio:opacity-0",
  multiChoice:
    "flex min-w-0 cursor-pointer items-start gap-3 rounded-2xl border border-border bg-background/60 p-4 text-sm transition-[background-color,border-color,box-shadow] duration-250 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring data-[selected=true]:border-primary data-[selected=true]:bg-accent data-[selected=true]:shadow-sm data-[locked=true]:cursor-default data-[locked=false]:hover:border-primary/40",
  feedback:
    "grid gap-3 rounded-2xl border border-primary/20 bg-linear-to-br from-accent to-card p-5 text-sm leading-relaxed motion-safe:animate-[cove-unfold_320ms_ease-out]",
  reveal:
    "rounded-2xl border border-dashed border-border-strong bg-background/35 p-3 text-sm [&_[data-slot=disclosure-trigger]]:font-medium [&_[data-slot=disclosure-content]]:pt-3 [&_[data-state=open][data-slot=disclosure-content]]:motion-safe:animate-[cove-unfold_220ms_ease-out]",
  footer: "@container/footer mt-5 border-t border-border/70 pt-3",
  footerControls:
    "grid grid-cols-2 items-start gap-x-3 gap-y-2 @md/footer:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]",
  footerQuestion:
    "col-start-1 row-start-2 justify-self-start @md/footer:col-start-2 @md/footer:row-start-1 @md/footer:justify-self-center",
  status:
    "col-span-full flex min-h-8 min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground @md/footer:col-span-1 [&_svg]:size-3 [&_svg]:shrink-0",
  details:
    "col-start-2 row-start-2 min-w-0 text-[11px] leading-4 text-muted-foreground @md/footer:col-start-3 @md/footer:row-start-1 [&_[data-slot=disclosure-trigger]]:ml-auto [&_[data-slot=disclosure-trigger]]:min-h-8 [&_[data-slot=disclosure-trigger]]:w-fit [&_[data-slot=disclosure-content]]:break-words [&_[data-slot=disclosure-content]]:pt-2",
  action:
    "group/action justify-self-start gap-3 rounded-full px-6 py-5 shadow-sm transition-[background-color,box-shadow] duration-200 enabled:hover:shadow-panel enabled:active:shadow-sm [&_svg]:transition-[translate] enabled:hover:[&_svg]:translate-x-0.5 enabled:hover:[&_svg]:-translate-y-0.5",
  ranking: "grid min-w-0 gap-3",
  rankingList:
    "relative grid gap-2.5 before:absolute before:bottom-4 before:left-7 before:top-4 before:w-px before:bg-primary/25",
  rankingItem:
    "relative flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-background/50 p-3 shadow-sm transition-[border-color,box-shadow,background-color,rotate,scale] duration-200 first:border-primary/30 first:bg-accent/40 data-[dragging=true]:z-10 data-[dragging=true]:border-primary data-[dragging=true]:bg-accent data-[dragging=true]:shadow-popover motion-safe:data-[dragging=true]:-rotate-1 motion-safe:data-[dragging=true]:scale-[1.02]",
  rankingNumber:
    "z-[1] grid size-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-accent font-mono text-sm font-semibold tabular-nums text-primary",
  dragHandle:
    "grid size-11 shrink-0 touch-none place-items-center rounded-lg text-muted-foreground cursor-grab outline-none transition-colors hover:bg-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing [&_svg]:size-4",
  slider:
    "group/slider grid min-w-0 gap-4 rounded-2xl border border-primary/15 bg-linear-to-br from-accent/40 to-card p-5 transition-[border-color,box-shadow] duration-200 focus-within:border-primary/60 focus-within:shadow-panel",
  sliderValue:
    "rounded-xl bg-accent px-3 py-1.5 font-mono text-xl font-semibold tracking-tight tabular-nums text-primary transition-colors duration-200 group-focus-within/slider:bg-primary group-focus-within/slider:text-primary-foreground",
  sliderTrack:
    "[&>span:first-child]:h-2.5 [&>span:first-child]:bg-primary/10 [&_[role=slider]]:size-5 [&_[role=slider]]:transition-[scale,box-shadow] [&_[role=slider]]:duration-200 [&_[role=slider]]:hover:scale-125 [&_[role=slider]]:active:scale-125",
  stepButton: "size-8 shrink-0 rounded-full bg-card p-0",
  allocation:
    "relative grid gap-5 overflow-hidden rounded-2xl border border-primary/25 bg-linear-to-br from-accent via-accent/50 to-card p-5 text-sm data-[over=true]:border-destructive/35 data-[over=true]:from-destructive-muted data-[over=true]:via-destructive-muted/50",
  balance:
    "block break-words font-mono text-2xl font-semibold tracking-tight tabular-nums data-[over=true]:text-destructive",
  gauge:
    "relative grid size-20 shrink-0 place-items-center text-primary data-[over=true]:text-destructive",
  gaugeSvg: "absolute inset-0 size-full -rotate-90 overflow-visible",
  gaugeFill:
    "transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none",
  progress:
    "h-3 w-full appearance-none overflow-hidden rounded-full border-0 bg-primary/10 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-primary/10 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-500 [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary data-[over=true]:[&::-webkit-progress-value]:bg-destructive data-[over=true]:[&::-moz-progress-bar]:bg-destructive",
  editor:
    "grid min-w-0 gap-3 rounded-2xl border border-primary/15 bg-accent/30 p-5 transition-[border-color,box-shadow] duration-200 focus-within:border-primary/60 focus-within:shadow-panel",
  preview:
    "relative min-w-0 rounded-2xl border border-border bg-card p-5 shadow-panel transition-[border-color,box-shadow] duration-250 before:absolute before:bottom-5 before:left-0 before:top-5 before:w-1 before:rounded-full before:bg-primary/40 group-has-[textarea:focus]/canvas:border-primary/50 group-has-[textarea:focus]/canvas:shadow-popover",
};
