import { useEffect, useRef, useState } from "react";
import type {
  DebateRole,
  DebateRules,
  DebateSeat,
  ProviderProfile,
} from "@cove/api-contract";
import type {
  ActiveModelSet,
  ModelCatalogs,
} from "@/components/providers/model-selection";
import { useCreateDebate } from "@/api/hooks/useDebates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { debateCopy as copy } from "@/messages/debate";
import { debateStyles as styles } from "@/styles/debate";
import { Plus, X } from "lucide-react";

export const defaultDebateRules: DebateRules = {
  version: 1,
  text: copy.defaultRules,
  max_tokens: 1024,
  checkpoint_every: 3,
  rotate: true,
};

export function DebateSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className={styles.select}>
        <SelectValue placeholder="Choose a model" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DebateRulesFields({
  rules,
  onChange,
}: {
  rules: DebateRules;
  onChange: (rules: DebateRules) => void;
}) {
  return (
    <>
      <label className={styles.field}>
        {copy.rules}
        <Textarea
          aria-label={copy.rules}
          value={rules.text}
          maxLength={6000}
          rows={5}
          required
          onChange={(event) => onChange({ ...rules, text: event.target.value })}
        />
      </label>
      <div className={styles.formRow}>
        <div className={styles.field}>
          <span>Output token limit per turn</span>
          <DebateSelect
            label="Output token limit per turn"
            value={String(rules.max_tokens)}
            onChange={(value) =>
              onChange({
                ...rules,
                max_tokens: Number(value) as DebateRules["max_tokens"],
              })
            }
            options={[512, 1024, 2048].map((value) => ({
              value: String(value),
              label: `${value} tokens`,
            }))}
          />
        </div>
        <div className={styles.field}>
          <span>Checkpoint cadence</span>
          <DebateSelect
            label="Checkpoint cadence"
            value={String(rules.checkpoint_every)}
            onChange={(value) =>
              onChange({ ...rules, checkpoint_every: Number(value) })
            }
            options={[1, 2, 3, 5, 10].map((value) => ({
              value: String(value),
              label: `Every ${value} round${value === 1 ? "" : "s"}`,
            }))}
          />
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={rules.rotate}
          onChange={(event) =>
            onChange({ ...rules, rotate: event.target.checked })
          }
        />
        Rotate the first speaker each round
      </label>
    </>
  );
}

export function DebateSetupDialog({
  open,
  onClose,
  profiles,
  catalogs,
  activeModelSet,
  onStarted,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  profiles: ProviderProfile[];
  catalogs: ModelCatalogs;
  activeModelSet: ActiveModelSet;
  onStarted: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const create = useCreateDebate();
  const [topic, setTopic] = useState("");
  const [rules, setRules] = useState(defaultDebateRules);
  const [seats, setSeats] = useState<DebateSeat[]>([]);
  const requestId = useRef(crypto.randomUUID());
  const initialized = useRef(false);
  const options = profiles
    .filter((profile) => profile.configured)
    .flatMap((profile) =>
      (catalogs[profile.id]?.models ?? []).map((model) => ({
        value: JSON.stringify([profile.id, model]),
        label: `${profile.name} · ${catalogs[profile.id]?.metadata?.[model]?.name ?? model}`,
        provider_id: profile.id,
        model_id: model,
      })),
    );
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (initialized.current || options.length === 0) return;
    initialized.current = true;
    const selected = [
      ...activeModelSet
        .map((target) =>
          options.find(
            (option) =>
              option.provider_id === target.providerId &&
              option.model_id === target.modelId,
          ),
        )
        .filter((option) => option !== undefined),
      ...options,
    ];
    const unique = selected
      .filter(
        (option, index, all) =>
          all.findIndex((other) => other.value === option.value) === index,
      )
      .slice(0, Math.max(2, activeModelSet.length));
    setSeats(
      unique.map((option, index) => ({
        provider_id: option.provider_id,
        model_id: option.model_id,
        role: copy.roles[index % 4]!,
      })),
    );
    requestId.current = crypto.randomUUID();
    create.reset();
  }, [open, options.map((option) => option.value).join("|"), activeModelSet]);
  const canStart =
    seats.length >= 2 &&
    seats.every((seat) =>
      options.some(
        (option) =>
          option.provider_id === seat.provider_id &&
          option.model_id === seat.model_id,
      ),
    ) &&
    new Set(
      seats.map((seat) => JSON.stringify([seat.provider_id, seat.model_id])),
    ).size === seats.length;
  const browserRequired = seats.some((seat) => profiles.some((profile) => profile.id === seat.provider_id && profile.kind === "nearai"));
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!create.isPending) onClose();
      }}
      className={styles.dialog}
    >
      <DialogOverlay />
      <DialogContent className={styles.dialogContent}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>{copy.setupTitle}</DialogTitle>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {copy.setupDescription}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close debate setup"
            disabled={create.isPending}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!canStart || create.isPending) return;
            create.mutate(
              {
                client_request_id: requestId.current,
                topic: topic.trim(),
                seats,
                rules,
              },
              {
                onSuccess: (result) => {
                  onStarted(result.id);
                  onClose();
                },
              },
            );
          }}
        >
          <label className={styles.field}>
            {copy.topic}
            <Textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              rows={2}
              maxLength={2000}
              required
              placeholder="What question deserves more than one perspective?"
            />
          </label>
          <fieldset className="space-y-3">
            <legend className="mb-3 text-sm font-medium">
              Model seats · Choose 2–4
            </legend>
            {seats.map((seat, index) => (
              <div className={styles.seat} key={index}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Seat {index + 1}
                  </span>
                  {seats.length > 2 && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      aria-label={`Remove seat ${index + 1}`}
                      onClick={() =>
                        setSeats((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <DebateSelect
                  label={`Model for seat ${index + 1}`}
                  value={JSON.stringify([seat.provider_id, seat.model_id])}
                  options={options.map((option) => ({
                    ...option,
                    disabled: seats.some(
                      (other, i) =>
                        i !== index &&
                        other.provider_id === option.provider_id &&
                        other.model_id === option.model_id,
                    ),
                  }))}
                  onChange={(value) => {
                    const option = options.find(
                      (option) => option.value === value,
                    )!;
                    setSeats((current) =>
                      current.map((currentSeat, i) =>
                        i === index
                          ? {
                              ...currentSeat,
                              provider_id: option.provider_id,
                              model_id: option.model_id,
                            }
                          : currentSeat,
                      ),
                    );
                  }}
                />
                <DebateSelect
                  label={`Role for seat ${index + 1}`}
                  value={seat.role}
                  options={copy.roles.map((role) => ({
                    value: role,
                    label: role,
                  }))}
                  onChange={(role) =>
                    setSeats((current) =>
                      current.map((currentSeat, i) =>
                        i === index
                          ? { ...currentSeat, role: role as DebateRole }
                          : currentSeat,
                      ),
                    )
                  }
                />
              </div>
            ))}
            {seats.length < 4 && options.length > seats.length && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const option = options.find(
                    (option) =>
                      !seats.some(
                        (seat) =>
                          seat.provider_id === option.provider_id &&
                          seat.model_id === option.model_id,
                      ),
                  )!;
                  setSeats((current) => [
                    ...current,
                    {
                      provider_id: option.provider_id,
                      model_id: option.model_id,
                      role: copy.roles[current.length % 4]!,
                    },
                  ]);
                }}
              >
                <Plus aria-hidden="true" />
                Add model seat
              </Button>
            )}
            {options.length < 2 && (
              <div className={styles.notice}>
                At least two supported model targets are needed. Catalogs may
                still be loading.
                <Button
                  type="button"
                  variant="link"
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                >
                  Open Provider settings
                </Button>
              </div>
            )}
            <p className={styles.hint}>
              {copy.transport} Model identity and debate role are separate
              choices.
            </p>
          </fieldset>
          <DebateRulesFields rules={rules} onChange={setRules} />
          <div className={styles.notice}>
            <p>{browserRequired ? copy.browserBackground : copy.background}</p>
            <p className="mt-2">{copy.pause}</p>
            <p className="mt-2">
              Blind opening · No round limit · No automatic consensus stop
            </p>
          </div>
          {create.error && (
            <p role="alert" className={styles.error}>
              {create.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !canStart ||
                !topic.trim() ||
                !rules.text.trim() ||
                create.isPending
              }
            >
              {create.isPending ? "Starting…" : "Start debate"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
