import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  LocalSearchResults,
  MiniAppInstance,
  SpeechJob,
} from "@cove/api-contract";
import { fetchLocalService, LocalServiceError, request } from "@/api/client";
import { getLocalDocuments } from "@/api/local-models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorMessage, labelStyle } from "./presentation";

function command(data: unknown) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

export function AppProcessing({
  instance,
  text,
  onSelect,
}: {
  instance: MiniAppInstance;
  text: string;
  onSelect: (text: string) => void;
}) {
  const path = "/api/mini-apps/instances/" + encodeURIComponent(instance.id);
  if (!instance.enabled) return null;
  return (
    <>
      {instance.grants.includes("documents.search") && (
        <DocumentPicker path={path} onSelect={onSelect} />
      )}
      {instance.grants.includes("speech.speak") && (
        <LocalReading path={path + "/speech"} text={text} />
      )}
    </>
  );
}

function DocumentPicker({
  path,
  onSelect,
}: {
  path: string;
  onSelect: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const library = useQuery({
    queryKey: ["mini-app-document-picker", path],
    queryFn: ({ signal }) => getLocalDocuments(signal),
    enabled: open,
    retry: false,
  });
  const search = useMutation({
    mutationFn: (scope: { document_ids: string[]; query: string }) =>
      request<LocalSearchResults>(path + "/documents/search", command(scope)),
    retry: false,
  });
  const scope = { document_ids: ids, query: query.trim() };
  const current = JSON.stringify(scope) === JSON.stringify(search.variables);
  return (
    <div>
      <Button
        size="xs"
        variant="outline"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Find a document excerpt
      </Button>
      {open && (
        <section
          className="mt-2 space-y-2 rounded-md border border-border p-3"
          aria-label="Search local documents"
        >
          {library.isPending && <p role="status">Loading library…</p>}
          {library.data?.length === 0 && (
            <p className="text-sm">
              Add documents to your local library to search them here.
            </p>
          )}
          <ErrorMessage error={library.error} />
          {library.data?.map((doc) => (
            <label key={doc.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ids.includes(doc.id)}
                disabled={
                  doc.needs_reindex ||
                  (!ids.includes(doc.id) && ids.length >= 4)
                }
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, doc.id]
                      : ids.filter((id) => id !== doc.id),
                  )
                }
              />
              {doc.name}
              {doc.needs_reindex && " (reindex required)"}
            </label>
          ))}
          <label className={labelStyle}>
            Search within selected documents
            <Input
              maxLength={400}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <Button
            size="xs"
            type="button"
            disabled={!ids.length || !scope.query || search.isPending}
            onClick={() => search.mutate(scope)}
          >
            {search.isPending ? "Searching…" : "Search"}
          </Button>
          {current && <ErrorMessage error={search.error} />}
          {current && search.data?.hits.length === 0 && (
            <p className="text-sm">No matching excerpts.</p>
          )}
          {current &&
            search.data?.hits.map((hit) => (
              <div
                className="space-y-1 border-t border-border pt-2"
                key={hit.document_id + "/" + hit.ordinal}
              >
                <p className="text-xs text-muted-foreground">
                  {
                    library.data?.find((doc) => doc.id === hit.document_id)
                      ?.name
                  }
                </p>
                <p className="whitespace-pre-wrap text-sm">{hit.text}</p>
                <Button
                  size="xs"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    onSelect(hit.text);
                    setOpen(false);
                  }}
                >
                  Use this excerpt
                </Button>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}

function LocalReading({ path, text }: { path: string; text: string }) {
  const [job, setJob] = useState<SpeechJob>();
  const [url, setURL] = useState("");
  const active = useRef(false);
  const stop = (id: string) =>
    request<void>(path + "/" + encodeURIComponent(id), {
      method: "DELETE",
      keepalive: true,
    });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const start = useMutation({
    mutationFn: () => request<SpeechJob>(path, command({ text })),
    onSuccess: (created) => {
      if (active.current) setJob(created);
      else void stop(created.id).catch(() => {});
    },
    retry: false,
  });
  const jobID = job?.id;
  useEffect(() => {
    if (!jobID) return;
    return () => {
      void request<void>(path + "/" + encodeURIComponent(jobID), {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
    };
  }, [path, jobID]);
  const status = useQuery({
    queryKey: ["mini-app-reading", path, jobID],
    enabled: !!jobID,
    retry: false,
    queryFn: ({ signal }) =>
      request<SpeechJob>(path + "/" + encodeURIComponent(jobID!), { signal }),
    refetchInterval: (q) => {
      if (q.state.error) return false;
      const state = q.state.data?.state;
      return !state || state === "preparing" || state === "generating"
        ? 500
        : false;
    },
  });
  const audio = useQuery({
    queryKey: ["mini-app-wav", path, jobID],
    enabled: !!jobID && status.data?.state === "completed",
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetchLocalService(
        path + "/" + encodeURIComponent(jobID!) + "/audio",
        { signal },
      );
      if (!response.ok) throw new LocalServiceError(await response.json());
      return response.blob();
    },
  });
  useEffect(() => {
    if (!jobID || !audio.data) {
      setURL("");
      return;
    }
    const blobURL = URL.createObjectURL(audio.data);
    setURL(blobURL);
    return () => URL.revokeObjectURL(blobURL);
  }, [audio.data, jobID]);
  return (
    <div className="space-y-1">
      {!job ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={
            !text.trim() || Array.from(text).length > 6000 || start.isPending
          }
          onClick={() => start.mutate()}
        >
          {start.isPending ? "Starting reading…" : "Read this text aloud"}
        </Button>
      ) : (
        <>
          {url && (
            <audio
              controls
              src={url}
              aria-label="Local reading"
              onLoadedMetadata={(e) => {
                e.currentTarget.volume = Math.max(0, Math.min(1, job.volume));
                e.currentTarget.playbackRate = job.playback_rate;
              }}
            />
          )}
          {status.data?.state === "failed" && (
            <p role="alert">{status.data.error || "Local reading failed."}</p>
          )}
          {!url &&
            !status.isError &&
            !audio.isError &&
            status.data?.state !== "failed" && (
              <p className="text-sm" role="status">
                Preparing local audio…
              </p>
            )}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setJob(undefined)}
          >
            Close reading
          </Button>
        </>
      )}
      <ErrorMessage error={start.error || status.error || audio.error} />
    </div>
  );
}
