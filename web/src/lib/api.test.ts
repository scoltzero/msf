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
  it("preserves appearance and permanent announcement preferences while clearing auth and session state", () => {
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
    localStorage.setItem("msf-theme", "dark");
    localStorage.setItem("msf-language", "zh-CN");
    localStorage.setItem("msf-glass-scene", "static");
    localStorage.setItem("msf-glass-quality", "reduced");
    localStorage.setItem("msf-content-plate-settings", JSON.stringify({ subtle: 40, regular: 50, strong: 60 }));
    localStorage.setItem("msf-dashboard-settings", "private-user-layout");
    sessionStorage.setItem(sessionKey, "1");

    clearSession();

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(hiddenKey)).toBe("1");
    expect(localStorage.getItem("msf-theme")).toBe("dark");
    expect(localStorage.getItem("msf-language")).toBe("zh-CN");
    expect(localStorage.getItem("msf-glass-scene")).toBe("static");
    expect(localStorage.getItem("msf-glass-quality")).toBe("reduced");
    expect(localStorage.getItem("msf-content-plate-settings")).toBe(JSON.stringify({ subtle: 40, regular: 50, strong: 60 }));
    expect(localStorage.getItem("msf-dashboard-settings")).toBeNull();
    expect(sessionStorage.getItem(sessionKey)).toBeNull();
  });

  it("preserves appearance preferences in localStorage while clearing their sessionStorage copies", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage, sessionStorage },
    });

    localStorage.setItem(TOKEN_KEY, "access-token");
    localStorage.setItem("msf-theme", "dark");
    localStorage.setItem("msf-language", "zh-CN");
    localStorage.setItem("msf-skin", "amber");
    localStorage.setItem("msf-custom-css", "body { --x: 1; }");
    localStorage.setItem("msf-accent-color", "#f97316");
    localStorage.setItem("msf-skin-tint", "120");
    localStorage.setItem("msf-glass-scene", "static");
    localStorage.setItem("msf-glass-quality", "balanced");
    localStorage.setItem("msf-content-plate-settings", JSON.stringify({ subtle: 56, regular: 70, strong: 84 }));
    sessionStorage.setItem("msf-theme", "dark");

    clearSession();

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem("msf-theme")).toBe("dark");
    expect(localStorage.getItem("msf-language")).toBe("zh-CN");
    expect(localStorage.getItem("msf-skin")).toBe("amber");
    expect(localStorage.getItem("msf-custom-css")).toBe("body { --x: 1; }");
    expect(localStorage.getItem("msf-accent-color")).toBe("#f97316");
    expect(localStorage.getItem("msf-skin-tint")).toBe("120");
    expect(localStorage.getItem("msf-glass-scene")).toBe("static");
    expect(localStorage.getItem("msf-glass-quality")).toBe("balanced");
    expect(localStorage.getItem("msf-content-plate-settings")).toBe(JSON.stringify({ subtle: 56, regular: 70, strong: 84 }));
    expect(sessionStorage.getItem("msf-theme")).toBeNull();
  });
});
