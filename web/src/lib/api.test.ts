import { afterEach, describe, expect, it, vi } from "vitest";

import { api, clearSession, REFRESH_TOKEN_KEY, TOKEN_KEY } from "./api";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  vi.unstubAllGlobals();
});

describe("api timeout", () => {
  it("aborts a stalled request when timeoutMs expires", async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage, sessionStorage },
    });
    vi.stubGlobal("fetch", (_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));

    await expect(api("/slow", { timeoutMs: 5 })).rejects.toThrow("请求超时");
  });
});

describe("clearSession", () => {
  it("preserves permanent login announcement dismissal while clearing auth and session state", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage, sessionStorage },
    });

    const hiddenKey = "msf-login-announcement:2026-08-v0.6.2-smart-core:hidden";
    const sessionKey = "msf-login-announcement:2026-08-v0.6.2-smart-core:session";
    localStorage.setItem(TOKEN_KEY, "access-token");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-token");
    localStorage.setItem(hiddenKey, "1");
    sessionStorage.setItem(sessionKey, "1");

    clearSession();

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(hiddenKey)).toBe("1");
    expect(sessionStorage.getItem(sessionKey)).toBeNull();
  });
});
