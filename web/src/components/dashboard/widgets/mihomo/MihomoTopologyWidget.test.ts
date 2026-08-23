import { describe, expect, it } from "vitest";
import { buildConnectionTopology } from "@/components/mihomo/overview/OverviewWidgets";

describe("Mihomo connection topology", () => {
  it("builds source, rule, entry group and exit layers", () => {
    const graph = buildConnectionTopology([{ source: "192.168.1.2", rule: "DOMAIN", rulePayload: "example.com", chains: ["HK-01", "自动选择"] }]);
    expect(graph.nodes.map((node) => [node.depth, node.name])).toEqual([
      [0, "192.168.1.2"],
      [1, "DOMAIN: example.com"],
      [2, "自动选择"],
      [3, "HK-01"],
    ]);
    expect(graph.links).toHaveLength(3);
  });

  it("aggregates duplicate paths by connection count and skips incomplete chains", () => {
    const row = { source: "10.0.0.2", rule: "MATCH", chains: ["DIRECT"] };
    const graph = buildConnectionTopology([row, row, { source: "ignored", chains: [] }]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.links.map((link) => link.originalValue)).toEqual([2, 2]);
  });
});
