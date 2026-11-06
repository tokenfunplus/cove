import { type ErrorEnvelope, type SessionResponse } from "@cove/api-contract";

let csrfToken: string | undefined;

export function browserSessionHeaders(): Record<string, string> {
  return csrfToken ? { "X-Cove-CSRF-Token": csrfToken } : {};
}

export class LocalServiceError extends Error {
  constructor(readonly envelope: ErrorEnvelope) {
    super(envelope.error.message);
    this.name = "LocalServiceError";
  }
}

function localServiceUnavailable(
  message = "Local service unavailable",
): LocalServiceError {
  return new LocalServiceError({
    error: {
      code: "service_unavailable",
      message,
      details: null,
      request_id: "local",
    },
  });
}

export async function getSession(): Promise<SessionResponse> {
  const session = await fetchJSON<SessionResponse>("/api/session", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  csrfToken = session.csrf_token;
  return session;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  if (!isSafeMethod(method) && !csrfToken) {
    await getSession();
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!isSafeMethod(method) && csrfToken) {
    headers.set("X-Cove-CSRF-Token", csrfToken);
  }
  return fetchJSON<T>(path, { ...init, credentials: "same-origin", headers });
}

async function fetchJSON<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw localServiceUnavailable();
  }
  if (response.status === 204) {
    return undefined as T;
  }
  let payload: T | ErrorEnvelope;
  try {
    payload = (await response.json()) as T | ErrorEnvelope;
  } catch {
    if (response.ok) {
      throw localServiceUnavailable(
        "Local service returned an invalid response",
      );
    }
    throw new LocalServiceError({
      error: {
        code: response.status >= 500 ? "service_unavailable" : "validation",
        message:
          response.status >= 500
            ? "Local service unavailable"
            : "Request failed",
        details: null,
        request_id: "local",
      },
    });
  }
  if (!response.ok) {
    throw new LocalServiceError(payload as ErrorEnvelope);
  }
  return payload as T;
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}
