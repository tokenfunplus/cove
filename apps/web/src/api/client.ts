import { type ErrorEnvelope, type SessionResponse } from "@cove/api-contract";
import { isConversationId } from "@/lib/launcher-intent";

const sessionStorageKey = "cove.browser-session";
const sessionFragment = "#cove-session=";

function loadBrowserSession(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.hash.startsWith(sessionFragment)) {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("cove-session");
    const intent = fragment.get("intent");
    const conversationId = fragment.get("conversation_id");
    let action =
      intent === "settings" ||
      intent === "new-chat" ||
      intent === "provider-setup"
        ? "#" + intent
        : "";
    if (intent === "conversation" && isConversationId(conversationId)) {
      action = "#conversation=" + conversationId;
    }
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search + action,
    );
    storeBrowserSession(token || undefined);
    return token || undefined;
  }
  try {
    return window.sessionStorage.getItem(sessionStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeBrowserSession(token: string | undefined) {
  try {
    if (token) window.sessionStorage.setItem(sessionStorageKey, token);
    else window.sessionStorage.removeItem(sessionStorageKey);
  } catch {
    // A tab without storage can still use the current launch.
  }
}

let sessionToken = loadBrowserSession();
let csrfToken: string | undefined;
let sessionExpiryListener: (() => void) | undefined;

export function replaceBrowserSession(token: string) {
  sessionToken = token;
  csrfToken = undefined;
  storeBrowserSession(token);
}

export function observeBrowserSessionExpiry(listener: () => void) {
  sessionExpiryListener = listener;
  return () => {
    if (sessionExpiryListener === listener) sessionExpiryListener = undefined;
  };
}

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
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(path)
  ) {
    return Promise.reject(new Error("Invalid Local Service path"));
  }
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(browserSessionHeaders())) {
    headers.set(name, value);
  }
  const sentToken = sessionToken;
  const response = fetchSameOrigin(path, { ...init, headers });
  if (!sessionExpiryListener) return response;
  return response.then(async (result) => {
    if (result.status === 401 && sentToken === sessionToken) {
      // Provider proxies can independently return 401; only local authorization
      // errors can request another Browser Session from the Launcher.
      const body = (await result
        .clone()
        .json()
        .catch(() => undefined)) as ErrorEnvelope | undefined;
      if (
        sentToken === sessionToken &&
        body?.error?.code === "invalid_session"
      ) {
        sessionExpiryListener?.();
      }
    }
    return result;
  });
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

export async function getSession(
  signal?: AbortSignal | null,
): Promise<SessionResponse> {
  const sentToken = sessionToken;
  const session = await fetchJSON<SessionResponse>("/api/session", {
    headers: { Accept: "application/json" },
    signal,
  });
  if (sentToken === sessionToken) csrfToken = session.csrf_token;
  return session;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  if (!isSafeMethod(method) && !csrfToken) {
    const initialSession = sessionToken;
    await getSession(init.signal);
    // Session renewal can complete before the earlier proof arrives.
    if (!csrfToken && sessionToken !== initialSession)
      await getSession(init.signal);
    if (!csrfToken) {
      throw localServiceUnavailable(
        "Could not authorize this request with the current Browser Session.",
      );
    }
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
