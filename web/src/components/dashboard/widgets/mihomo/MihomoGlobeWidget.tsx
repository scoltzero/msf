"use client";

import { EarthGlobeCard } from "@/components/mihomo/overview/EarthGlobeCard";
import type { OverviewConnection } from "@/components/mihomo/overview/OverviewWidgets";

export interface MihomoGlobeWidgetProps {
  connections: OverviewConnection[];
  size?: "m" | "l";
  editing?: boolean;
}

/** Mount this component only while its dashboard instance is visible. */
export function MihomoGlobeWidget({ connections, size = "l", editing = false }: MihomoGlobeWidgetProps) {
  return <EarthGlobeCard connections={connections} size={size} editing={editing} embedded />;
}
