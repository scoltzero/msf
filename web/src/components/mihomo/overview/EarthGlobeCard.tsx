"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import * as ipaddr from "ipaddr.js";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { formatBytes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MIHOMO_DOWNLOAD_COLOR, MIHOMO_UPLOAD_COLOR } from "./visualColors";
import type { OverviewConnection } from "./OverviewWidgets";
import { buildEarthRoutes } from "./earth/routes";
import {
  DBIP_COMPRESSED_BYTES,
  type EarthEndpointInfo,
  type EarthLocation,
  type EarthOriginSource,
  type GeoDatabaseError,
  type GeoDatabaseStatus,
  type GeoWorkerRequest,
  type GeoWorkerResponse,
} from "./earth/types";
import type { EarthRenderer } from "./earth/EarthRenderer";
import "./EarthGlobeCard.css";

type EarthVisualMode = "flat" | "space";
type OriginStatus = "loading" | "ready" | "error";

const INIT_DELAY = 400;
const INIT_IDLE_TIMEOUT = 1000;
const LOCATION_CACHE_LIMIT = 8192;
const ORIGIN_SOURCE_KEY = "msf-mihomo.earth-origin-source";
const VISUAL_MODE_KEY = "msf-mihomo.earth-visual-mode";

function readSetting<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = window.localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function isValidIP(value: string) {
  return Boolean(value && ipaddr.isValid(value));
}

function maskIP(value: string) {
  if (!isValidIP(value)) return "—";
  const address = ipaddr.parse(value);

  if (address.kind() === "ipv4") {
    const octets = address.toByteArray();
    return `${octets[0]}.${octets[1]}.*.*`;
  }

  const parts = address.toNormalizedString().split(":");
  return `${parts[0]}:${parts[1]}:****:****`;
}

function getColorScheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

async function fetchOrigin(source: EarthOriginSource) {
  if (source === "global") {
    const response = await fetch(`https://api.ip.sb/geoip?t=${Date.now()}`);
    if (!response.ok) throw new Error("ip.sb request failed");
    const data = await response.json() as { ip?: string };
    if (!data.ip || !isValidIP(data.ip)) throw new Error("invalid ip.sb response");
    return data.ip;
  }

  const response = await fetch(`https://myip.ipip.net/json?t=${Date.now()}`);
  if (!response.ok) throw new Error("ipip.info request failed");
  const data = await response.json() as { data?: { ip?: string } };
  const ip = data.data?.ip || "";
  if (!isValidIP(ip)) throw new Error("invalid ipip.info response");
  return ip;
}

function databaseErrorText(error?: GeoDatabaseError) {
  switch (error) {
    case "space": return "浏览器可用存储空间不足，无法保存城市数据库。";
    case "network": return "城市数据库下载失败。";
    case "decompress": return "城市数据库解压失败。";
    case "invalid": return "下载的城市数据库无效。";
    case "storage": return "无法将城市数据库保存到浏览器存储。";
    case "unsupported": return "当前浏览器无法解压城市数据库。";
    default: return "无法加载城市数据库。";
  }
}

function OverlayPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "pointer-events-auto rounded-xl border border-white/15 bg-background/80 px-4 py-3 text-sm shadow-xl backdrop-blur-xl dark:border-white/10",
      className,
    )}>
      {children}
    </div>
  );
}

export interface EarthGlobeCardProps {
  connections: OverviewConnection[];
  embedded?: boolean;
  editing?: boolean;
  size?: "m" | "l";
}

export function EarthGlobeCard({ connections, embedded = false, editing = false, size = "l" }: EarthGlobeCardProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<EarthRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const locationCacheRef = useRef(new Map<string, EarthLocation | null>());
  const lookupRequestsRef = useRef(new Map<number, (value: Record<string, EarthLocation | null>) => void>());
  const lookupIDRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initIdleHandleRef = useRef<number | null>(null);
  const originRequestIDRef = useRef(0);
  const disposedRef = useRef(false);
  const connectionsRef = useRef(connections);
  const editingRef = useRef(editing);
  const originIPRef = useRef("");
  const databaseStatusRef = useRef<GeoDatabaseStatus>("checking");
  const refreshRunningRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  const [databaseStatus, setDatabaseStatus] = useState<GeoDatabaseStatus>("checking");
  const [databaseError, setDatabaseError] = useState<GeoDatabaseError>();
  const [recoveredCorruptCache, setRecoveredCorruptCache] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadTotalBytes, setDownloadTotalBytes] = useState(DBIP_COMPRESSED_BYTES);
  const [originSource, setOriginSource] = useState<EarthOriginSource>(() =>
    readSetting(ORIGIN_SOURCE_KEY, "china", ["china", "global"]),
  );
  const [visualMode, setVisualMode] = useState<EarthVisualMode>(() =>
    readSetting(VISUAL_MODE_KEY, "flat", ["flat", "space"]),
  );
  const [originIP, setOriginIP] = useState("");
  const [originStatus, setOriginStatus] = useState<OriginStatus>("loading");
  const [showOriginIP, setShowOriginIP] = useState(false);
  const [rotationPaused, setRotationPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [routeCount, setRouteCount] = useState(0);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [rendererError, setRendererError] = useState("");
  const [hoveredEndpoint, setHoveredEndpoint] = useState<EarthEndpointInfo | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  connectionsRef.current = connections;
  editingRef.current = editing;
  originIPRef.current = originIP;
  databaseStatusRef.current = databaseStatus;

  const postWorker = useCallback((message: GeoWorkerRequest) => {
    workerRef.current?.postMessage(message);
  }, []);

  const lookupLocations = useCallback(async (ips: string[], locale: string) => {
    const result: Record<string, EarthLocation | null> = {};
    const missing: string[] = [];
    const cache = locationCacheRef.current;

    for (const ip of ips) {
      if (cache.has(ip)) result[ip] = cache.get(ip) ?? null;
      else missing.push(ip);
    }

    if (missing.length > 0) {
      const id = ++lookupIDRef.current;
      const locations = await new Promise<Record<string, EarthLocation | null>>((resolve) => {
        lookupRequestsRef.current.set(id, resolve);
        postWorker({ type: "lookup", id, ips: missing, locale });
      });

      for (const [ip, location] of Object.entries(locations)) {
        cache.set(ip, location);
        result[ip] = location;
      }

      while (cache.size > LOCATION_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }

    return result;
  }, [postWorker]);

  const refreshRoutes = useCallback(async () => {
    if (refreshRunningRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshRunningRef.current = true;
    do {
      refreshQueuedRef.current = false;

      if (databaseStatusRef.current !== "ready" || !isValidIP(originIPRef.current)) {
        setRouteCount(0);
        rendererRef.current?.setRoutes([]);
        continue;
      }

      setRoutesLoading(true);
      try {
        const result = await buildEarthRoutes(
          connectionsRef.current,
          originIPRef.current,
          navigator.language || "zh-CN",
          lookupLocations,
        );

        if (!disposedRef.current) {
          setRouteCount(result.routes.length);
          if (result.origin) rendererRef.current?.setInitialLocation(result.origin);
          rendererRef.current?.setRoutes(result.routes);
        }
      } catch {
        if (!disposedRef.current) {
          setRouteCount(0);
          rendererRef.current?.setRoutes([]);
        }
      } finally {
        if (!disposedRef.current) setRoutesLoading(false);
      }
    } while (refreshQueuedRef.current && !disposedRef.current);

    refreshRunningRef.current = false;
  }, [lookupLocations]);

  const scheduleRouteRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshRoutes();
    }, 150);
  }, [refreshRoutes]);

  const loadOrigin = useCallback(async (source: EarthOriginSource, force = false) => {
    const requestID = ++originRequestIDRef.current;
    const cacheKey = `msf-mihomo.earth-origin-ip.${source}`;
    const cached = force ? "" : window.sessionStorage.getItem(cacheKey) || "";

    if (isValidIP(cached)) {
      setOriginIP(cached);
      setOriginStatus("ready");
      return;
    }

    setOriginStatus("loading");
    setOriginIP("");
    setRouteCount(0);
    rendererRef.current?.setRoutes([]);

    try {
      const ip = await fetchOrigin(source);
      if (requestID !== originRequestIDRef.current) return;
      window.sessionStorage.setItem(cacheKey, ip);
      setOriginIP(ip);
      setOriginStatus("ready");
    } catch {
      if (requestID !== originRequestIDRef.current) return;
      setOriginStatus("error");
      setOriginIP("");
    }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(ORIGIN_SOURCE_KEY, originSource); } catch { /* noop */ }
    void loadOrigin(originSource);
  }, [loadOrigin, originSource]);

  useEffect(() => {
    try { window.localStorage.setItem(VISUAL_MODE_KEY, visualMode); } catch { /* noop */ }
    rendererRef.current?.setVisualMode(visualMode);
  }, [visualMode]);

  useEffect(() => {
    rendererRef.current?.setAutoRotation(!editing && !rotationPaused);
  }, [editing, rotationPaused]);

  useEffect(() => {
    rendererRef.current?.setReducedMotion(editing || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [editing]);

  useEffect(() => {
    scheduleRouteRefresh();
  }, [connections, databaseStatus, originIP, scheduleRouteRefresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const host = canvasRef.current?.closest(".gary-page-enter");
    host?.classList.add("earth-globe-expanded-host");
    return () => host?.classList.remove("earth-globe-expanded-host");
  }, [expanded]);

  useEffect(() => {
    disposedRef.current = false;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleReducedMotion = () => rendererRef.current?.setReducedMotion(media.matches || editingRef.current);
    media.addEventListener("change", handleReducedMotion);

    const themeObserver = new MutationObserver(() => {
      rendererRef.current?.setColorScheme(getColorScheme());
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const handleWorkerMessage = ({ data }: MessageEvent<GeoWorkerResponse>) => {
      if (data.type === "lookup") {
        lookupRequestsRef.current.get(data.id)?.(data.locations);
        lookupRequestsRef.current.delete(data.id);
        return;
      }

      setDatabaseStatus(data.status);
      if (data.error) setDatabaseError(data.error);
      if (data.recoveredCorruptCache) setRecoveredCorruptCache(true);
      if (data.received != null) setDownloadedBytes(data.received);
      if (data.total != null) setDownloadTotalBytes(data.total);
      if (data.status !== "ready" && data.status !== "downloading") {
        setRouteCount(0);
        rendererRef.current?.setRoutes([]);
      }
    };

    const initialize = async () => {
      if (disposedRef.current) return;
      const worker = new Worker(new URL("./earth/geoip.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.addEventListener("message", handleWorkerMessage);
      worker.postMessage({ type: "init" } satisfies GeoWorkerRequest);

      try {
        const { createEarthRenderer } = await import("./earth/EarthRenderer");
        if (!canvasRef.current || disposedRef.current) return;
        const renderer = await createEarthRenderer(canvasRef.current, {
          reducedMotion: media.matches || editingRef.current,
          visualMode,
          colorScheme: getColorScheme(),
          onEndpointHover(info, x, y) {
            setHoveredEndpoint(info);
            if (x != null && y != null) setTooltipPosition({ x, y });
          },
        });

        if (disposedRef.current) {
          renderer.dispose();
          return;
        }

        rendererRef.current = renderer;
        renderer.setAutoRotation(!editing && !rotationPaused);
        scheduleRouteRefresh();
      } catch {
        canvasRef.current?.replaceChildren();
        setRendererError("当前浏览器无法初始化全球连接渲染器。");
      }
    };

    initTimerRef.current = setTimeout(() => {
      initTimerRef.current = null;
      if (typeof window.requestIdleCallback === "function") {
        initIdleHandleRef.current = window.requestIdleCallback(() => {
          initIdleHandleRef.current = null;
          void initialize();
        }, { timeout: INIT_IDLE_TIMEOUT });
      } else {
        initIdleTimerRef.current = setTimeout(() => {
          initIdleTimerRef.current = null;
          void initialize();
        });
      }
    }, INIT_DELAY);

    return () => {
      disposedRef.current = true;
      media.removeEventListener("change", handleReducedMotion);
      themeObserver.disconnect();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
      if (initIdleTimerRef.current) clearTimeout(initIdleTimerRef.current);
      if (initIdleHandleRef.current != null) window.cancelIdleCallback(initIdleHandleRef.current);
      rendererRef.current?.dispose();
      rendererRef.current = null;
      workerRef.current?.removeEventListener("message", handleWorkerMessage);
      workerRef.current?.terminate();
      workerRef.current = null;
      lookupRequestsRef.current.clear();
    };
    // Renderer initialization intentionally runs once; live values are synced through refs/effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadProgress = Math.min(
    100,
    (downloadedBytes / Math.max(1, downloadTotalBytes)) * 100,
  );
  const displayedOriginIP = originStatus === "loading"
    ? "获取中…"
    : originStatus === "error"
      ? "获取失败"
      : showOriginIP ? originIP : maskIP(originIP);
  const showNoData = databaseStatus === "ready"
    && originStatus === "ready"
    && !routesLoading
    && routeCount === 0;
  const showRetry = databaseStatus === "error"
    || originStatus === "error"
    || (databaseStatus === "ready" && routeCount === 0 && connections.length > 0);
  const tooltipStyle = useMemo<CSSProperties>(() => ({
    left: `${Math.min(window.innerWidth - 220, tooltipPosition.x + 12)}px`,
    top: `${Math.min(window.innerHeight - 150, tooltipPosition.y + 12)}px`,
  }), [tooltipPosition]);

  const toggleRotation = () => setRotationPaused((current) => !current);

  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className={cn("text-xs font-semibold uppercase tracking-wider text-muted-foreground", embedded && "sr-only")}>
          全球连接
        </div>
        <div className="flex items-center gap-1">
          <select
            value={visualMode}
            onChange={(event) => setVisualMode(event.target.value as EarthVisualMode)}
            className="h-8 rounded-lg border-0 bg-transparent px-2 text-xs text-foreground hover:bg-muted/55 focus:outline-none focus:ring-2 focus:ring-primary/35"
            aria-label="地球样式"
            title="地球样式"
          >
            <option value="space">星空</option>
            <option value="flat">扁平</option>
          </select>
          <button
            type="button"
            onClick={toggleRotation}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            aria-label={rotationPaused ? "继续地球自转" : "停止地球自转"}
            title={rotationPaused ? "继续地球自转" : "停止地球自转"}
            aria-pressed={rotationPaused}
          >
            {rotationPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            aria-label={expanded ? "还原地球画面" : "扩展地球画面"}
            title={expanded ? "还原地球画面" : "扩展地球画面"}
            aria-pressed={expanded}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className={cn(
        "relative mt-2 w-full overflow-hidden rounded-xl",
        expanded ? "min-h-0 flex-1" : embedded ? (size === "m" ? "min-h-[280px] flex-1" : "min-h-[360px] flex-1") : "h-96",
        visualMode === "flat" ? "bg-muted/30" : "bg-black",
      )}>
        <div ref={canvasRef} className="absolute inset-0 touch-none" />

        <div className="pointer-events-none absolute left-2 right-2 top-2 flex flex-wrap gap-1.5 text-xs">
          <select
            value={originSource}
            onChange={(event) => setOriginSource(event.target.value as EarthOriginSource)}
            className="pointer-events-auto h-8 rounded-lg border border-white/15 bg-background/75 px-2 text-xs text-foreground shadow backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-primary/35"
            aria-label="公网 IP 服务"
          >
            <option value="china">ipip.info</option>
            <option value="global">ip.sb</option>
          </select>
          <div className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-background/75 px-2 text-foreground shadow backdrop-blur-md">
            <span className="text-muted-foreground">本机 IP</span>
            <span className="font-mono">{displayedOriginIP}</span>
            <button
              type="button"
              onClick={() => setShowOriginIP((value) => !value)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted/60"
              aria-label="显示或隐藏本机 IP"
            >
              {showOriginIP ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          </div>
          {showRetry ? (
            <button
              type="button"
              onClick={() => {
                if (databaseStatus === "error") postWorker({ type: "download" });
                if (originStatus === "error") void loadOrigin(originSource, true);
                if (databaseStatus === "ready" && originStatus === "ready") scheduleRouteRefresh();
              }}
              className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-background/75 text-foreground shadow backdrop-blur-md hover:bg-background/90"
              aria-label="重试"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="pointer-events-none absolute bottom-2 right-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-x-3 gap-y-1 rounded-lg border border-white/15 bg-background/75 px-2 py-1.5 text-[11px] text-foreground shadow backdrop-blur-md">
          <span className="flex items-center gap-1"><i className="h-0.5 w-4 bg-[#5fcaff]" />连接线路</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MIHOMO_UPLOAD_COLOR }} />上传</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MIHOMO_DOWNLOAD_COLOR }} />下载</span>
        </div>

        <div className={cn(
          "absolute bottom-2 left-2 flex flex-col items-start gap-0.5 text-[10px]",
          visualMode === "flat" ? "text-muted-foreground" : "text-white/65",
        )}>
          <a className="hover:underline" href="https://db-ip.com/db/lite.php" target="_blank" rel="noopener noreferrer">DB-IP City Lite</a>
          <a className="hover:underline" href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener noreferrer">Solar System Scope · CC BY 4.0</a>
        </div>

        {rendererError ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <OverlayPanel className="max-w-sm text-center text-destructive">{rendererError}</OverlayPanel>
          </div>
        ) : databaseStatus === "checking" || databaseStatus === "loading-cache" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <OverlayPanel className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
              {databaseStatus === "checking" ? "正在检查本地城市数据库…" : "正在加载缓存的城市数据库…"}
            </OverlayPanel>
          </div>
        ) : databaseStatus === "idle" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <OverlayPanel className="max-w-md">
              <div className="font-semibold text-foreground">下载本地城市数据库？</div>
              <p className="mt-1.5 leading-5 text-muted-foreground">
                所有连接端点都只在此浏览器中查询。DB-IP City Lite 下载约需 61.7 MB，解压后约占 130.2 MB 本地存储空间。
              </p>
              {recoveredCorruptCache ? <p className="mt-1.5 text-xs text-amber-600">已移除损坏的数据库缓存，请下载完整副本以恢复定位。</p> : null}
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => postWorker({ type: "download" })} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90">下载数据库</button>
                <a className="text-xs text-primary hover:underline" href="https://db-ip.com/db/lite.php" target="_blank" rel="noopener noreferrer">了解 DB-IP City Lite</a>
              </div>
            </OverlayPanel>
          </div>
        ) : databaseStatus === "downloading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <OverlayPanel className="w-80 max-w-full">
              <div className="flex items-center justify-between gap-3"><span className="font-semibold">正在下载城市数据库</span><span className="text-xs text-muted-foreground">{formatBytes(downloadedBytes)} / {formatBytes(downloadTotalBytes)}</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${downloadProgress}%` }} /></div>
              <button type="button" onClick={() => postWorker({ type: "cancel" })} className="mt-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">取消</button>
            </OverlayPanel>
          </div>
        ) : databaseStatus === "error" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <OverlayPanel className="max-w-sm text-center"><div className="text-destructive">{databaseErrorText(databaseError)}</div><button type="button" onClick={() => postWorker({ type: "download" })} className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs font-semibold hover:bg-muted/75">重试</button></OverlayPanel>
          </div>
        ) : originStatus === "error" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4"><OverlayPanel>无法探测本机公网 IP，请重试后再定位连接。</OverlayPanel></div>
        ) : showNoData ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4"><OverlayPanel>{connections.length ? "无法定位当前活跃连接的端点" : "暂无活跃连接"}</OverlayPanel></div>
        ) : null}
      </div>

      {hoveredEndpoint && typeof document !== "undefined" ? createPortal(
        <div className="pointer-events-none fixed z-[10000] min-w-40 rounded-lg border border-border bg-background p-2 text-xs shadow-xl" style={tooltipStyle}>
          <div className="font-semibold">{[hoveredEndpoint.city, hoveredEndpoint.country].filter(Boolean).join(", ") || "未知"}</div>
          <div className="mt-1 text-muted-foreground">角色：{hoveredEndpoint.role === "origin" ? "本机" : "目标"}</div>
          <div className="text-muted-foreground">连接数：{hoveredEndpoint.connections}</div>
          {hoveredEndpoint.role === "destination" && hoveredEndpoint.topHosts.length ? (
            <div className="mt-2 border-t border-border pt-1.5"><div className="mb-1 text-muted-foreground">下载量 Top 5 Host</div>{hoveredEndpoint.topHosts.map((item, index) => <div key={`${item.host}-${index}`} className="flex max-w-64 items-center justify-between gap-3 leading-5"><span className="min-w-0 truncate font-mono">{item.host}</span><span className="shrink-0 text-muted-foreground">{formatBytes(item.downloaded)}</span></div>)}</div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </>
  );

  const className = cn(
    "earth-globe-card flex min-w-0 flex-col",
    embedded ? "h-full min-h-0" : "rounded-2xl p-4",
    expanded && "earth-globe-card--expanded",
  );
  return embedded
    ? <div className={className}>{content}</div>
    : <GlassSurface material="thick" className={className}>{content}</GlassSurface>;
}
