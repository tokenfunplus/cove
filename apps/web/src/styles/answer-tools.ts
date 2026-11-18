export const answerToolsStyles = {
  layout: "flex min-h-0 flex-1 overflow-hidden",
  main: "answer-tools-main flex min-h-0 min-w-0 flex-1 flex-col",
  panel:
    "flex min-h-0 w-[min(46vw,620px)] shrink-0 flex-col border-l border-border bg-card max-[900px]:absolute max-[900px]:inset-0 max-[900px]:z-30 max-[900px]:w-full",
  header:
    "flex items-center justify-between gap-2 border-b border-border px-4 py-3",
  tabs: "flex gap-1 border-b border-border px-3 py-2",
  body: "min-h-0 flex-1 overflow-y-auto overscroll-contain p-4",
  quote:
    "max-h-32 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-primary bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
  footer: "space-y-3 border-t border-border p-4",
  actions: "flex flex-wrap items-center gap-1.5 py-2",
  toolbar:
    "fixed z-40 flex max-w-[calc(100vw-24px)] flex-wrap gap-1 rounded-xl border border-border bg-popover p-1 shadow-popover",
  editor:
    "min-h-64 w-full flex-1 resize-none rounded-xl border border-border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring",
  hint: "text-xs leading-relaxed text-muted-foreground",
  stats:
    "mt-2 rounded-xl border border-border bg-muted/20 text-xs [&_summary]:cursor-pointer [&_summary]:px-3 [&_summary]:py-2",
  statGrid:
    "grid grid-cols-2 gap-x-4 gap-y-3 p-3 [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:font-medium",
};
