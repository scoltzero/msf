import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { activeProxyTestingKeys, activeProxyTestJob, dashboardProxyGroupView, resolveDashboardProxyGroup } from "@/components/dashboard/widgets/mihomo/MihomoProxyGroupWidget";
import { ProxyGroupCard, proxyGroupManagementActionsVisible } from "@/components/mihomo/proxies/ProxyGroupCard";
import { createEmptyProxyStore, patchProxySelection } from "./proxyStore";
import type { ProxyEntity, ProxyKey, ProxyStore } from "./types";
import { applyProxyDelayResults, type ProxyRuntimeTestJob } from "./useProxyRuntime";

const groupKey = "global:GLOBAL" as ProxyKey;
const firstKey = "global:Node A" as ProxyKey;
const secondKey = "global:Node B" as ProxyKey;

function entity(key: ProxyKey, kind: "group" | "node", members: ProxyKey[] = []): ProxyEntity {
  return { key, name: key.slice(key.indexOf(":") + 1), type: kind === "group" ? "Selector" : "Trojan", kind, memberKeys: members, history: [], alive: true, udp: true, xudp: false, hidden: false };
}

function store(): ProxyStore {
  return {
    ...createEmptyProxyStore(),
    groupKeys: [groupKey],
    entities: {
      [groupKey]: { ...entity(groupKey, "group", [firstKey, secondKey]), selectedKey: firstKey },
      [firstKey]: entity(firstKey, "node"),
      [secondKey]: entity(secondKey, "node"),
    },
  };
}

describe("dashboard proxy runtime view model", () => {
  it("resolves only a currently existing group", () => {
    expect(resolveDashboardProxyGroup(store(), groupKey)?.name).toBe("GLOBAL");
    expect(resolveDashboardProxyGroup(store(), "global:deleted")).toBeUndefined();
    expect(resolveDashboardProxyGroup(store(), firstKey)).toBeUndefined();
  });

  it("keeps optimistic selection immutable so failure can restore the exact snapshot", () => {
    const before = store();
    const optimistic = patchProxySelection(before, groupKey, secondKey);
    expect(optimistic.entities[groupKey].selectedKey).toBe(secondKey);
    expect(before.entities[groupKey].selectedKey).toBe(firstKey);
  });

  it("attributes shared testing progress to group and node widgets", () => {
    const groupJob: ProxyRuntimeTestJob = { id: "g", scope: "group", scopeKey: groupKey, status: "running", completed: 2, total: 4, succeeded: 2, failed: 0 };
    const nodeJob: ProxyRuntimeTestJob = { id: "n", scope: "node", scopeKey: firstKey, status: "running", completed: 0, total: 1, succeeded: 0, failed: 0, displayKeys: [firstKey] };
    expect(activeProxyTestJob({ g: groupJob }, groupKey)?.completed).toBe(2);
    expect(activeProxyTestJob({ n: nodeJob }, firstKey)?.id).toBe("n");
    expect(activeProxyTestJob({ g: { ...groupJob, status: "done" } }, groupKey)).toBeUndefined();
    expect(activeProxyTestingKeys({ g: groupJob, n: nodeJob })).toEqual(new Set([groupKey, firstKey]));
  });

  it("adapts runtime state to the same card model as the proxy page", () => {
    const current = store();
    current.entities[firstKey] = { ...current.entities[firstKey], delay: 28, icon: "/node-a.svg", providerName: "Airport A" };
    const view = dashboardProxyGroupView(current, current.entities[groupKey], { pendingSelection: secondKey, trafficSpeed: 2048 });

    expect(view).toMatchObject({
      key: groupKey,
      selectedKey: secondKey,
      selectedName: "Node B",
      trafficSpeed: 2048,
      readOnly: true,
    });
    expect(view.nodes).toEqual([
      expect.objectContaining({ key: firstKey, delay: 28, icon: "/node-a.svg", providerName: "Airport A" }),
      expect.objectContaining({ key: secondKey, name: "Node B" }),
    ]);
  });

  it("suppresses the proxy page's three management actions in embedded dashboard cards", () => {
    expect(proxyGroupManagementActionsVisible(false)).toBe(true);
    expect(proxyGroupManagementActionsVisible(true)).toBe(false);
  });

  it("keeps repeated proxy cards on classic blurred glass without SVG refraction", () => {
    const current = store();
    const group = dashboardProxyGroupView(current, current.entities[groupKey]);
    const markup = renderToStaticMarkup(createElement(ProxyGroupCard, {
      group,
      collapsed: true,
      onToggle: () => undefined,
      onSelect: () => undefined,
      onTest: () => undefined,
    }));
    expect(markup).toContain('data-proxy-card-material="classic-glass"');
    expect(markup).toContain("gary-glass--regular");
    expect(markup).not.toContain("gary-glass--refractive");
  });

  it("applies a batch of delay results with one final store snapshot", () => {
    const current = store();
    const policy = { url: "https://example.com/generate_204", timeoutMs: 3_000, source: "page-fallback" as const, persisted: true };
    const next = applyProxyDelayResults(current, [
      { target: { key: firstKey, physicalKey: firstKey, displayKeys: [firstKey], path: [firstKey], node: current.entities[firstKey], policy }, delay: 32 },
      { target: { key: secondKey, physicalKey: secondKey, displayKeys: [secondKey], path: [secondKey], node: current.entities[secondKey], policy }, delay: 48 },
    ]);
    expect(next.entities[firstKey].delay).toBe(32);
    expect(next.entities[secondKey].delay).toBe(48);
    expect(current.entities[firstKey].delay).toBeUndefined();
  });
});
