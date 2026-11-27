// Version 1 packages contain data interpreted by Cove's local host.
export type MiniAppSurface = "page" | "chat" | "panel";
export type MiniAppFieldType = "text" | "date" | "bool" | "number";
export type MiniAppFields = Record<string, string | number | boolean>;

export type MiniAppExpression =
  | string
  | number
  | boolean
  | Partial<
      Record<
        "if" | "add" | "eq" | "ne" | "lt" | "lte" | "gt" | "gte",
        MiniAppExpression[]
      >
    >;

export interface MiniAppAction {
  output_schema?: {
    kind: "records" | "candidates" | "text";
    fields?: Record<string, MiniAppFieldType>;
  };
  title: string;
  op: "query" | "create" | "update" | "delete" | "generate";
  collection?: string;
  inputs?: Record<string, MiniAppFieldType>;
  surfaces: MiniAppSurface[];
  where?: { field: string; op: string; value: string | number | boolean }[];
  order_by?: string;
  defaults?: MiniAppFields;
  limit_input?: string;
  count_input?: string;
  selection_inputs?: { collection: string; fields: Record<string, string> };
  candidate_bindings?: Record<string, string>;
  reveal_field?: string;
  limit?: number;
  values?: Record<string, MiniAppExpression>;
  prompt?: string;
  text_input?: string;
  candidate_action?: string;
}

export interface MiniAppPackage {
  assets?: Record<
    string,
    { mime: "image/png" | "image/jpeg"; alt: string; data: string }
  >;
  min_host_version?: string;
  speech_language?: "ja";
  format: 1;
  publisher: string;
  app: string;
  name: string;
  description?: string;
  version: string;
  schema_version: number;
  capabilities: string[];
  collections: Record<
    string,
    {
      fields: Record<string, MiniAppFieldType>;
      links?: Record<string, { query: string; label: string }>;
    }
  >;
  pages: {
    image?: string;
    id: string;
    title: string;
    actions: string[];
    practice?: {
      query: string;
      front: string;
      back: string;
      outcomes: string[];
    };
  }[];
  actions: Record<string, MiniAppAction>;
  seed?: Record<string, MiniAppFields[]>;
  migrations?: {
    from: number;
    to: number;
    defaults: Record<string, MiniAppFields>;
  }[];
}

export interface MiniAppRelease {
  catalog_authority?: string;
  official_catalog?: boolean;
  legacy_verified?: boolean;
  id: string;
  origin: string;
  digest: string;
  package: MiniAppPackage;
}

export interface MiniAppInstance {
  cloud_enabled?: boolean;
  id: string;
  name: string;
  release_id: string;
  enabled: boolean;
  grants: string[];
  revision: number;
}

export interface MiniAppRecord {
  id: string;
  revision: number;
  fields: MiniAppFields;
}

export interface MiniAppInvocation {
  search?: string;
  expected_instance_revision?: number;
  cursor?: string;
  items?: MiniAppFields[];
  action: string;
  surface: MiniAppSurface;
  operation_id: string;
  inputs: MiniAppFields;
  records?: Pick<MiniAppRecord, "id" | "revision">[];
  confirm?: string;
}

export interface MiniAppResult {
  next_cursor?: string;
  records?: MiniAppRecord[];
  confirmation?: string;
  prompt?: string;
}
