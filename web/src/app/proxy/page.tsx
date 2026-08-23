"use client";

import { AppShell } from "@/components/AppShell";
import { ProxyServiceManager } from "@/components/proxy/ProxyServiceManager";

export default function ProxyPage() {
  return (
    <AppShell>
      <ProxyServiceManager />
    </AppShell>
  );
}
