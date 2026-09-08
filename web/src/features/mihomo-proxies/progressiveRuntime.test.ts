import { describe, expect, it, vi } from "vitest";
import { createProxyApi, type ProxyApiTransport } from "./proxyApi";

describe("progressive proxy loading", () => {
  it("publishes primary nodes while an auxiliary endpoint is still pending", async () => {
    let finish!: (value: unknown) => void;
    const slow = new Promise(resolve => { finish = resolve; });
    const payload = { data: { groups: [{ name: "Group", type: "Selector", all: ["DIRECT"], now: "DIRECT" }],
      proxies: { DIRECT: { name: "DIRECT", type: "Direct" } } } };
    const transport = vi.fn((path: string) => path.endsWith("/proxies")
      ? Promise.resolve(payload) : slow) as ProxyApiTransport;
    const primary = vi.fn();
    let completed = false;
    const result = createProxyApi(transport).loadRuntime(undefined, undefined, primary).then(() => { completed = true; });
    await vi.waitFor(() => expect(primary).toHaveBeenCalledOnce());
    expect(primary.mock.calls[0][0].groupKeys).toHaveLength(1);
    expect(completed).toBe(false);
    finish({ data: {} });
    await result;
    expect(completed).toBe(true);
  });

  it("does not publish cancelled primary data", async () => {
    const controller = new AbortController();
    controller.abort();
    const primary = vi.fn();
    const transport = (async () => ({ data: {} })) as ProxyApiTransport;
    await createProxyApi(transport).loadRuntime(undefined, controller.signal, primary);
    expect(primary).not.toHaveBeenCalled();
  });
});
