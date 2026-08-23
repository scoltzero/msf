import { useMemo } from "react";
import { selectProviders } from "@/features/mihomo-rules/selectors";
import type { RuleStore } from "@/features/mihomo-rules/types";
import { RuleEmptyState } from "./RuleEmptyState";
import { RuleProviderCard } from "./RuleProviderCard";

export function RuleProviderList({ store, query, loading, onUpdate, onEdit }: { store: RuleStore; query: string; loading: boolean; onUpdate: (name: string) => void; onEdit: (name: string) => void }) {
  const providers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return selectProviders(store).filter((provider) => !normalized || [provider.name, provider.type, provider.behavior, provider.url, provider.path].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized));
  }, [query, store]);
  if (!providers.length) return <RuleEmptyState loading={loading} title={query ? "没有匹配的规则提供商" : "暂无规则提供商"} description="规则提供商运行状态来自 Mihomo Controller；配置编辑请切换到配置编辑页。" />;
  return <div className="grid min-w-0 w-full max-w-full gap-3 xl:grid-cols-2">{providers.map((provider) => <div key={provider.name} className="min-w-0 max-w-full"><RuleProviderCard provider={provider} canEdit={store.authority.canEditRuleProviders} canUpdate={store.capabilities.providerUpdate} onUpdate={() => onUpdate(provider.name)} onEdit={() => onEdit(provider.name)} /></div>)}</div>;
}
