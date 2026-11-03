import { describe, expect, it } from "vitest";
import { reorderUpstreamServers } from "./mosdns-upstream-order";
import type { UpstreamGroup } from "./mosdns-system-data";

function fixture(): UpstreamGroup[] {
  return ["domestic", "foreign"].map((id) => ({
    id, name: id, subtitle: "", defaultExpanded: true,
    servers: ["a", "b", "c"].map((name, index) => ({ id: `${id}:${name}`, name, protocol: "https", address: `https://${name}.example/dns-query`, enabled: index !== 1, accessKeySecretSet: index === 0, raw: { dial_addr: "1.2.3.4", access_key_secret_set: index === 0 } })),
  }));
}

describe("MosDNS upstream ordering", () => {
  it("moves rows in both directions, preserving disabled rows, private fields and other groups", () => {
    const groups = fixture();
    const moved = reorderUpstreamServers(groups, "domestic", "domestic:a", "domestic:c");
    expect(moved[0].servers.map((server) => server.name)).toEqual(["b", "c", "a"]);
    expect(moved[0].servers[2]).toBe(groups[0].servers[0]);
    expect(moved[0].servers[0].enabled).toBe(false);
    expect(moved[1]).toBe(groups[1]);
    expect(groups[0].servers.map((server) => server.name)).toEqual(["a", "b", "c"]);
    expect(reorderUpstreamServers(moved, "domestic", "domestic:a", "domestic:b")[0].servers).toEqual(groups[0].servers);
  });

  it("ignores cross-group, unknown, and unchanged moves", () => {
    const groups = fixture();
    for (const [group, source, target] of [["domestic", "domestic:a", "foreign:b"], ["missing", "a", "b"], ["domestic", "missing", "domestic:a"], ["domestic", "domestic:a", "domestic:a"]]) {
      expect(reorderUpstreamServers(groups, group, source, target)).toBe(groups);
    }
  });
});
