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
  title: string;
  op: "query" | "create" | "update" | "generate";
  collection?: string;
  inputs?: Record<string, MiniAppFieldType>;
  surfaces: MiniAppSurface[];
  where?: { field: string; op: string; value: string | number | boolean }[];
  order_by?: string;
  reveal_field?: string;
  limit?: number;
  values?: Record<string, MiniAppExpression>;
  prompt?: string;
  text_input?: string;
  candidate_action?: string;
}

export interface MiniAppPackage {
  format: 1;
  publisher: string;
  app: string;
  name: string;
  description?: string;
  version: string;
  schema_version: number;
  capabilities: string[];
  collections: Record<string, { fields: Record<string, MiniAppFieldType> }>;
  pages: { id: string; title: string; actions: string[] }[];
  actions: Record<string, MiniAppAction>;
  seed?: Record<string, MiniAppFields[]>;
  migrations?: {
    from: number;
    to: number;
    defaults: Record<string, MiniAppFields>;
  }[];
}

export interface MiniAppRelease {
  id: string;
  origin: string;
  digest: string;
  package: MiniAppPackage;
}

export interface MiniAppInstance {
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
  items?: MiniAppFields[];
  action: string;
  surface: MiniAppSurface;
  operation_id: string;
  inputs: MiniAppFields;
  records?: Pick<MiniAppRecord, "id" | "revision">[];
  confirm?: string;
}

export interface MiniAppResult {
  records?: MiniAppRecord[];
  confirmation?: string;
  prompt?: string;
}
