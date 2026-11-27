import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MiniAppInstance } from "@cove/api-contract";
import { miniApps, type AppAttachment } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ErrorMessage, sectionStyle } from "./presentation";

export function AppBlobs({ instance }: { instance: MiniAppInstance }) {
  const pendingUpload = useRef<{ key: string; id: string } | undefined>(
    undefined,
  );
  const [removeId, setRemoveId] = useState("");
  const [notice, setNotice] = useState("");
  const list = useQuery({
    queryKey: ["mini-apps", "attachments", instance.id, instance.revision],
    queryFn: () => miniApps.attachments(instance.id),
    retry: false,
  });
  const action = useMutation({
    retry: false,
    mutationFn: async (
      command:
        | { file: File }
        | { remove: string }
        | { download: AppAttachment },
    ) => {
      setNotice("");
      if ("file" in command) {
        const file = command.file;
        if (!file.size || file.size > 4 * 1024 * 1024)
          throw new Error("Choose a nonempty file up to 4 MiB.");
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await file.arrayBuffer(),
        );
        const key =
          instance.id +
          "/" +
          file.name +
          "/" +
          Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
        if (pendingUpload.current?.key !== key)
          pendingUpload.current = { key, id: crypto.randomUUID() };
        await miniApps.uploadAttachment(
          instance.id,
          pendingUpload.current.id,
          file,
        );
        pendingUpload.current = undefined;
        setNotice("Attachment saved.");
      } else if ("remove" in command) {
        await miniApps.removeAttachment(instance.id, command.remove);
        setRemoveId("");
        setNotice("Attachment removed.");
      } else {
        const item = command.download;
        const data = await miniApps.downloadAttachment(instance.id, item.id);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(data);
        link.download = item.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        return;
      }
      await list.refetch();
    },
  });
  return (
    <section className={sectionStyle} aria-label="Instance attachments">
      <h2 className="font-semibold">Attachments</h2>
      <label className="grid gap-2 text-sm">
        Import a file (up to 4 MiB)
        <input
          type="file"
          disabled={action.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) action.mutate({ file });
          }}
        />
      </label>
      {list.data?.attachments.map((item) => (
        <div
          key={item.id}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <Button
            variant="link"
            disabled={action.isPending}
            onClick={() => action.mutate({ download: item })}
          >
            {item.name}
          </Button>
          <span>{Math.ceil(item.size / 1024)} KiB</span>
          {removeId === item.id ? (
            <>
              <Button
                size="sm"
                disabled={action.isPending}
                onClick={() => action.mutate({ remove: item.id })}
              >
                Confirm removal
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRemoveId("")}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRemoveId(item.id)}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      <p role="status">{notice}</p>
      <ErrorMessage error={action.error ?? list.error} />
      {action.isError && action.variables && "file" in action.variables && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => action.mutate(action.variables!)}
        >
          Retry import
        </Button>
      )}
    </section>
  );
}
