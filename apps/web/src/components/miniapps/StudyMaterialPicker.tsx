import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type {
  MiniAppAction,
  MiniAppFields,
  MiniAppInstance,
  MiniAppPackage,
  MiniAppResult,
  MiniAppSurface,
} from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { recordPrimaryField } from "./AppRecordFields";
import { ErrorMessage, selectStyle } from "./presentation";

function inputDefault(action: MiniAppAction, input: string) {
  const value = action.defaults?.[input];
  const type = action.inputs?.[input];
  if (
    type === "date" &&
    typeof value === "string" &&
    /^\$today(?:[+-]\d{1,4})?$/.test(value)
  ) {
    const day = new Date();
    day.setDate(day.getDate() + Number(value.slice(6)));
    return [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, "0"),
      String(day.getDate()).padStart(2, "0"),
    ].join("-");
  }
  return value ?? (type === "bool" ? false : type === "number" ? 0 : "");
}

export function StudyMaterialPicker({
  instance,
  pkg,
  action,
  inputs,
  surface,
  choose,
}: {
  instance: MiniAppInstance;
  pkg: MiniAppPackage;
  action: MiniAppAction;
  inputs: MiniAppFields;
  surface: MiniAppSurface;
  choose: (values: MiniAppFields) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const mapping = action.selection_inputs;
  const query = Object.entries(pkg.actions).find(
    ([, candidate]) =>
      candidate.op === "query" &&
      candidate.collection === mapping?.collection &&
      candidate.surfaces.includes(surface) &&
      Object.keys(candidate.inputs ?? {}).every((key) =>
        Object.hasOwn(candidate.defaults ?? {}, key),
      ),
  );
  const available =
    !!mapping && !!query && instance.grants.includes("records.query");
  const rows = useInfiniteQuery({
    queryKey: [
      "mini-app-records",
      instance.id,
      instance.release_id,
      instance.revision,
      "material-picker",
      query?.[0],
      surface,
    ],
    initialPageParam: "",
    getNextPageParam: (last: MiniAppResult) => last.next_cursor,
    queryFn: ({ pageParam }) =>
      miniApps.invoke(instance.id, {
        action: query![0],
        inputs: {},
        surface,
        operation_id: crypto.randomUUID(),
        expected_instance_revision: instance.revision,
        cursor: pageParam || undefined,
      }),
    enabled: available,
    retry: false,
  });
  if (!available) return null;
  const records = rows.data?.pages.flatMap((page) => page.records ?? []) ?? [];
  const idInput = Object.entries(mapping!.fields).find(
    ([, field]) => field === "$id",
  )?.[0];
  const matching = records.filter((record) =>
    Object.entries(mapping!.fields).every(
      ([input, field]) => inputs[input] === record.fields[field],
    ),
  );
  const current = idInput
    ? String(inputs[idInput] ?? "")
    : selectedId === ""
      ? ""
      : (matching.find((record) => record.id === selectedId)?.id ??
        matching[0]?.id ??
        "");
  const primary = recordPrimaryField(pkg, mapping!.collection);
  return (
    <div className="space-y-2">
      <label className="grid gap-2 text-sm font-medium">
        Source material
        <select
          className={selectStyle}
          value={current}
          onChange={(e) => {
            const record = records.find((r) => r.id === e.target.value);
            setSelectedId(record?.id ?? "");
            choose(
              Object.fromEntries(
                Object.entries(mapping!.fields).map(([input, field]) => [
                  input,
                  record
                    ? field === "$id"
                      ? record.id
                      : record.fields[field]
                    : inputDefault(action, input),
                ]),
              ),
            );
          }}
        >
          <option value="">Paste your own material</option>
          {current && !records.some((record) => record.id === current) && (
            <option value={current}>Selected material</option>
          )}
          {records.map((record) => (
            <option key={record.id} value={record.id}>
              {String(
                record.fields[primary ?? ""] ??
                  Object.values(record.fields).find(
                    (value) => typeof value === "string",
                  ) ??
                  "Saved material",
              )}
            </option>
          ))}
        </select>
      </label>
      {rows.isPending && (
        <p className="text-xs text-muted-foreground">Loading saved material…</p>
      )}
      {rows.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          disabled={rows.isFetching}
          onClick={() => void rows.fetchNextPage()}
        >
          Load more materials
        </Button>
      )}
      <ErrorMessage error={rows.error} />
    </div>
  );
}
