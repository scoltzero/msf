import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

import HomePage from "@/app/page";
import LoginPage from "@/app/login/page";
import MosdnsPage from "@/app/mosdns/page";
import MosdnsOverviewPage from "@/app/mosdns/overview/page";
import MosdnsRulesPage from "@/app/mosdns/rules/page";
import MosdnsClientsPage from "@/app/mosdns/clients/page";
import MosdnsQueryLogPage from "@/app/mosdns/query-log/page";
import MosdnsSystemPage from "@/app/mosdns/system/page";
import MosdnsConfigPage from "@/app/mosdns/service-config/page";
import MosdnsLogsPage from "@/app/mosdns/logs/page";
import ProxyPage from "@/app/proxy/page";
import MihomoOverviewPage from "@/app/mihomo/overview/page";
import MihomoProxiesPage from "@/app/mihomo/proxies/page";
import MihomoRulesPage from "@/app/mihomo/rules/page";
import MihomoConnectionsPage from "@/app/mihomo/connections/page";
import MihomoConfigPage from "@/app/mihomo/config/page";
import MihomoLogsPage from "@/app/mihomo/logs/page";
import ProcessPage from "@/app/process/page";
import ConfigPage from "@/app/config/page";
import LogsPage from "@/app/logs/page";
import UsersPage from "@/app/users/page";
import SystemPage from "@/app/system/page";
import { SettingsClient } from "@/app/settings/SettingsClient";
import { SetupPage } from "@/pages/SetupPage";
import { SingBoxPage } from "@/pages/SingBoxPage";

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="flex items-center gap-3 rounded-xl border bg-card px-5 py-4 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">正在加载 MSF 管理平台</span>
      </div>
    </div>
  );
}

function RequireReady({ children }: { children: React.ReactNode }) {
  const { loading, initialized, user } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!initialized) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { loading, initialized, user } = useAuth();
  if (loading) return <Splash />;
  if (!initialized) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function SettingsRoute() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  const valid = new Set(["profile", "system", "appearance", "update", "reset"]);
  return <SettingsClient initialTab={valid.has(tab || "") ? (tab as any) : "profile"} />;
}

function protectedRoute(element: React.ReactNode) {
  return <RequireReady>{element}</RequireReady>;
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />

      <Route path="/" element={protectedRoute(<HomePage />)} />
      <Route path="/mosdns" element={protectedRoute(<MosdnsPage />)} />
      <Route path="/mosdns/overview" element={protectedRoute(<MosdnsOverviewPage />)} />
      <Route path="/mosdns/rules" element={protectedRoute(<MosdnsRulesPage />)} />
      <Route path="/mosdns/clients" element={protectedRoute(<MosdnsClientsPage />)} />
      <Route path="/mosdns/query-log" element={protectedRoute(<MosdnsQueryLogPage />)} />
      <Route path="/mosdns/system" element={protectedRoute(<MosdnsSystemPage />)} />
      <Route path="/mosdns/service-config" element={protectedRoute(<MosdnsConfigPage />)} />
      <Route path="/mosdns/logs" element={protectedRoute(<MosdnsLogsPage />)} />

      <Route path="/proxy" element={protectedRoute(<ProxyPage />)} />
      <Route path="/proxy/overview" element={<Navigate to="/proxy" replace />} />
      <Route path="/proxy/config" element={<Navigate to="/mihomo/config" replace />} />
      <Route path="/proxy/logs" element={<Navigate to="/mihomo/logs" replace />} />
      <Route path="/proxy/mihomo" element={<Navigate to="/mihomo/overview" replace />} />
      <Route path="/proxy/mihomo/proxies" element={<Navigate to="/mihomo/proxies" replace />} />
      <Route path="/proxy/mihomo/rules" element={<Navigate to="/mihomo/rules" replace />} />
      <Route path="/proxy/mihomo/connections" element={<Navigate to="/mihomo/connections" replace />} />
      <Route path="/proxy/mihomo/logs" element={<Navigate to="/mihomo/logs" replace />} />
      <Route path="/proxy/mihomo/config" element={<Navigate to="/mihomo/config" replace />} />

      <Route path="/mihomo" element={<Navigate to="/mihomo/overview" replace />} />
      <Route path="/mihomo/overview" element={protectedRoute(<MihomoOverviewPage />)} />
      <Route path="/mihomo/proxies" element={protectedRoute(<MihomoProxiesPage />)} />
      <Route path="/mihomo/rules" element={protectedRoute(<MihomoRulesPage />)} />
      <Route path="/mihomo/connections" element={protectedRoute(<MihomoConnectionsPage />)} />
      <Route path="/mihomo/config" element={protectedRoute(<MihomoConfigPage />)} />
      <Route path="/mihomo/logs" element={protectedRoute(<MihomoLogsPage />)} />

      <Route path="/singbox/overview" element={protectedRoute(<SingBoxPage tab="overview" />)} />
      <Route path="/singbox/config" element={protectedRoute(<SingBoxPage tab="config" />)} />
      <Route path="/singbox/logs" element={protectedRoute(<LogsPage initialService="singbox" />)} />

      <Route path="/process" element={protectedRoute(<ProcessPage />)} />
      <Route path="/config" element={protectedRoute(<ConfigPage />)} />
      <Route path="/logs" element={protectedRoute(<LogsPage />)} />
      <Route path="/logs/:service" element={protectedRoute(<LogsPage />)} />
      <Route path="/users" element={protectedRoute(<UsersPage />)} />
      <Route path="/settings" element={protectedRoute(<SettingsRoute />)} />
      <Route path="/system" element={protectedRoute(<SystemPage />)} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
