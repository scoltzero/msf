import { describe, expect, it, vi } from "vitest";
import type { ClosedConnectionRecord } from "@/components/mihomo/overview/connectionHistory";
import {
  mihomoDashboardScopesForWidgetTypes,
  reconcileMihomoConnectionHistory,
  resolveMihomoDashboardScopes,
  startMihomoDashboardPolling,
  startMihomoTrafficStream,
} from "./data/MihomoDashboardProvider";

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  close() {
    this.closed = true;
    this.onclose?.();
  }
}

describe("Mihomo dashboard resource scopes", () => {
  it("does not enable requests or traffic for unrelated widgets", () => {
    expect(mihomoDashboardScopesForWidgetTypes(["system-info", "mihomo-service", "mihomo-latency", "mihomo-proxy-group"])).toEqual([]);
  });

  it("maps consumers to the minimum shared scopes", () => {
    expect(mihomoDashboardScopesForWidgetTypes([
      "mihomo-traffic",
      "mihomo-globe",
      "mihomo-topology",
      "mihomo-connection-stats",
      "mihomo-provider-traffic",
      "mihomo-rule-hits",
    ])).toEqual(["traffic", "overview", "connections", "providers", "rules"]);
  });

  it("starts and stops only the selected request lifecycle", () => {
    const overview = vi.fn();
    const connections = vi.fn();
    const providers = vi.fn();
    const rules = vi.fn();
    let interval: (() => void) | undefined;
    let visibility: (() => void) | undefined;
    let now = 60_000;
    const clearInterval = vi.fn(() => { interval = undefined; });
    const removeVisibilityListener = vi.fn(() => { visibility = undefined; });
    const cleanup = startMihomoDashboardPolling({
      scopes: new Set(["providers"]),
      refresh: { overview, connections, providers, rules },
      lastPollAt: {},
      now: () => now,
      hidden: () => false,
      setInterval: (callback) => { interval = callback; return 7; },
      clearInterval,
      addVisibilityListener: (callback) => { visibility = callback; },
      removeVisibilityListener,
    });

    expect(providers).toHaveBeenCalledOnce();
    expect(overview).not.toHaveBeenCalled();
    expect(connections).not.toHaveBeenCalled();
    expect(rules).not.toHaveBeenCalled();
    now += 60_000;
    interval?.();
    expect(providers).toHaveBeenCalledTimes(2);
    visibility?.();
    expect(providers).toHaveBeenCalledTimes(3);

    cleanup();
    expect(clearInterval).toHaveBeenCalledWith(7);
    expect(removeVisibilityListener).toHaveBeenCalledOnce();
    expect(interval).toBeUndefined();
    expect(visibility).toBeUndefined();
  });

  it("allocates no polling resources without REST consumers", () => {
    const setInterval = vi.fn();
    const addVisibilityListener = vi.fn();
    const refresh = { overview: vi.fn(), connections: vi.fn(), providers: vi.fn(), rules: vi.fn() };
    startMihomoDashboardPolling({
      scopes: new Set(), refresh, lastPollAt: {}, now: () => 0, hidden: () => false,
      setInterval, clearInterval: vi.fn(), addVisibilityListener, removeVisibilityListener: vi.fn(),
    });
    expect(setInterval).not.toHaveBeenCalled();
    expect(addVisibilityListener).not.toHaveBeenCalled();
    Object.values(refresh).forEach((request) => expect(request).not.toHaveBeenCalled());
  });

  it("keeps connection history polling after stats is hidden without enabling other resources", () => {
    expect(Array.from(resolveMihomoDashboardScopes([], true))).toEqual(["connections"]);
    expect(Array.from(resolveMihomoDashboardScopes([], false))).toEqual([]);
  });

  it("keeps the baseline while hidden, saves ended connections once, and resumes without duplicates", async () => {
    const first = { id: "active-1", source: "192.0.2.1", target: "example.com", download: 30, upload: 4 };
    const second = { id: "active-2", source: "192.0.2.2", target: "example.net", download: 20, upload: 2 };
    const save = vi.fn(async (_rows: ClosedConnectionRecord[]) => {});
    const stored = [{ id: "active-1", source: "192.0.2.1", target: "example.com", process: "-", outbound: "-", proxyGroup: "-", download: 30, upload: 4, closedAt: 1 }];
    const read = vi.fn(async () => stored);

    const baseline = await reconcileMihomoConnectionHistory({ previous: null, connections: [first, second], save, read });
    const hiddenSnapshot = await reconcileMihomoConnectionHistory({ previous: baseline.current, connections: [second], save, read });
    const shownAgain = await reconcileMihomoConnectionHistory({ previous: hiddenSnapshot.current, connections: [second], save, read });

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toHaveLength(1);
    expect(save.mock.calls[0][0][0]).toMatchObject({ id: "active-1", download: 30, upload: 4 });
    expect(hiddenSnapshot.closedConnections).toBe(stored);
    expect(shownAgain.closedConnections).toBeUndefined();
    expect(read).toHaveBeenCalledOnce();
  });
});

describe("Mihomo traffic stream lifecycle", () => {
  it("shares one socket and permanently closes it on cleanup", () => {
    const sockets: FakeSocket[] = [];
    const retries = new Map<number, () => void>();
    let nextTimer = 1;
    const cancelRetry = vi.fn((timer: number) => retries.delete(timer));
    const onOpen = vi.fn();
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const cleanup = startMihomoTrafficStream({
      token: () => "secret",
      url: (token) => `ws://test/traffic?token=${token}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      retry: (callback) => { const id = nextTimer++; retries.set(id, callback); return id; },
      cancelRetry,
      onOpen,
      onMessage,
      onClose,
    });

    expect(sockets).toHaveLength(1);
    sockets[0].onopen?.();
    sockets[0].onmessage?.({ data: JSON.stringify({ up: 2, down: 3 }) });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({ up: 2, down: 3 });

    cleanup();
    expect(sockets[0].closed).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(retries.size).toBe(0);
    expect(cancelRetry).toHaveBeenCalledOnce();
  });

  it("cancels token retry when the scope is disabled before connecting", () => {
    const createSocket = vi.fn();
    const retries = new Map<number, () => void>();
    const cleanup = startMihomoTrafficStream({
      token: () => "",
      url: () => "ws://test/traffic",
      createSocket,
      retry: (callback) => { retries.set(9, callback); return 9; },
      cancelRetry: (timer) => retries.delete(timer),
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
    });
    expect(retries.has(9)).toBe(true);
    cleanup();
    expect(retries.has(9)).toBe(false);
    expect(createSocket).not.toHaveBeenCalled();
  });
});
