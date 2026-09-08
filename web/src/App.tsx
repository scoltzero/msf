import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";

const SceneBackdrop = lazy(() => import("@/components/liquid-glass/SceneBackdrop").then(m => ({ default: m.SceneBackdrop })));
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";

// Route-level code splitting: the SPA used to ship as one ~3.1MB bundle that
// stalled cold browser loads.  Every page now loads on demand; shared vendor
// groups are split in vite.config.ts.  Named exports are adapted for lazy().
const HomePage = lazy(() => import("@/app/page"));
const LoginPage = lazy(() => import("@/app/login/page"));
const MosdnsPage = lazy(() => import("@/app/mosdns/page"));
const MosdnsOverviewPage = lazy(() => import("@/app/mosdns/overview/page"));
const MosdnsRulesPage = lazy(() => import("@/app/mosdns/rules/page"));
const MosdnsClientsPage = lazy(() => import("@/app/mosdns/clients/page"));
const MosdnsQueryLogPage = lazy(() => import("@/app/mosdns/query-log/page"));
const MosdnsSystemPage = lazy(() => import("@/app/mosdns/system/page"));
const MosdnsConfigPage = lazy(() => import("@/app/mosdns/service-config/page"));
const MosdnsLogsPage = lazy(() => import("@/app/mosdns/logs/page"));
const ProxyPage = lazy(() => import("@/app/proxy/page"));
const MihomoPage = lazy(() => import("@/app/mihomo/page"));
const loadMihomoOverview = () => import("@/app/mihomo/overview/page");
const MihomoOverviewPage = lazy(loadMihomoOverview);
const loadMihomoProxies = () => import("@/app/mihomo/proxies/page");
const MihomoProxiesPage = lazy(loadMihomoProxies);
const MihomoRulesPage = lazy(() => import("@/app/mihomo/rules/page"));
const MihomoConnectionsPage = lazy(() => import("@/app/mihomo/connections/page"));
const MihomoConfigPage = lazy(() => import("@/app/mihomo/config/page"));
const MihomoLogsPage = lazy(() => import("@/app/mihomo/logs/page"));
const ProcessPage = lazy(() => import("@/app/process/page"));
const ConfigPage = lazy(() => import("@/app/config/page"));
const LogsPage = lazy(() => import("@/app/logs/page"));
const SettingsClient = lazy(() => import("@/app/settings/SettingsClient").then((m) => ({ default: m.SettingsClient })));
const SetupPage = lazy(() => import("@/pages/SetupPage").then((m) => ({ default: m.SetupPage })));
const SingBoxPage = lazy(() => import("@/pages/SingBoxPage").then((m) => ({ default: m.SingBoxPage })));
const LiquidGlassLab = lazy(() => import("@/pages/LiquidGlassLab").then((m) => ({ default: m.LiquidGlassLab })));

function Splash() {
  return (
    <div className="gary-public-page grid min-h-screen place-items-center text-foreground">
      <div className="gary-scene bg-background" aria-hidden="true" />
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
      <div className="gary-scene bg-background" aria-hidden="true" />
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
  return (
    <Suspense fallback={<Splash />}>
      <SetupPage />
    </Suspense>
  );
}

function SettingsRoute() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  const valid = new Set(["profile", "system", "users", "appearance", "update", "reset"]);
  return <SettingsClient initialTab={valid.has(tab || "") ? (tab as any) : "profile"} />;
}

function protectedRoute(element: React.ReactNode) {
  // Auth resolves first; the per-route lazy chunk then streams in behind the
  // same Splash used for the initial load.
  return (
    <RequireReady>
      <Suspense fallback={<Splash />}>{element}</Suspense>
    </RequireReady>
  );
}

export function App() {
  const { pathname } = useLocation();
  const { user, initialized, loading } = useAuth();
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    // Public route code loads alongside auth; protected API calls still wait.
    const load = pathname === "/mihomo/proxies" ? loadMihomoProxies
      : pathname === "/mihomo/overview" ? loadMihomoOverview : undefined;
    void load?.().catch(() => undefined);
  }, [pathname]);
  useEffect(() => {
    if (!user) { setSceneReady(false); return; }
    if (loading || !initialized) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => { timer = setTimeout(() => setSceneReady(true), 150); };
    const onReady = (event: Event) => {
      if ((event as CustomEvent<string>).detail === pathname) reveal();
    };
    window.addEventListener("msf-page-ready", onReady);
    if (!["/mihomo/proxies", "/mihomo/overview"].includes(pathname)) reveal();
    return () => { window.removeEventListener("msf-page-ready", onReady); clearTimeout(timer); };
  }, [pathname, user, initialized, loading]);
  const publicPage = pathname === "/login" || pathname === "/setup";
  return (
    <>
      {!publicPage && sceneReady && user && initialized
        ? <Suspense fallback={null}><SceneBackdrop /></Suspense>
        : null}

    <Suspense fallback={<Splash />}>
      <Routes>
      <Route path="/setup" element={<SetupRoute />} />
      <Route
        path="/login"
        element={
          <PublicOnly>
            <Suspense fallback={<Splash />}>
              <LoginPage />
            </Suspense>
          </PublicOnly>
        }
      />

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

      <Route path="/mihomo" element={protectedRoute(<MihomoPage />)} />
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
      <Route path="/settings" element={protectedRoute(<SettingsRoute />)} />
      <Route path="/settings/users" element={protectedRoute(<SettingsClient initialTab="users" />)} />
      <Route path="/system" element={<Navigate to="/?dialog=diagnostics" replace />} />

      {import.meta.env.DEV ? (
        <Route path="/__liquid-glass-lab" element={protectedRoute(<LiquidGlassLab />)} />
      ) : null}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </>
  );
}
