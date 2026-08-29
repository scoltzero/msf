export const TOKEN_KEY = "msf_token";
export const REFRESH_TOKEN_KEY = "msf_refresh_token";
const PERSISTENT_LOGIN_ANNOUNCEMENT_KEY = /^msf-login-announcement:[^:]+:hidden$/;

export interface ApiErrorPayload {
  error?: string;
  message?: string;
  success?: boolean;
}

export class ApiError extends Error {
  status: number;
  code: string;
  payload: unknown;

  constructor(status: number, code: string, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

type ApiOptions = RequestInit & {
  skipAuth?: boolean;
  timeoutMs?: number;
};

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

export function getRefreshToken() {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY) || "";
}

export function setSession(token: string, refreshToken?: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearSession() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.toLowerCase().startsWith("msf")) continue;
      const isPermanentAnnouncementPreference =
        storage === window.localStorage && PERSISTENT_LOGIN_ANNOUNCEMENT_KEY.test(key.toLowerCase());
      if (!isPermanentAnnouncementPreference) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  }
}

function parsePayloadMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const data = payload as ApiErrorPayload;
    return data.message || data.error || fallback;
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }
  return fallback;
}

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { skipAuth, timeoutMs, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body && !(requestOptions.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token && !skipAuth && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let timeoutID: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let detachAbort: (() => void) | undefined;
  let signal = requestOptions.signal;
  if (timeoutMs && timeoutMs > 0) {
    const controller = new AbortController();
    signal = controller.signal;
    if (requestOptions.signal) {
      const relayAbort = () => controller.abort(requestOptions.signal?.reason);
      if (requestOptions.signal.aborted) relayAbort();
      else {
        requestOptions.signal.addEventListener("abort", relayAbort, { once: true });
        detachAbort = () => requestOptions.signal?.removeEventListener("abort", relayAbort);
      }
    }
    timeoutID = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...requestOptions, headers, signal });
  } catch (error) {
    if (timedOut) throw new Error(`请求超时（${Math.ceil(Number(timeoutMs) / 1000)} 秒）`);
    throw error;
  } finally {
    if (timeoutID) clearTimeout(timeoutID);
    detachAbort?.();
  }
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new Event("msf-auth-expired"));
    }
    const code =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as ApiErrorPayload).error)
        : response.statusText;
    throw new ApiError(response.status, code, parsePayloadMessage(payload, response.statusText), payload);
  }

  return payload as T;
}

export function apiData<T = any>(payload: any, fallback?: T): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data as T;
  }
  return (fallback ?? payload) as T;
}

export function apiList<T = any>(payload: any, keys: string[] = ["data", "items", "logs", "services"]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key] as T[];
  }
  return [];
}

export function formatBytes(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatPercent(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0.0%";
  return `${numeric.toFixed(1)}%`;
}
