import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { primitivesStyles } from "@/styles/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export type FrontSelectOption = {
  value: string;
  label: ReactNode;
  group?: string;
  hidden?: boolean;
  selectedLabel?: ReactNode;
  displayLabel?: string;
  keywords?: string | readonly string[];
  disabled?: boolean;
};

function optionSearchText(option: FrontSelectOption): string {
  const keywords =
    typeof option.keywords === "string"
      ? [option.keywords]
      : (option.keywords ?? []);
  return [
    option.value,
    typeof option.label === "string" ? option.label : "",
    ...keywords,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function filterFrontSelectOptions(
  options: readonly FrontSelectOption[],
  query: string,
): FrontSelectOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options.filter((option) => !option.hidden);
  return options.filter(
    (option) =>
      !option.hidden && optionSearchText(option).includes(normalizedQuery),
  );
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
  optionClassName = "",
  notice,
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
  notice?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  if (searchable) {
    const filteredOptions = filterFrontSelectOptions(options, query);
    return (
      <Combobox
        value={value}
        onChange={(nextValue) => nextValue !== null && onValueChange(nextValue)}
        disabled={disabled}
        onClose={() => setQuery("")}
        immediate
      >
        <div
          className={cn(
            primitivesStyles.frontSelect,
            "front-select--searchable",
          )}
        >
          {label ? (
            <label htmlFor={triggerId} className={primitivesStyles.fieldSelect_label}>
              {label}
            </label>
          ) : null}
          <div className={primitivesStyles.frontSelect_inputShell}>
            <span
              className={primitivesStyles.frontSelect_selectedValue}
              aria-hidden="true"
            >
              {(() => {
                const option = options.find((item) => item.value === value);
                return option?.selectedLabel ?? option?.label;
              })()}
            </span>
            <Search
              aria-hidden="true"
              className={primitivesStyles.frontSelect_searchIcon}
              size={13}
              strokeWidth={1.8}
            />
            <ComboboxInput
              as={Input}
              id={triggerId}
              aria-label={ariaLabel}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                primitivesStyles.frontSelect_input,
                `front-select__input ${className}`,
              )}
              displayValue={(selectedValue: string) => {
                const option = options.find(
                  (candidate) => candidate.value === selectedValue,
                );
                if (!option) return "";
                if (option.displayLabel) return option.displayLabel;
                return typeof option.label === "string"
                  ? option.label
                  : option.value;
              }}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                typeof placeholder === "string"
                  ? placeholder
                  : searchPlaceholder
              }
            />
            <ComboboxButton
              as={Button}
              variant="ghost"
              aria-label={searchPlaceholder}
              className={primitivesStyles.frontSelect_toggle}
            >
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
            </ComboboxButton>
          </div>
          <ComboboxOptions
            anchor="bottom start"
            portal
            className={cn(
              primitivesStyles.frontSelect_options,
              `front-select__options front-select__options--searchable ${panelClassName}`,
            )}
          >
            <div
              className={primitivesStyles.frontSelect_optionsHeading}
              aria-hidden="true"
            >
              <span>{searchPlaceholder}</span>
              <span className="tabular-nums">{filteredOptions.length}</span>
            </div>
            {notice ? (
              <p className="px-3 pb-2 text-[10px] leading-relaxed text-muted-foreground">
                {notice}
              </p>
            ) : null}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => (
                <div key={option.value} role="presentation">
                  {option.group &&
                    filteredOptions[index - 1]?.group !== option.group && (
                      <p
                        className="px-3 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground"
                        aria-hidden="true"
                      >
                        {option.group}
                      </p>
                    )}
                  <ComboboxOption
                    className={cn(
                      primitivesStyles.frontSelect_option,
                      `front-select__option ${optionClassName}`,
                    )}
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {({ selected }) => (
                      <>
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                          {option.label}
                        </span>
                        <Check
                          aria-hidden="true"
                          size={14}
                          className={cn(
                            "shrink-0 text-primary",
                            !selected && "invisible",
                          )}
                        />
                      </>
                    )}
                  </ComboboxOption>
                </div>
              ))
            ) : (
              <p className={primitivesStyles.frontSelect_empty}>{emptyText}</p>
            )}
          </ComboboxOptions>
        </div>
      </Combobox>
    );
  }

  let emptyValue = `__cove-empty-${triggerId}`;
  while (options.some(option => option.value === emptyValue)) emptyValue += "_";
  const encodeValue = (optionValue: string) => optionValue === "" ? emptyValue : optionValue;
  return (
    <Select value={encodeValue(value)} onValueChange={next => onValueChange(next === emptyValue ? "" : next)} disabled={disabled}>
      <div className={primitivesStyles.fieldSelect}>
        {label ? (
          <label
            htmlFor={triggerId}
            className={primitivesStyles.fieldSelect_label}
          >
            {label}
          </label>
        ) : null}
        <SelectTrigger
          id={triggerId}
          aria-label={ariaLabel}
          className={cn(primitivesStyles.fieldSelect_trigger, className)}
        >
          <SelectValue placeholder={placeholder}>
            {options.find((option) => option.value === value)?.selectedLabel ??
              options.find((option) => option.value === value)?.label ??
              placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          className={cn(
            "z-[100] max-h-[min(360px,50dvh)] max-w-[calc(100vw-28px)]",
            panelClassName,
          )}
        >
          {options.map((option) => (
            <SelectItem
              className={optionClassName}
              key={option.value}
              value={encodeValue(option.value)}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>
  );
}
