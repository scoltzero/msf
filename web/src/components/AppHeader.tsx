"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleHelp,
  Languages,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Stethoscope,
  Sun,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { api, apiData, getToken } from "@/lib/api";
import { useLanguage, type AppLanguage } from "@/lib/localization";
import { applyTheme, getInitialTheme, prefersDarkMode, themeOptions, type ThemeMode } from "@/lib/appearance";

const languageOptions: Array<{ id: AppLanguage; label: string }> = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "English" },
];
const README_URL = "https://github.com/zAhYAng/msf/blob/main/README.md";

export function AppHeader({ onToggleSidebar, onOpenDiagnostics, sidebarHidden = false }: { onToggleSidebar?: () => void; onOpenDiagnostics?: () => void; sidebarHidden?: boolean }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [themeOpen, setThemeOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const isDark = theme === "dark" || (theme === "system" && prefersDarkMode());
  const ThemeIcon = theme === "system" ? Monitor : isDark ? Moon : Sun;
  const username = user?.username || "root";
  const displayName = user?.display_name || user?.username || "root";
  const role = user?.role === "admin" ? "管理员" : user?.role || "用户";
  const initial = displayName.slice(0, 1).toUpperCase();

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || typeof window === "undefined") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  useEffect(() => {
    if (!getToken()) return;
    api("/api/v1/settings/appearance")
      .then((payload) => {
        const data = apiData<Record<string, string>>(payload, {});
        if (data.language === "en-US" || data.language === "en") setLanguage("en-US");
        if (data.language === "zh-CN" || data.language === "zh") setLanguage("zh-CN");
      })
      .catch(() => undefined);
  }, [setLanguage]);

  const selectLanguage = (next: AppLanguage) => {
    setLanguage(next);
    setLangOpen(false);
    void api("/api/v1/settings/appearance", {
      method: "PUT",
      body: JSON.stringify({ language: next }),
    }).catch(() => undefined);
  };

  useEffect(() => {
    const close = () => {
      setThemeOpen(false);
      setLangOpen(false);
      setUserOpen(false);
    };
    if (themeOpen || langOpen || userOpen) {
      window.addEventListener("click", close);
      return () => window.removeEventListener("click", close);
    }
  }, [themeOpen, langOpen, userOpen]);

  const selectTheme = (mode: ThemeMode) => {
    setTheme(mode);
    applyTheme(mode);
    setThemeOpen(false);
  };

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-4 md:pt-4">
      <div className="flex h-12 items-center md:h-14">
        <div className="gary-glass gary-glass--ultrathin gary-glass--overflow-visible pointer-events-auto flex h-full items-center gap-1 rounded-[19.2px] p-1.5 pr-3 md:w-36">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="gary-icon-button hidden h-9 w-9 rounded-[13px] text-muted-foreground md:inline-flex"
            title={sidebarHidden ? "展开侧边栏" : "收起侧边栏"}
            aria-label={sidebarHidden ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!sidebarHidden}
            aria-controls="desktop-sidebar"
          >
            {sidebarHidden ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center md:h-10 md:w-10">
              <Image alt="MSF" src="/logo/logo-square.svg" width={36} height={36} className="h-8 w-8 object-contain md:h-9 md:w-9" />
            </div>
            <span className="text-base font-semibold tracking-[-0.02em] text-foreground md:text-lg">
              MSF
            </span>
          </div>
        </div>

        <div className="gary-glass gary-glass--ultrathin gary-glass--overflow-visible pointer-events-auto ml-auto flex h-full items-center gap-0.5 rounded-[19.2px] p-1 md:gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setThemeOpen((open) => !open);
                setLangOpen(false);
                setUserOpen(false);
              }}
              className="gary-icon-button h-9 w-9 rounded-[13px] border-0 bg-transparent text-muted-foreground shadow-none"
              title="切换主题"
              aria-label="切换主题"
            >
              <ThemeIcon className="h-5 w-5" />
            </button>
            {themeOpen && (
              <div
                onClick={(event) => event.stopPropagation()}
                className="gary-popover absolute right-0 z-50 mt-2 w-44 animate-slide-up p-1.5"
              >
                {themeOptions.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => selectTheme(id)}
                    className="gary-popover__item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {label}
                    </span>
                    {theme === id && <Check className="h-4 w-4 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setLangOpen((open) => !open);
                setThemeOpen(false);
                setUserOpen(false);
              }}
              className="gary-icon-button h-9 w-9 rounded-[13px] border-0 bg-transparent text-muted-foreground shadow-none"
              title="语言"
              aria-label="语言"
            >
              <Languages className="h-5 w-5" />
            </button>
            {langOpen && (
              <div
                onClick={(event) => event.stopPropagation()}
                className="gary-popover absolute right-0 z-50 mt-2 w-40 animate-slide-up p-1.5"
              >
                {languageOptions.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => selectLanguage(item.id)}
                    className="gary-popover__item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-foreground"
                  >
                    {item.label}
                    {language === item.id && <Check className="h-4 w-4 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setUserOpen((open) => !open);
                setThemeOpen(false);
                setLangOpen(false);
              }}
              className="gary-icon-button h-10 gap-2 rounded-[14px] border-0 bg-transparent px-1.5 shadow-none md:gap-3 md:pr-3"
              aria-label="打开用户菜单"
            >
              <div className="gary-solid-plate flex h-8 w-8 items-center justify-center rounded-[12px] text-sm font-semibold text-foreground md:h-9 md:w-9">
                {initial}
              </div>
              <div className="hidden items-center gap-2 lg:flex">
                <div className="text-left">
                  <div className="text-sm font-medium text-foreground">{displayName}</div>
                  <div className="text-xs text-muted-foreground">{role}</div>
                </div>
              </div>
            </button>
            {userOpen && (
              <div
                onClick={(event) => event.stopPropagation()}
                className="gary-popover absolute right-0 z-50 mt-3 w-72 animate-slide-up p-2"
              >
                <div className="gary-solid-plate mb-2 flex items-center gap-3 rounded-[14px] px-3 py-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-foreground/[0.07] text-base font-semibold text-foreground">
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{username}</div>
                    <div className="text-xs text-muted-foreground">{role}</div>
                  </div>
                </div>

                {[
                  { label: "个人信息", Icon: User, onClick: () => router.push("/settings?tab=profile") },
                  { label: "系统设定", Icon: Settings, onClick: () => router.push("/settings") },
                  ...(user?.role !== "guest" ? [{ label: "系统诊断", Icon: Stethoscope, onClick: () => { setUserOpen(false); onOpenDiagnostics?.(); } }] : []),
                  ...(user?.role === "admin" ? [{ label: "用户管理", Icon: Users, onClick: () => router.push("/settings/users") }] : []),
                  { label: "帮助文档", Icon: CircleHelp, onClick: () => window.location.assign(README_URL) },
                ].map(({ label, Icon, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    className="gary-popover__item flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-foreground"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {label}
                  </button>
                ))}

                <div className="my-1 border-t border-border/60" />
                <button
                  onClick={() => {
                    logout();
                    router.push("/login");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                  )}
                >
                  <LogOut className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
