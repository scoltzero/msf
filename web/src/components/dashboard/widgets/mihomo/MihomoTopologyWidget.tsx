"use client";

import { ConnectionSankey, type OverviewConnection } from "@/components/mihomo/overview/OverviewWidgets";

export interface MihomoTopologyWidgetProps {
  connections: OverviewConnection[];
  size?: "m" | "l";
  editing?: boolean;
}

export function MihomoTopologyWidget({ connections, size = "l", editing = false }: MihomoTopologyWidgetProps) {
  return <ConnectionSankey connections={connections} size={size} editing={editing} embedded />;
}
