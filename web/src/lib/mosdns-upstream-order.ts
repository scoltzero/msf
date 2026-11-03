import type { UpstreamGroup } from "./mosdns-system-data";

export function reorderUpstreamServers(groups: UpstreamGroup[], groupId: string, sourceId: string, targetId: string): UpstreamGroup[] {
  const group = groups.find((item) => item.id === groupId);
  if (!group || sourceId === targetId) return groups;
  const source = group.servers.findIndex((server) => server.id === sourceId);
  const target = group.servers.findIndex((server) => server.id === targetId);
  if (source < 0 || target < 0) return groups;
  const servers = [...group.servers];
  servers.splice(target, 0, servers.splice(source, 1)[0]);
  return groups.map((item) => item === group ? { ...item, servers } : item);
}
