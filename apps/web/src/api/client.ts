import { type ErrorEnvelope, type SessionResponse } from "@cove/api-contract";

const sessionStorageKey = "cove.browser-session";
const sessionFragment = "#cove-session=";

function loadBrowserSession(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.hash.startsWith(sessionFragment)) {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("cove-session");
    const intent = fragment.get("intent");
    const action =
      intent === "settings" || intent === "new-chat" ? "#" + intent : "";
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search + action,
    );
    try {
      if (token) window.sessionStorage.setItem(sessionStorageKey, token);
      else window.sessionStorage.removeItem(sessionStorageKey);
    } catch {
      // A tab without storage can still use the current launch.
    }
    return token || undefined;
  }
  try {
    return window.sessionStorage.getItem(sessionStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

const sessionToken = loadBrowserSession();
let csrfToken: string | undefined;

export function browserSessionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (sessionToken) headers["X-Cove-Session-Token"] = sessionToken;
  if (csrfToken) headers["X-Cove-CSRF-Token"] = csrfToken;
  return headers;
}

export function fetchLocalService(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  // A redirect or an absolute URL must not carry local credentials elsewhere.
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path)) {
    return Promise.reject(new Error("Invalid Local Service path"));
  }
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(browserSessionHeaders())) {
    headers.set(name, value);
  }
  return fetchSameOrigin(path, { ...init, headers });
}

/** Protect the local session even when a caller uses an SDK-built Request. */
export const fetchSameOrigin: typeof fetch = (input, init) => {
  if (typeof window !== "undefined") {
    const url = new URL(
      input instanceof Request ? input.url : input,
      window.location.origin,
    );
    if (url.origin !== window.location.origin) {
      return Promise.reject(new Error("Invalid Local Service origin"));
    }
  }
  return fetch(input, { ...init, credentials: "omit", redirect: "error" });
};

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
  return fetchJSON<T>(path, { ...init, headers });
}

async function fetchJSON<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetchLocalService(path, init);
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
