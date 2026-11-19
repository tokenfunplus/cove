export const debateStyles = {
  shell: "flex min-h-0 flex-1 flex-col overflow-hidden bg-card",
  focusShell: "flex min-h-0 flex-1 flex-col overflow-hidden bg-background",
  focusHeader: "shrink-0 border-b border-border/60 bg-card px-4 py-1.5 sm:px-8",
  focusHeaderContent: "mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1",
  focusHeaderActions: "ml-auto flex shrink-0 gap-0.5",
  focusHeading: "mx-auto w-full max-w-5xl",
  focusParticipants: "order-first flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 max-sm:basis-full",
  focusParticipant: "flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs",
  focusParticipantActive: "bg-accent/60 text-primary",
  focusControls: "shrink-0 px-4 py-1.5 sm:px-8",
  focusControlsContent: "mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1",
  focusStatus: "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5",
  focusGrid: "flex min-h-0 flex-1 flex-col",
  focusTranscript: "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 sm:px-8",
  focusReading: "mx-auto w-full max-w-5xl space-y-5",
  focusTurn: "scroll-mt-5 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-7",
  focusTurnActive: "border-primary/35 ring-1 ring-primary/10",
  focusBody: "min-w-0 break-words [&>div]:text-base [&>div]:leading-[1.85] sm:[&>div]:text-[17px]",
  focusComposer: "shrink-0 border-t border-border/60 bg-card px-4 py-2 sm:px-8",
  inputRow: "relative",
  interventionInput: "min-h-10 max-h-32 resize-none overflow-y-auto rounded-xl py-2 pr-12 text-sm leading-5",
  interventionSubmit: "absolute right-1.5 bottom-1.5 size-7 rounded-lg",
  header: "shrink-0 border-b border-border px-5 py-1.5 min-[1100px]:px-8",
  headerContent: "flex flex-wrap items-center justify-between gap-x-3 gap-y-1",
  headerSummary: "flex items-center gap-2 text-xs font-medium text-foreground",
  controls:
    "shrink-0 border-b border-border bg-muted/25 px-5 py-1.5 min-[1100px]:px-8",
  grid: "grid min-h-0 flex-1 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]",
  conversation: "flex min-h-0 min-w-0 flex-col",
  transcript:
    "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 min-[1100px]:px-8",
  turn: "scroll-mt-4 border-b border-border/60 py-4",
  turnHeading: "mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm",
  avatar:
    "flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-accent font-semibold text-primary",
  body: "min-w-0 break-words text-base leading-relaxed",
  footer:
    "mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
  composer:
    "shrink-0 border-t border-border bg-card px-5 py-2 min-[1100px]:px-8",
  notice:
    "rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground",
  sessionNotice: "mt-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground",
  connectionNotice: "mt-2 text-xs leading-relaxed text-muted-foreground [&_summary]:cursor-pointer [&_summary]:py-1 [&_p]:pt-1",
  pending:
    "max-h-28 space-y-2 overflow-auto rounded-xl border border-primary/15 bg-accent/40 p-3 text-sm",
  inspector:
    "hidden min-h-0 overflow-y-auto border-l border-border bg-muted/15 p-4 min-[1100px]:block",
  section: "mb-5 space-y-2",
  position:
    "block w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-xs leading-relaxed",
  dialog: "fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6",
  dialogContent:
    "max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-3xl p-5 sm:p-7",
  form: "mt-5 space-y-5",
  field: "grid gap-2 text-sm font-medium",
  formRow: "grid grid-cols-1 gap-4 sm:grid-cols-2",
  seat: "space-y-3 rounded-2xl border border-border bg-muted/20 p-4",
  select: "w-full min-w-0 [&_[data-slot=select-value]]:truncate",
  hint: "text-xs leading-relaxed text-muted-foreground",
  error:
    "rounded-xl border border-destructive/25 bg-destructive-muted px-4 py-3 text-sm text-destructive",
};
