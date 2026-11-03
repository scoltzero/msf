import { api } from "@/lib/api";

export async function updateSubscriptions(providers: { name: string; vehicleType?: string }[]) {
  const failed: string[] = [];
  let updated = 0;
  for (const provider of providers) {
    if (provider.vehicleType?.toLowerCase() !== "http") continue;
    try {
      await api(`/api/v1/mihomo/proxy-providers/${encodeURIComponent(provider.name)}/update`, { method: "POST" });
      updated += 1;
    } catch {
      failed.push(provider.name);
    }
  }
  return { updated, failed };
}
