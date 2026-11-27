import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MiniAppInstance } from "@cove/api-contract";
import { fetchLocalService, request } from "@/api/client";
import { Button } from "@/components/ui/button";
import { ErrorMessage, sectionStyle } from "./presentation";

interface Attachment {
  id: string;
  name: string;
  size: number;
}

export function AppBlobs({ instance }: { instance: MiniAppInstance }) {
  const path =
    "/api/mini-apps/instances/" + encodeURIComponent(instance.id) + "/blobs";
  const [removeId, setRemoveId] = useState("");
  const [notice, setNotice] = useState("");
  const list = useQuery({
    queryKey: ["mini-apps", "attachments", instance.id, instance.revision],
    queryFn: () => request<{ attachments: Attachment[] }>(path),
    retry: false,
  });
  const action = useMutation({
    retry: false,
    mutationFn: async (
      command: { file: File } | { remove: string } | { download: Attachment },
    ) => {
      setNotice("");
      if ("file" in command) {
        const file = command.file;
        if (!file.size || file.size > 4 * 1024 * 1024)
          throw new Error("Choose a nonempty file up to 4 MiB.");
        const query = new URLSearchParams({
          name: file.name,
          id: crypto.randomUUID(),
        });
        await request(path + "?" + query, { method: "POST", body: file });
        setNotice("Attachment saved.");
      } else if ("remove" in command) {
        await request(path + "/" + command.remove, { method: "DELETE" });
        setRemoveId("");
        setNotice("Attachment removed.");
      } else {
        const item = command.download;
        const response = await fetchLocalService(path + "/" + item.id);
        if (!response.ok)
          throw new Error("The attachment could not be downloaded.");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(await response.blob());
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
    </section>
  );
}
