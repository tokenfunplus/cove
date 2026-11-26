import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Compass,
  Lightbulb,
  PencilLine,
  FileText,
  LoaderCircle,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import {
  cardField,
  cardBlock,
  cardInputSummary,
  cardFallback,
  cardAllocations,
  parseCard,
  validateCardValues,
  type CardAction,
  type CardCase,
  type CardDefinition,
  type CardOption,
  type CardSubmission,
  type CardValues,
} from "@cove/api-contract";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { useInteractiveCard } from "@/hooks/chat/use-interactive-card";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
} from "@/components/ui/disclosure";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";
import { interactiveStyles as styles } from "@/styles/interactive";

import {
  RankingControl,
  SliderControl,
  AllocationControl,
  TextEditorControl,
} from "./RichCardControls";

export type CardContinue = (
  input: CardSubmission,
  question: string,
  callbacks: {
    optimisticBody?: string;
    onAccepted: () => void;
    onFailure: (message: string) => void;
  },
) => void;
export function InteractiveAnswer({
  generationId,
  content,
  reasoning,
  onContinue,
  busy,
  destination,
}: {
  generationId: string;
  content: string;
  reasoning?: string;
  onContinue?: CardContinue;
  busy: boolean;
  destination: string;
}) {
  // Server-side materialization is authoritative. This split is presentation only.
  const block = cardBlock(content);
  return (
    <>
      <AssistantMessage
        content={block?.prose ?? content}
        reasoning={reasoning}
      />
      {block && (
        <InteractiveCard
          key={generationId}
          id={generationId}
          source={block.source}
          fallback={cardFallback(block.json)}
          onContinue={onContinue}
          busy={busy}
          destination={destination}
        />
      )}
    </>
  );
}
function InteractiveCard({
  id,
  source,
  fallback,
  onContinue,
  busy,
  destination,
}: {
  id: string;
  source: string;
  fallback?: string;
  onContinue?: CardContinue;
  busy: boolean;
  destination: string;
}) {
  const [question, setQuestion] = useState("");
  const card = useInteractiveCard(id, Boolean(question.trim()));
  const [expanded, setExpanded] = useState(false);
  const sizeExpandedPanel = useCallback((panel: HTMLDivElement | null) => {
    if (!panel) return;
    const height = panel.offsetHeight;
    if (height > 0)
      panel.style.setProperty("--interactive-panel-height", `${height}px`);
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [ask, setAsk] = useState(false);
  const questionFocusRequested = useRef(false);
  const attachQuestionInput = useCallback(
    (input: HTMLTextAreaElement | null) => {
      if (input && questionFocusRequested.current) {
        questionFocusRequested.current = false;
        input.focus();
      }
    },
    [],
  );
  const [feedback, setFeedback] = useState<string>();
  const scope = useId();
  const choiceRefs = useRef(new Map<string, HTMLElement>());
  const [invalidChoices, setInvalidChoices] = useState<string[]>([]);
  const [textHistory, setTextHistory] = useState<
    Record<string, { past: string[]; future: string[] }>
  >({});
  const run = card.run;
  let definition: CardDefinition | undefined;
  try {
    if (run) definition = parseCard(JSON.stringify(run.definition));
  } catch {
    /* Render a bounded fallback below. */
  }
  if (card.loading)
    return (
      <p role="status" className={styles.hint}>
        Preparing interaction…
      </p>
    );
  if (!definition || !run || !card.draft)
    return (
      <div className={styles.feedback}>
        {fallback && (
          <p className="whitespace-pre-wrap break-words">{fallback}</p>
        )}
        <p role="status">
          This interactive reply is unavailable. You can continue in chat.
        </p>
        <Button
          variant="link"
          onClick={() => void card.reload().catch(() => undefined)}
        >
          Try loading again
        </Button>
        <Disclosure>
          <DisclosureTrigger>View original JSON</DisclosureTrigger>
          <DisclosureContent>
            <pre className="max-h-64 overflow-auto text-xs">{source}</pre>
          </DisclosureContent>
        </Disclosure>
      </div>
    );
  const d = definition;
  const { values, checks } = card.draft;
  const types = new Set(
    Object.values(d.spec.elements).map((element) => element.type),
  );
  const presentation = types.has("TextInput")
    ? { label: "Make it yours", Icon: PencilLine, kind: "studio" }
    : types.has("Ranking")
      ? { label: "Shape your plan", Icon: Compass, kind: "itinerary" }
      : types.has("Slider")
        ? {
            label: "Find your balance",
            Icon: SlidersHorizontal,
            kind: "balance",
          }
        : types.has("Feedback")
          ? { label: "A little challenge", Icon: Lightbulb, kind: "quiz" }
          : { label: "Explore together", Icon: Sparkles, kind: "choice" };
  const hasContinuation = Object.values(d.spec.elements).some(
    (n) => n.on?.press.action === "continue_chat",
  );
  const locked =
    Boolean(run.submitted_batch_id) || submitting || card.preparing;
  const fieldFor = (element: string) =>
    cardField(
      (d.spec.elements[element]?.props.value as { $bindState?: string })
        ?.$bindState,
    );
  const change = (
    field: string,
    value: CardValues[string],
    recordHistory = true,
  ) => {
    if (locked || values[field] === value) return;
    if (recordHistory && d.stateSchema[field]?.maxLength !== undefined) {
      setTextHistory((history) => ({
        ...history,
        [field]: {
          past: [
            ...(history[field]?.past ?? []),
            values[field] as string,
          ].slice(-50),
          future: [],
        },
      }));
    }
    const max = d.stateSchema[field]?.maxItems;
    if (Array.isArray(value) && max !== undefined && value.length > max) {
      setFeedback(
        `Choose at most ${max} ${max === 1 ? "option" : "options"} for this group.`,
      );
      return;
    }
    setInvalidChoices([]);
    const next = { ...values, [field]: value };
    const checked = Object.fromEntries(
      Object.entries(checks).filter(
        ([key, v]) =>
          next[fieldFor(d.spec.elements[key].props.choiceElement as string)] ===
          v,
      ),
    );
    card.edit(next, checked);
    setFeedback(undefined);
  };
  function focusChoice(elementId: string, view: string) {
    choiceRefs.current
      .get(`${view}:${elementId}`)
      ?.querySelector<HTMLElement>(
        '[role="radio"], [role="checkbox"], textarea',
      )
      ?.focus();
  }
  async function dispatch(action: CardAction, view: string) {
    if (locked) return;
    setFeedback(undefined);
    setInvalidChoices([]);
    if (action.action === "reset") {
      setTextHistory({});
      card.edit(structuredClone(d.spec.state), {});
      return;
    }
    if (action.action === "check_answer") {
      const feedbackId = action.params.feedbackElement as string;
      const field = fieldFor(
        d.spec.elements[feedbackId].props.choiceElement as string,
      );
      const value = values[field];
      if (typeof value !== "string" || !value) {
        setFeedback("Choose an answer first.");
        const choiceId = d.spec.elements[feedbackId].props
          .choiceElement as string;
        setInvalidChoices([choiceId]);
        focusChoice(choiceId, view);
        return;
      }
      card.edit(values, { ...checks, [feedbackId]: value });
      return;
    }
    const inDisplayOrder = (key: string): string[] => [
      key,
      ...d.spec.elements[key].children.flatMap(inDisplayOrder),
    ];
    const missing = inDisplayOrder(d.spec.root).filter((key) => {
      const n = d.spec.elements[key];
      if ((n.type !== "Choice" && n.type !== "TextInput") || !n.props.required)
        return false;
      const value = values[fieldFor(key)];
      return typeof value === "string"
        ? !value.trim()
        : !Array.isArray(value) || !value.length;
    });
    if (missing.length && !question.trim()) {
      setInvalidChoices(missing);
      const hasText = missing.some(
        (key) => d.spec.elements[key].type === "TextInput",
      );
      setFeedback(
        hasText && missing.some((key) => d.spec.elements[key].type === "Choice")
          ? "Complete the required fields before continuing."
          : hasText
            ? "Fill in the required text before continuing."
            : missing.length === 1
              ? "Choose an option before continuing."
              : "Choose an option in each required group before continuing.",
      );
      focusChoice(missing[0], view);
      return;
    }
    try {
      validateCardValues(d, values, checks, !question.trim());
      setSubmitting(true);
      const saved = await card.flush();
      if (!onContinue)
        throw new Error(
          "Open this conversation in the main workspace to continue.",
        );
      onContinue(
        {
          ...(question.trim() ? { intent: "discuss" as const } : {}),
          generation_id: id,
          revision: saved?.revision ?? run!.revision,
          values,
          checks,
        },
        question.trim(),
        {
          optimisticBody: cardInputSummary(d, values, question),
          onAccepted: () => {
            setQuestion("");
            setAsk(false);
            void card.reload().catch(() => undefined);
            setSubmitting(false);
          },
          onFailure: (message) => {
            setFeedback(message);
            setSubmitting(false);
          },
        },
      );
    } catch (e) {
      setFeedback(
        e instanceof Error
          ? e.message
          : "Choose the required options before continuing.",
      );
      setSubmitting(false);
    }
  }
  function node(key: string, view: string): ReactNode {
    const n = d.spec.elements[key];
    const p = n.props;
    switch (n.type) {
      case "Card":
        return (
          <div key={key} className={styles.stack}>
            <header className={styles.header}>
              <div className={styles.headerIcon} aria-hidden="true">
                <presentation.Icon />
              </div>
              <div className="min-w-0">
                <div className={styles.eyebrow}>{presentation.label}</div>
                <h3 className={styles.title}>{p.title as string}</h3>
              </div>
            </header>
            {n.children.map((c) => node(c, view))}
          </div>
        );
      case "Text":
        return (
          <p key={key} className="text-sm leading-relaxed">
            {p.content as string}
          </p>
        );
      case "Reveal":
        return (
          <Disclosure key={key} className={styles.reveal}>
            <DisclosureTrigger>{p.label as string}</DisclosureTrigger>
            <DisclosureContent>
              {n.children.map((c) => node(c, view))}
            </DisclosureContent>
          </Disclosure>
        );
      case "Ranking":
        return (
          <RankingControl
            key={key}
            label={p.label as string}
            options={p.options as CardOption[]}
            value={values[fieldFor(key)] as string[]}
            locked={locked}
            onChange={(value) => change(fieldFor(key), value)}
          />
        );
      case "Slider": {
        const field = fieldFor(key);
        const schema = d.stateSchema[field];
        return (
          <SliderControl
            key={key}
            label={p.label as string}
            unit={p.unit as string | undefined}
            value={values[field] as number}
            minimum={schema.minimum!}
            maximum={schema.maximum!}
            step={schema.step!}
            locked={locked}
            onChange={(value) => change(field, value)}
          />
        );
      }
      case "AllocationSummary": {
        const result = cardAllocations(d, values)[key];
        return (
          <AllocationControl key={key} label={p.label as string} {...result} />
        );
      }
      case "TextInput": {
        const field = fieldFor(key);
        const history = textHistory[field] ?? { past: [], future: [] };
        const restore = (direction: "past" | "future") => {
          const source = history[direction];
          if (!source.length || locked) return;
          const restored = source[source.length - 1];
          setTextHistory((current) => ({
            ...current,
            [field]:
              direction === "past"
                ? {
                    past: source.slice(0, -1),
                    future: [...history.future, values[field] as string].slice(
                      -50,
                    ),
                  }
                : {
                    past: [...history.past, values[field] as string].slice(-50),
                    future: source.slice(0, -1),
                  },
          }));
          change(field, restored, false);
        };
        return (
          <div
            key={key}
            ref={(element) => {
              const refKey = `${view}:${key}`;
              if (element) choiceRefs.current.set(refKey, element);
              else choiceRefs.current.delete(refKey);
            }}
          >
            <TextEditorControl
              id={`${scope}-${view}-${key}`}
              label={p.label as string}
              placeholder={p.placeholder as string | undefined}
              value={values[field] as string}
              maxLength={d.stateSchema[field].maxLength!}
              locked={locked}
              invalid={invalidChoices.includes(key)}
              errorId={`${scope}-${view}-error`}
              canUndo={Boolean(history.past.length)}
              canRedo={Boolean(history.future.length)}
              onChange={(value) => change(field, value)}
              onUndo={() => restore("past")}
              onRedo={() => restore("future")}
            />
          </div>
        );
      }
      case "TextPreview":
        return (
          <section
            key={key}
            aria-label={p.label as string}
            className={styles.preview}
          >
            <h4 className="mb-4 flex items-center gap-2 border-b border-border pb-3 text-[10px] font-semibold uppercase tracking-widest text-primary">
              <FileText aria-hidden="true" className="size-4" />
              {p.label as string}
            </h4>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">
              {(values[fieldFor(key)] as string) ||
                "Your text preview appears here."}
            </p>
          </section>
        );
      case "Choice": {
        const field = fieldFor(key);
        const options = p.options as CardOption[];
        const label =
          (p.label as string | undefined) ??
          (p.mode === "single" ? "Choose an option" : "Choose any that apply");
        if (p.mode === "single")
          return (
            <fieldset
              key={key}
              className="grid gap-2"
              ref={(element) => {
                const refKey = `${view}:${key}`;
                if (element) choiceRefs.current.set(refKey, element);
                else choiceRefs.current.delete(refKey);
              }}
              aria-invalid={invalidChoices.includes(key) || undefined}
              aria-describedby={
                invalidChoices.includes(key)
                  ? `${scope}-${view}-error`
                  : undefined
              }
            >
              <legend className="mb-3 text-sm font-medium">{label}</legend>
              <RadioGroup
                className={styles.choiceGroup}
                value={values[field] as string}
                disabled={locked}
                aria-label={label}
                onValueChange={(v) => change(field, v)}
              >
                {options.map((o, index) => (
                  <RadioCard
                    key={o.value}
                    value={o.value}
                    className={styles.choice}
                  >
                    <span aria-hidden="true" className={styles.choiceMark}>
                      <span
                        className={styles.choiceIndex}
                        data-letter={String.fromCharCode(65 + index)}
                      />
                      <Check className={styles.choiceCheck} />
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      <span className="block font-medium leading-snug">
                        {o.label}
                      </span>
                      {o.description && (
                        <span className="mt-1 block text-sm text-muted-foreground group-data-[state=checked]/radio:text-primary-foreground/85">
                          {o.description}
                        </span>
                      )}
                    </span>
                  </RadioCard>
                ))}
              </RadioGroup>
            </fieldset>
          );
        return (
          <fieldset
            key={key}
            className="grid gap-2"
            ref={(element) => {
              const refKey = `${view}:${key}`;
              if (element) choiceRefs.current.set(refKey, element);
              else choiceRefs.current.delete(refKey);
            }}
            aria-invalid={invalidChoices.includes(key) || undefined}
            aria-describedby={
              invalidChoices.includes(key)
                ? `${scope}-${view}-error`
                : undefined
            }
          >
            <legend className="mb-3 text-sm font-medium">{label}</legend>
            {options.map((o) => {
              const controlId = `${scope}-${view}-${key}-${o.value}`;
              const selected = (values[field] as string[]).includes(o.value);
              return (
                <label
                  key={o.value}
                  htmlFor={controlId}
                  className={styles.multiChoice}
                  data-selected={selected}
                  data-locked={locked}
                >
                  <Checkbox
                    id={controlId}
                    disabled={locked}
                    checked={selected}
                    onCheckedChange={(checked) =>
                      change(
                        field,
                        checked
                          ? [...(values[field] as string[]), o.value]
                          : (values[field] as string[]).filter(
                              (v) => v !== o.value,
                            ),
                      )
                    }
                  />
                  <span>
                    <span className="block font-medium">{o.label}</span>
                    {o.description && (
                      <span className="block text-sm text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      }
      case "Feedback": {
        const value = checks[key];
        const result = (p.cases as CardCase[]).find((c) => c.value === value);
        return result ? (
          <div
            key={`${key}:${value}`}
            role="status"
            className={styles.feedback}
          >
            <strong className="flex items-center gap-2 text-primary">
              {result.outcome === "correct" ? (
                <CheckCheck aria-hidden="true" className="size-4" />
              ) : (
                <Lightbulb aria-hidden="true" className="size-4" />
              )}
              {result.outcome === "correct" ? "Correct" : "Try another answer"}
            </strong>
            <p>{result.text}</p>
          </div>
        ) : null;
      }
      case "Button": {
        const action = n.on?.press;
        return action ? (
          <Button
            key={key}
            className={styles.action}
            variant={action.action === "continue_chat" ? "default" : "outline"}
            disabled={
              locked ||
              (action.action === "continue_chat" &&
                (busy || !run!.can_continue || !onContinue))
            }
            onClick={() => void dispatch(action, view)}
          >
            {submitting && action.action === "continue_chat"
              ? "Starting…"
              : (p.label as string)}
            {action.action === "continue_chat" && (
              <ArrowUpRight aria-hidden="true" className="size-4" />
            )}
          </Button>
        ) : null;
      }
    }
  }
  const paths = new Set(
    Object.values(d.spec.elements).flatMap((n) =>
      n.on?.press.action === "continue_chat"
        ? (n.on.press.params.paths as string[])
        : [],
    ),
  );
  const labels = Object.values(d.spec.elements).flatMap((n) => {
    if (n.type !== "Choice") return [];
    const binding = (n.props.value as { $bindState: string }).$bindState;
    if (!paths.has(binding)) return [];
    const chosen = values[cardField(binding)];
    return (n.props.options as CardOption[])
      .filter((o) =>
        Array.isArray(chosen) ? chosen.includes(o.value) : chosen === o.value,
      )
      .map((o) => o.label);
  });
  const notices = (view: string) => (
    <>
      {(feedback || card.error) && (
        <p
          id={`${scope}-${view}-error`}
          role="alert"
          className="mt-2 text-sm text-destructive"
        >
          {feedback || card.error}
        </p>
      )}
      {card.error && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void card.flush().catch(() => undefined)}
          >
            Retry save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void card
                .reload()
                .then(() => {
                  setTextHistory({});
                  setInvalidChoices([]);
                  setFeedback(undefined);
                })
                .catch(() => undefined)
            }
          >
            Reload and discard local changes
          </Button>
        </div>
      )}
    </>
  );
  const body = (view: string, includeNotices = true) => (
    <>
      {node(d.spec.root, view)}
      {ask && !locked && (
        <label className="mt-3 grid gap-2 text-sm">
          Question about these choices
          <Textarea
            ref={attachQuestionInput}
            value={question}
            maxLength={4000}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What would you like to explore?"
          />
        </label>
      )}
      {run.submitted_batch_id && question.trim() && (
        <div className={styles.feedback}>
          <p>Unsent question: {question}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuestion("");
              setAsk(false);
            }}
          >
            Dismiss unsent question
          </Button>
        </div>
      )}
      {labels.length > 0 && (
        <p className="sr-only" role="status">
          Selected: {labels.join("; ")}
        </p>
      )}
      <div className={styles.footer}>
        <div className={styles.footerControls}>
          <span role="status" className={styles.status}>
            {card.saving ? (
              <LoaderCircle
                aria-hidden="true"
                className="motion-safe:animate-spin"
              />
            ) : (
              <Check aria-hidden="true" />
            )}
            {run.submitted_batch_id
              ? "Choice saved in conversation"
              : card.saving
                ? "Saving…"
                : card.dirty
                  ? "Unsaved changes"
                  : "Saved on this Mac"}
          </span>
          {!locked && hasContinuation && (
            <Button
              variant="ghost"
              size="sm"
              className={styles.footerQuestion}
              onClick={() => {
                if (ask) setQuestion("");
                else questionFocusRequested.current = true;
                setAsk(!ask);
              }}
            >
              {ask ? "Remove question" : "Ask about this"}
            </Button>
          )}
          <Disclosure className={styles.details}>
            <DisclosureTrigger>Reply details</DisclosureTrigger>
            <DisclosureContent>{destination}</DisclosureContent>
          </Disclosure>
        </div>
      </div>
      {!hasContinuation && (
        <p className={styles.hint}>Local interaction. No message is sent.</p>
      )}
      {hasContinuation && !run.can_continue && !run.submitted_batch_id && (
        <p className={styles.hint}>
          This card belongs to an earlier or unselected answer. You can explore
          it locally.
        </p>
      )}
      {includeNotices && notices(view)}
    </>
  );
  return (
    <section
      className={styles.card}
      aria-label="Interactive reply"
      data-kind={presentation.kind}
    >
      <div
        className="h-1 bg-gradient-to-r from-primary/70 via-primary/20 to-transparent"
        aria-hidden="true"
      />
      <div className={styles.content}>
        {expanded ? (
          <p className={styles.hint}>Interaction open in expanded view.</p>
        ) : (
          body("inline")
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Expand
          </Button>
        </div>
      </div>
      <Dialog
        open={expanded}
        onClose={() => setExpanded(false)}
        label={d.spec.elements[d.spec.root].props.title as string}
        className={styles.expandedPortal}
      >
        <DialogOverlay />
        <DialogContent
          ref={sizeExpandedPanel}
          className={styles.expandedContent}
        >
          <div className={styles.expandedBody}>{body("expanded", false)}</div>
          {(feedback || card.error) && (
            <div className={styles.expandedNotice}>{notices("expanded")}</div>
          )}
          <Button
            className="mt-4 shrink-0 self-start"
            variant="outline"
            onClick={() => setExpanded(false)}
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
