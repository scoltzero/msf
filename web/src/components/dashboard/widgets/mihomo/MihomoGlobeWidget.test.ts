import { describe, expect, it } from "vitest";
import { buildEarthRoutes } from "@/components/mihomo/overview/earth/routes";

describe("Mihomo globe routes", () => {
  it("does not query locations for an invalid origin", async () => {
    let calls = 0;
    const result = await buildEarthRoutes([], "not-an-ip", "zh-CN", async () => { calls += 1; return {}; });
    expect(result).toEqual({ routes: [], origin: null });
    expect(calls).toBe(0);
  });

  it("aggregates connections sharing the same destination coordinates", async () => {
    const result = await buildEarthRoutes([
      { destinationIP: "8.8.8.8", host: "dns.google", uploadSpeed: 10, downloadSpeed: 20, download: 100 },
      { destinationIP: "8.8.4.4", host: "google-dns", uploadSpeed: 5, downloadSpeed: 15, download: 50 },
    ], "1.1.1.1", "zh-CN", async (ips) => Object.fromEntries(ips.map((ip) => [ip, ip === "1.1.1.1" ? { ip, latitude: 1, longitude: 1, city: "本机", country: "CN" } : { ip, latitude: 2, longitude: 2, city: "目标", country: "US" }])));
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({ connections: 2, upload: 15, download: 35 });
    expect(result.routes[0].topHosts).toHaveLength(2);
  });
});
