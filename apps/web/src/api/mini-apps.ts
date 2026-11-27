import { fetchLocalService, request } from "./client";
import type {
  MiniAppFields,
  MiniAppInstance,
  MiniAppInvocation,
  MiniAppPackage,
  MiniAppRelease,
  MiniAppRecord,
  MiniAppResult,
  MiniAppSurface,
} from "@cove/api-contract";

const root = "/api/mini-apps";
const segment = encodeURIComponent;
const instanceURL = (id: string) => root + "/instances/" + segment(id);
export interface CatalogEntry {
  origin: string;
  schema_version: number;
  publisher: string;
  app: string;
  version: string;
  name: string;
  digest: string;
}
const releaseURL = (
  entry: Pick<CatalogEntry, "publisher" | "app" | "version">,
) =>
  [
    root + "/catalog",
    segment(entry.publisher),
    segment(entry.app),
    segment(entry.version),
  ].join("/");
const post = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
export const appKeys = {
  instances: ["mini-apps", "instances"] as const,
  instance: (id: string) => ["mini-apps", "instances", id] as const,
  releases: ["mini-apps", "releases"] as const,
  catalog: ["mini-apps", "catalog"] as const,
};
export const miniApps = {
  nativeSelection: (id: string, view: string) =>
    request<{
      pending: boolean;
      id?: string;
      target?: { action: string; view: string; title: string; field: string };
    }>(instanceURL(id) + "/native-selection?view=" + encodeURIComponent(view)),
  takeNativeSelection: (instance: string, id: string) =>
    request<{ text: string }>(
      instanceURL(instance) + "/native-selection",
      post({ id }),
    ),
  activity: (id: string) =>
    request<{
      activity: {
        operation_id: string;
        action: string;
        release_id: string;
        surface: string;
        status: string;
        time: number;
      }[];
    }>(instanceURL(id) + "/activity"),
  capabilities: (id: string) =>
    request<{ host_version: string; capabilities: Record<string, string> }>(
      instanceURL(id) + "/capabilities",
    ),
  receiveSelection: (id: string, text: string) =>
    request<{ text: string }>(instanceURL(id) + "/selection", post({ text })),
  instances: () =>
    request<{ instances: MiniAppInstance[] }>(root + "/instances"),
  releases: () => request<{ packages: MiniAppRelease[] }>(root + "/packages"),
  catalogSettings: () =>
    request<{ url: string; public_key: string }>(root + "/catalog-settings"),
  saveCatalogSettings: (url: string, public_key: string) =>
    request(root + "/catalog-settings", {
      ...post({ url, public_key }),
      method: "PUT",
    }),
  catalog: () =>
    request<{ packages: CatalogEntry[]; warning?: string }>(root + "/catalog"),
  get: (id: string) =>
    request<{ instance: MiniAppInstance; package: MiniAppPackage }>(
      instanceURL(id),
    ),
  catalogPreview: async (entry: CatalogEntry): Promise<MiniAppPackage> => {
    const response = await fetchLocalService(releaseURL(entry));
    if (
      !response.ok ||
      response.headers.get("X-Cove-Package-Digest") !== entry.digest
    )
      throw new Error(
        "The catalog release changed or could not be loaded. Refresh the catalog and try again.",
      );
    return response.json() as Promise<MiniAppPackage>;
  },
  catalogInstall: (entry: CatalogEntry) =>
    request<MiniAppRelease>(
      releaseURL(entry) + "/install",
      post({ digest: entry.digest }),
    ),
  localPackage: (raw: string, operation: "preview" | "install") =>
    request<MiniAppRelease>(root + "/packages/" + operation, {
      ...post({}),
      body: raw,
    }),
  create: (release_id: string, name: string, grants: string[]) =>
    request<MiniAppInstance>(
      root + "/instances",
      post({ release_id, name, grants }),
    ),
  export: (id: string) => request<unknown>(instanceURL(id) + "/export"),
  restore: (raw: string) =>
    request<MiniAppInstance>(root + "/instances/restore", {
      ...post({}),
      body: raw,
    }),
  remove: (id: string) => request<void>(instanceURL(id), { method: "DELETE" }),
  settings: (instance: MiniAppInstance, enabled: boolean, grants: string[]) =>
    request<MiniAppInstance>(
      instanceURL(instance.id) + "/settings",
      post({ enabled, grants, revision: instance.revision }),
    ),
  upgrade: (instance: MiniAppInstance, release_id: string, grants: string[]) =>
    request<MiniAppInstance>(
      instanceURL(instance.id) + "/upgrade",
      post({ release_id, grants, revision: instance.revision }),
    ),
  invoke: (id: string, command: MiniAppInvocation) =>
    request<MiniAppResult>(
      instanceURL(id) + "/actions/" + segment(command.action),
      post(command),
    ),
  attach: (
    id: string,
    data: Pick<
      MiniAppInvocation,
      "action" | "inputs" | "surface" | "records" | "expected_instance_revision"
    > & { view: string },
  ) =>
    request<{ records: MiniAppRecord[] }>(
      instanceURL(id) + "/attach",
      post(data),
    ),
  latestProposal: (instance: string, surface: MiniAppSurface) =>
    request<AppTask | null>(
      instanceURL(instance) + "/proposals?surface=" + segment(surface),
    ),
  proposal: (instance: string, id: string) =>
    request<AppTask>(instanceURL(instance) + "/proposals/" + segment(id)),
  startProposal: (
    instance: string,
    command: {
      actions: string[];
      question: string;
      surface: MiniAppSurface;
      providerId: string;
      modelId: string;
      destination: string;
      localOnly: boolean;
      operationId: string;
    },
  ) => request<AppTask>(instanceURL(instance) + "/proposals", post(command)),
  cancelProposal: (instance: string, id: string) =>
    request<AppTask>(instanceURL(instance) + "/proposals/" + segment(id), {
      method: "DELETE",
    }),
  tasks: (id: string) =>
    request<{ tasks: AppTask[] }>(instanceURL(id) + "/tasks"),
  startFile: (id: string) =>
    request<{ id: string; url: string }>(instanceURL(id) + "/files", post({})),
  file: (id: string, op: string) =>
    request<{ state: string; name?: string; text?: string }>(
      instanceURL(id) + "/files/" + segment(op),
    ),
  startTask: (
    id: string,
    data: {
      action: string;
      surface: MiniAppSurface;
      expected_instance_revision?: number;
      operationId: string;
      input: MiniAppFields;
      providerId: string;
      modelId: string;
      destination: string;
      localOnly: boolean;
    },
  ) => request<AppTask>(instanceURL(id) + "/tasks", post(data)),
  task: (id: string, task: string) =>
    request<AppTask>(instanceURL(id) + "/tasks/" + segment(task)),
  cancel: (id: string, task: string) =>
    request<AppTask>(instanceURL(id) + "/tasks/" + segment(task), {
      method: "DELETE",
    }),
};

export interface AppTask {
  inputs?: MiniAppFields;
  destination?: string;
  browser?: boolean;
  snapshot?: import("@cove/api-contract").ProviderSnapshot;
  verification?: import("@cove/api-contract").GenerationVerification;
  id: string;
  action?: string;
  surface?: MiniAppSurface;
  modelId?: string;
  providerId?: string;
  state: "running" | "completed" | "cancelled" | "failed";
  result?: string;
  error?: string;
}
