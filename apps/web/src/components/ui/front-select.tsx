import { Combobox, ComboboxButton, ComboboxInput, ComboboxLabel, ComboboxOption, ComboboxOptions, Listbox } from "@headlessui/react";
import { ChevronDown, Search } from "lucide-react";
import { useState, type ReactNode } from "react";

export type FrontSelectOption = {
  value: string;
  label: ReactNode;
  keywords?: string | readonly string[];
  disabled?: boolean;
};

function optionSearchText(option: FrontSelectOption): string {
  const keywords = typeof option.keywords === "string" ? [option.keywords] : option.keywords ?? [];
  return [option.value, typeof option.label === "string" ? option.label : "", ...keywords].join(" ").toLocaleLowerCase();
}

export function filterFrontSelectOptions(options: readonly FrontSelectOption[], query: string): FrontSelectOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...options];
  return options.filter((option) => optionSearchText(option).includes(normalizedQuery));
}

export function FrontSelect({
  id,
  label,
  ariaLabel,
  placeholder = "-",
  options,
  value,
  onValueChange,
  disabled = false,
  searchable = false,
  searchPlaceholder = "Search models",
  emptyText = "No matching models",
  className = "",
  panelClassName = "",
  optionClassName = ""
}: {
  id?: string;
  label?: ReactNode;
  ariaLabel?: string;
  placeholder?: ReactNode;
  options: readonly FrontSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  panelClassName?: string;
  optionClassName?: string;
}) {
  const [query, setQuery] = useState("");
  if (searchable) {
    const filteredOptions = filterFrontSelectOptions(options, query);
    return (
      <Combobox value={value} onChange={(nextValue) => nextValue !== null && onValueChange(nextValue)} disabled={disabled} onClose={() => setQuery("")} immediate>
        <div className="relative grid gap-1 front-select front-select--searchable">
          {label ? <ComboboxLabel className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</ComboboxLabel> : null}
          <div className="front-select__input-shell">
            <span className="front-select__selected-value" aria-hidden="true">{options.find((option) => option.value === value)?.label}</span>
            <Search aria-hidden="true" className="front-select__search-icon" size={13} strokeWidth={1.8} />
            <ComboboxInput
              id={id}
              aria-label={ariaLabel}
              className={`front-select__input min-h-9 rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-2 text-left text-[var(--ink)] ${className}`}
              displayValue={(selectedValue: string) => {
                const option = options.find((candidate) => candidate.value === selectedValue);
                if (!option) return "";
                return typeof option.label === "string" ? option.label : option.value;
              }}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={typeof placeholder === "string" ? placeholder : searchPlaceholder}
            />
            <ComboboxButton aria-label={searchPlaceholder} className="front-select__toggle"><ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} /></ComboboxButton>
          </div>
          <ComboboxOptions anchor="bottom start" portal className={`front-select__options front-select__options--searchable ${panelClassName}`}>
            <div className="front-select__options-heading">{searchPlaceholder}</div>
            {filteredOptions.length > 0 ? filteredOptions.map((option) => (
              <ComboboxOption className={`front-select__option ${optionClassName}`} key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </ComboboxOption>
            )) : <p className="front-select__empty">{emptyText}</p>}
          </ComboboxOptions>
        </div>
      </Combobox>
    );
  }

  return (
    <Listbox value={value} onChange={onValueChange} disabled={disabled}>
      <div className="relative grid gap-1">
        {label ? <Listbox.Label className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</Listbox.Label> : null}
        <Listbox.Button id={id} aria-label={ariaLabel} className={`min-h-9 rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-2 text-left text-[var(--ink)] ${className}`}>
          {options.find((option) => option.value === value)?.label ?? placeholder}
        </Listbox.Button>
        <Listbox.Options anchor="bottom start" portal className={`front-select__options ${panelClassName}`}>
          {options.map((option) => (
            <Listbox.Option className={`front-select__option ${optionClassName}`} key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </Listbox.Option>
          ))}
        </Listbox.Options>
      </div>
    </Listbox>
  );
}
