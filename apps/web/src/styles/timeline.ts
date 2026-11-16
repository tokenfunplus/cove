export const timelineStyles = {
  viewport: "relative flex min-h-0 flex-1",
  messages: "pr-12 max-[767px]:pr-11",
  rail: "absolute right-1.5 top-1/2 z-20 flex max-h-[calc(100%-24px)] w-8 -translate-y-1/2 flex-col rounded-full max-[767px]:right-1",
  markers: "flex min-h-0 flex-col overflow-y-auto overscroll-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  marker: "group relative flex h-6 min-h-6 w-8 items-center justify-end rounded-sm px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  line: "h-0.5 w-3 rounded-full bg-muted-foreground/35 transition-all duration-150 group-hover:w-5 group-hover:bg-foreground/70 group-focus-visible:w-5 group-focus-visible:bg-foreground motion-reduce:transition-none data-[active=true]:w-6 data-[active=true]:bg-foreground",
  saved: "absolute left-0 top-1/2 size-1 -translate-y-1/2 rounded-full bg-muted-foreground",
  // The transparent hit area bridges the gap between a marker and its preview.
  preview: "relative z-40 w-[min(292px,calc(100vw-56px))] rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-popover outline-none after:absolute after:inset-y-0 after:w-2 after:content-[''] data-[side=left]:after:-right-2 data-[side=right]:after:-left-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-1 duration-150",
  previewHeader: "flex items-start gap-2.5",
  title: "min-w-0 flex-1 text-xs font-medium leading-5 [overflow-wrap:anywhere] line-clamp-2",
  bookmark: "size-7 rounded-md p-0 text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-muted",
  excerpt: "mt-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere] line-clamp-4",
  foot: "mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2 text-[10px] text-muted-foreground",
  jump: "h-6 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground",
} as const;
