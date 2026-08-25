import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";

import HomePage from "@/app/page";
import LoginPage from "@/app/login/page";
import MosdnsPage from "@/app/mosdns/page";
import MosdnsOverviewPage from "@/app/mosdns/overview/page";
import MosdnsRulesPage from "@/app/mosdns/rules/page";
import MosdnsClientsPage from "@/app/mosdns/clients/page";
import MosdnsQueryLogPage from "@/app/mosdns/query-log/page";
import MosdnsTrafficPage from "@/app/mosdns/traffic/page";
import MosdnsSystemPage from "@/app/mosdns/system/page";
import MosdnsConfigPage from "@/app/mosdns/service-config/page";
import MosdnsLogsPage from "@/app/mosdns/logs/page";
import ProxyPage from "@/app/proxy/page";
import MihomoPage from "@/app/mihomo/page";
import MihomoOverviewPage from "@/app/mihomo/overview/page";
import MihomoConnectionsPage from "@/app/mihomo/connections/page";
import MihomoConfigPage from "@/app/mihomo/config/page";
import MihomoLogsPage from "@/app/mihomo/logs/page";
import ProcessPage from "@/app/process/page";
import ConfigPage from "@/app/config/page";
import LogsPage from "@/app/logs/page";
import { SettingsClient } from "@/app/settings/SettingsClient";
import { SetupPage } from "@/pages/SetupPage";
import { LiquidGlassLab } from "@/pages/LiquidGlassLab";
import { SceneBackdrop } from "@/components/liquid-glass/SceneBackdrop";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";

const MihomoProxiesPage = lazy(() => import("@/app/mihomo/proxies/page"));
const MihomoRulesPage = lazy(() => import("@/app/mihomo/rules/page"));

function Splash() {
  return (
    <div className="gary-public-page grid min-h-screen place-items-center text-foreground">
      <SceneBackdrop />
      <GlassSurface material="thick" className="flex items-center gap-3 px-5 py-4">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">正在加载 MSF 管理平台</span>
      </GlassSurface>
    </div>
  );
}

function InitializationFailure({ message, onRetry }: { message?: string | null; onRetry: () => void }) {
  return (
    <div className="gary-public-page grid min-h-screen place-items-center px-4 text-foreground">
      <SceneBackdrop />
      <GlassSurface material="thick" className="w-full max-w-md p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/15 text-yellow-700 dark:text-yellow-300">
            <AlertCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold">无法确认系统状态</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {message || "初始化状态检查失败，请检查服务是否正常运行后重试。"}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
          </div>
        </div>
      </GlassSurface>
    </div>
  );
}

function safeInternalRedirect(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function RequireReady({ children }: { children: React.ReactNode }) {
  const { loading, initialized, initializationError, user, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (initializationError || initialized === null) {
    return <InitializationFailure message={initializationError} onRetry={() => void refresh()} />;
  }
  if (!initialized) return <Navigate to="/setup" replace />;
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }
  return children;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { loading, initialized, initializationError, user, refresh } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  if (loading) return <Splash />;
  if (initializationError || initialized === null) {
    return <InitializationFailure message={initializationError} onRetry={() => void refresh()} />;
  }
  if (!initialized) return <Navigate to="/setup" replace />;
  if (user) {
    const state = location.state as { from?: unknown } | null;
    return <Navigate to={safeInternalRedirect(state?.from || params.get("redirect"))} replace />;
  }
  return children;
}

function SetupRoute() {
  const { loading, initialized, initializationError, refresh } = useAuth();
  if (loading) return <Splash />;
  if (initializationError || initialized === null) {
    return <InitializationFailure message={initializationError} onRetry={() => void refresh()} />;
  }
  return <SetupPage />;
}

function SettingsRoute() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  const valid = new Set(["profile", "system", "users", "appearance", "update", "reset"]);
  return <SettingsClient initialTab={valid.has(tab || "") ? (tab as any) : "profile"} />;
}

function protectedRoute(element: React.ReactNode) {
  return <RequireReady>{element}</RequireReady>;
}

function MihomoProxiesRoute() {
  return (
    <Suspense fallback={<Splash />}>
      <MihomoProxiesPage />
    </Suspense>
  );
}

function MihomoRulesRoute() {
  return (
    <Suspense fallback={<Splash />}>
      <MihomoRulesPage />
    </Suspense>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupRoute />} />
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />

      <Route path="/" element={protectedRoute(<HomePage />)} />
      <Route path="/mosdns" element={protectedRoute(<MosdnsPage />)} />
      <Route path="/mosdns/overview" element={protectedRoute(<MosdnsOverviewPage />)} />
      <Route path="/mosdns/rules" element={protectedRoute(<MosdnsRulesPage />)} />
      <Route path="/mosdns/clients" element={protectedRoute(<MosdnsClientsPage />)} />
      <Route path="/mosdns/query-log" element={protectedRoute(<MosdnsQueryLogPage />)} />
      <Route path="/mosdns/traffic" element={protectedRoute(<MosdnsTrafficPage />)} />
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

      <Route path="/mihomo" element={protectedRoute(<MihomoPage />)} />
      <Route path="/mihomo/overview" element={protectedRoute(<MihomoOverviewPage />)} />
      <Route path="/mihomo/proxies" element={protectedRoute(<MihomoProxiesRoute />)} />
      <Route path="/mihomo/rules" element={protectedRoute(<MihomoRulesRoute />)} />
      <Route path="/mihomo/connections" element={protectedRoute(<MihomoConnectionsPage />)} />
      <Route path="/mihomo/config" element={protectedRoute(<MihomoConfigPage />)} />
      <Route path="/mihomo/logs" element={protectedRoute(<MihomoLogsPage />)} />

      <Route path="/process" element={protectedRoute(<ProcessPage />)} />
      <Route path="/config" element={protectedRoute(<ConfigPage />)} />
      <Route path="/logs" element={protectedRoute(<LogsPage />)} />
      <Route path="/logs/:service" element={protectedRoute(<LogsPage />)} />
      <Route path="/settings" element={protectedRoute(<SettingsRoute />)} />
      <Route path="/settings/users" element={protectedRoute(<SettingsClient initialTab="users" />)} />
      <Route path="/system" element={<Navigate to="/?dialog=diagnostics" replace />} />

      {import.meta.env.DEV ? (
        <Route path="/__liquid-glass-lab" element={protectedRoute(<LiquidGlassLab />)} />
      ) : null}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
