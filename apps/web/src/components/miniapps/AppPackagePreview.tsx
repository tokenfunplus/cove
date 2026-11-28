import type { MiniAppPackage } from "@cove/api-contract";
import { ArrowRight, Check, Layers3, LockKeyhole } from "lucide-react";
import { recordPrimaryField } from "./AppRecordFields";

export function AppMark({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span
      className={"mini-app-mark " + (small ? "mini-app-mark--small" : "")}
      aria-hidden="true"
    >
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase() || <Layers3 />}
    </span>
  );
}

export function PublicAppPreview({
  pkg,
  name,
}: {
  pkg?: MiniAppPackage;
  name: string;
}) {
  const page = pkg?.pages[0];
  const query = page?.actions
    .map((id) => pkg?.actions[id])
    .find((action) => action?.op === "query");
  const collection = query?.collection;
  const fields = collection ? pkg?.collections[collection]?.fields : undefined;
  const textFields = Object.entries(fields ?? {})
    .filter(([, type]) => type === "text")
    .map(([key]) => key);
  const front =
    page?.practice?.front ??
    (pkg ? recordPrimaryField(pkg, collection) : undefined) ??
    textFields.find((key) => key !== query?.reveal_field);
  const rows = collection ? (pkg?.seed?.[collection]?.slice(0, 3) ?? []) : [];
  const asset = page?.image ? pkg?.assets?.[page.image] : undefined;
  const practice = Boolean(page?.practice || query?.reveal_field);
  return (
    <div
      className={
        "mini-app-preview " +
        (practice ? "mini-app-preview--practice" : "mini-app-preview--list")
      }
    >
      {asset ? (
        <img
          src={"data:" + asset.mime + ";base64," + asset.data}
          alt={asset.alt}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="mini-app-preview-window"
          aria-label={name + " example preview"}
        >
          <div className="mini-app-preview-toolbar">
            <span className="mini-app-window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{name}</span>
            <LockKeyhole size={10} aria-hidden="true" />
          </div>
          <div className="mini-app-preview-body">
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold tracking-wide">
                {page?.title ?? "Your workspace"}
              </span>
              <span className="mini-app-example-tag">Example</span>
            </div>
            {practice && rows[0] && front ? (
              <div className="mini-app-sample-card">
                <span className="text-[9px] uppercase tracking-[0.17em] opacity-50">
                  A moment to practise
                </span>
                <p className="mini-app-sample-question">
                  {String(rows[0][front])}
                </p>
                <span className="mini-app-sample-answer">
                  Reveal answer <ArrowRight size={10} />
                </span>
              </div>
            ) : rows.length ? (
              <div className="grid gap-2">
                {rows.map((row, index) => (
                  <div key={index} className="mini-app-sample-row">
                    <span
                      className="mini-app-sample-bullet"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <strong className="block truncate text-[11px] font-medium">
                        {front ? String(row[front]) : "Saved item"}
                      </strong>
                      {textFields.find((key) => key !== front) && (
                        <span className="mt-1 block truncate text-[9px] opacity-55">
                          {String(
                            row[textFields.find((key) => key !== front)!],
                          )}
                        </span>
                      )}
                    </span>
                    <Check
                      size={11}
                      className="ml-auto opacity-30"
                      aria-hidden="true"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mini-app-preview-empty">
                <AppMark name={name} />
                <span>{pkg ? "A fresh space for your ideas." : ""}</span>
              </div>
            )}
            <div className="mini-app-preview-tabs">
              {(pkg?.pages ?? []).slice(0, 3).map((item) => (
                <span key={item.id}>{item.title}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
