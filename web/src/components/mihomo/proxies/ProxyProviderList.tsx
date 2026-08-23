import { ProxyEmptyState } from "./ProxyEmptyState";
import { ProxyProviderCard } from "./ProxyProviderCard";
import { splitProxyItems, useResponsiveProxyColumns } from "./useResponsiveProxyColumns";
import type { ProxyCardSize, ProxyNodeDisplay, ProxyNodeView, ProxyProviderView } from "./types";

export function ProxyProviderList({
  providers,
  loading,
  collapsed,
  onToggle,
  testing,
  testingKeys,
  updating,
  hideUnavailable,
  nodeDisplay,
  minCardWidth,
  cardSize,
  disableTextSelect,
  low,
  high,
  onTest,
  onUpdate,
  onEdit,
  doubleColumn = true,
}: {
  providers: ProxyProviderView[];
  loading?: boolean;
  collapsed: (key: string) => boolean;
  onToggle: (key: string) => void;
  testing?: string | null;
  testingKeys?: ReadonlySet<string>;
  updating?: string | null;
  hideUnavailable?: boolean;
  nodeDisplay?: ProxyNodeDisplay;
  minCardWidth?: number;
  cardSize?: ProxyCardSize;
  disableTextSelect?: boolean;
  low?: number;
  high?: number;
  onTest: (provider: ProxyProviderView, node?: ProxyNodeView) => void;
  onUpdate: (provider: ProxyProviderView) => void;
  onEdit: (provider: ProxyProviderView) => void;
  doubleColumn?: boolean;
}) {
  const { containerRef, isSplit } = useResponsiveProxyColumns(doubleColumn);
  const [leftProviders, rightProviders] = splitProxyItems(providers, isSplit);
  const renderProvider = (provider: ProxyProviderView) => (
    <div
      key={provider.id}
      className="min-w-0"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 148px" }}
    >
    <ProxyProviderCard
      provider={provider}
      collapsed={collapsed(provider.id)}
      testing={testing}
      testingKeys={testingKeys}
      updating={updating === provider.id}
      hideUnavailable={hideUnavailable}
      nodeDisplay={nodeDisplay}
      minCardWidth={minCardWidth}
      cardSize={cardSize}
      disableTextSelect={disableTextSelect}
      low={low}
      high={high}
      onToggle={() => onToggle(provider.id)}
      onTest={(node) => onTest(provider, node)}
      onUpdate={() => onUpdate(provider)}
      onEdit={() => onEdit(provider)}
    />
    </div>
  );
  if (loading && providers.length === 0) return <div ref={containerRef} className={isSplit ? "flex items-start gap-3" : "flex flex-col gap-3"}><div className="h-40 min-w-0 flex-1 animate-pulse rounded-3xl bg-background/45" />{isSplit ? <div className="h-40 min-w-0 flex-1 animate-pulse rounded-3xl bg-background/45" /> : null}</div>;
  return (
    <div
      ref={containerRef}
      className={disableTextSelect ? "min-w-0 select-none" : "min-w-0"}
      data-proxy-card-list
      data-proxy-columns={isSplit ? "double" : "single"}
    >
      {providers.length === 0 ? <ProxyEmptyState kind="providers" /> : (
        <div className={isSplit ? "flex items-start gap-3" : "flex flex-col gap-3"}>
          <div className="flex min-w-0 flex-1 flex-col gap-3">{leftProviders.map(renderProvider)}</div>
          {isSplit ? <div className="flex min-w-0 flex-1 flex-col gap-3">{rightProviders.map(renderProvider)}</div> : null}
        </div>
      )}
    </div>
  );
}
