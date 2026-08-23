import { LayoutDashboard } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { PageHeader } from "@/components/layout/PageHeader";

export default function Home() {
  return (
    <AppShell>
      <div className="space-y-4 md:space-y-6 animate-fade-in relative">
        <PageHeader icon={LayoutDashboard} title="仪表盘" description="系统概览 · 实时监控" />

        <Dashboard />
      </div>
    </AppShell>
  );
}
