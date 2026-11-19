export const debateStyles = {
  shell: "flex min-h-0 flex-1 flex-col overflow-hidden bg-card",
  focusShell: "flex min-h-0 flex-1 flex-col overflow-hidden bg-background",
  focusHeader: "shrink-0 border-b border-border/60 bg-card px-4 py-3 sm:px-8",
  focusHeading: "mx-auto w-full max-w-5xl",
  focusTopic: "mt-2 break-words text-xl font-semibold tracking-tight text-foreground sm:text-2xl",
  focusParticipants: "mt-4 grid grid-cols-2 gap-2 sm:gap-3",
  focusParticipant: "flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5",
  focusParticipantActive: "border-primary/35 bg-accent/60",
  focusControls: "flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8",
  focusGrid: "flex min-h-0 flex-1 flex-col",
  focusTranscript: "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 sm:px-8",
  focusReading: "mx-auto w-full max-w-5xl space-y-5",
  focusTurn: "scroll-mt-5 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-7",
  focusTurnActive: "border-primary/35 ring-1 ring-primary/10",
  focusBody: "min-w-0 break-words [&>div]:text-base [&>div]:leading-[1.85] sm:[&>div]:text-[17px]",
  focusComposer: "shrink-0 border-t border-border/60 bg-card px-4 py-3 sm:px-8",
  header: "shrink-0 border-b border-border px-5 py-5 min-[1100px]:px-8",
  topic:
    "mt-2 max-w-4xl break-words text-2xl font-medium tracking-tight text-foreground",
  eyebrow: "text-xs font-semibold uppercase tracking-[.16em] text-primary",
  tags: "mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground",
  tag: "rounded-lg border border-border bg-muted/40 px-2.5 py-1",
  controls:
    "flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/25 px-5 py-3 min-[1100px]:px-8",
  grid: "grid min-h-0 flex-1 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]",
  conversation: "flex min-h-0 min-w-0 flex-col",
  transcript:
    "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 min-[1100px]:px-8",
  turn: "scroll-mt-4 border-b border-border/60 py-5",
  turnHeading: "mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm",
  avatar:
    "flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-accent font-semibold text-primary",
  body: "min-w-0 break-words text-base leading-relaxed",
  footer:
    "mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
  composer:
    "shrink-0 space-y-2 border-t border-border bg-card px-5 py-4 min-[1100px]:px-8",
  notice:
    "rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground",
  pending:
    "max-h-28 space-y-2 overflow-auto rounded-xl border border-primary/15 bg-accent/40 p-3 text-sm",
  inspector:
    "hidden min-h-0 overflow-y-auto border-l border-border bg-muted/15 p-5 min-[1100px]:block",
  section: "mb-7 space-y-3",
  position:
    "block w-full rounded-xl border border-border bg-card p-3 text-left text-sm leading-relaxed",
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
