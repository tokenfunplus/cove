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
  ComboboxLabel,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { ChevronDown, Search } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export type FrontSelectOption = {
  value: string;
  label: ReactNode;
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
  if (!normalizedQuery) return [...options];
  return options.filter((option) =>
    optionSearchText(option).includes(normalizedQuery),
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
            <ComboboxLabel className={primitivesStyles.fieldSelect_label}>
              {label}
            </ComboboxLabel>
          ) : null}
          <div className={primitivesStyles.frontSelect_inputShell}>
            <span
              className={primitivesStyles.frontSelect_selectedValue}
              aria-hidden="true"
            >
              {options.find((option) => option.value === value)?.label}
            </span>
            <Search
              aria-hidden="true"
              className={primitivesStyles.frontSelect_searchIcon}
              size={13}
              strokeWidth={1.8}
            />
            <ComboboxInput
              as={Input}
              id={id}
              aria-label={ariaLabel}
              className={cn(
                primitivesStyles.frontSelect_input,
                `front-select__input ${className}`,
              )}
              displayValue={(selectedValue: string) => {
                const option = options.find(
                  (candidate) => candidate.value === selectedValue,
                );
                if (!option) return "";
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
            <div className={primitivesStyles.frontSelect_optionsHeading}>
              {searchPlaceholder}
            </div>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <ComboboxOption
                  className={cn(
                    primitivesStyles.frontSelect_option,
                    `front-select__option ${optionClassName}`,
                  )}
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </ComboboxOption>
              ))
            ) : (
              <p className={primitivesStyles.frontSelect_empty}>{emptyText}</p>
            )}
          </ComboboxOptions>
        </div>
      </Combobox>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
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
            {options.find((option) => option.value === value)?.label ??
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
              value={option.value}
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
