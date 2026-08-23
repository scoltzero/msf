import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavItem[];
}

export interface InfoRow {
  label: string;
  value: string;
}

export interface ServiceStatus {
  name: string;
  icon: LucideIcon;
  configured: boolean;
  running?: boolean;
  cpu?: string;
  memory?: string;
  uptime?: string;
}
