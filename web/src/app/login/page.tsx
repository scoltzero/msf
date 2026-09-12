import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  Network,
  Megaphone,
  Server,
  Shield,
  User,
  X,
} from "lucide-react";

import { LoginLogoShowcase } from "@/components/login/LoginLogoShowcase";
import { GlassFilterDefs } from "@/components/liquid-glass/GlassFilterDefs";
import { SceneBackdrop } from "@/components/liquid-glass/SceneBackdrop";
import GlassSurface from "@/components/react-bits/GlassSurface";
import GradientWaves from "@/components/react-bits/GradientWaves";
import { api, apiData } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { GLASS_QUALITY_PROFILES, normalizeGlassQuality } from "@/lib/glass-quality";
import { DEFAULT_SKIN, isSkinId, type SkinId } from "@/lib/skin";

import "./login.css";

const features = [
  { icon: Server, label: "DNS 服务" },
  { icon: Shield, label: "代理管理" },
  { icon: Network, label: "网络优化" },
];

const loginWaveFallbacks = {
  light: {
    horizon: "#f3fbff",
    wave: "#00366f",
    crest: "#24d7ee",
  },
  dark: {
    horizon: "#0d0f11",
    wave: "#243241",
    crest: "#126b9e",
  },
} as const;

type LoginWavePalette = {
  horizon: string;
  wave: string;
  crest: string;
};

function readLoginWavePalette(root: HTMLElement): LoginWavePalette {
  const fallback = root.classList.contains("dark") ? loginWaveFallbacks.dark : loginWaveFallbacks.light;
  const style = window.getComputedStyle(root);
  return {
    horizon: style.getPropertyValue("--gary-scene-wave-horizon").trim() || fallback.horizon,
    wave: style.getPropertyValue("--gary-scene-wave").trim() || fallback.wave,
    crest: style.getPropertyValue("--gary-scene-wave-crest").trim() || fallback.crest,
  };
}

const LOGIN_ANNOUNCEMENT_ID = "2026-09-v0.6.5-mosdns-cache-runtime";
const LOGIN_ANNOUNCEMENT_HIDDEN_KEY = `msf-login-announcement:${LOGIN_ANNOUNCEMENT_ID}:hidden`;
const LOGIN_ANNOUNCEMENT_SESSION_KEY = `msf-login-announcement:${LOGIN_ANNOUNCEMENT_ID}:session`;

function readLoginAnnouncementVisible() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(LOGIN_ANNOUNCEMENT_HIDDEN_KEY) !== "1" &&
      window.sessionStorage.getItem(LOGIN_ANNOUNCEMENT_SESSION_KEY) !== "1";
  } catch {
    return true;
  }
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [releaseVersion, setReleaseVersion] = useState("未知");
  const [announcementVisible, setAnnouncementVisible] = useState(readLoginAnnouncementVisible);
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  const [sceneMode, setSceneMode] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.dataset.garyScene || "dynamic" : "dynamic"
  );
  const [qualityMode, setQualityMode] = useState(() =>
    normalizeGlassQuality(typeof document !== "undefined" ? document.documentElement.dataset.garyQuality : undefined)
  );
  const [skinMode, setSkinMode] = useState<SkinId>(() => {
    if (typeof document === "undefined") return DEFAULT_SKIN;
    const value = document.documentElement.dataset.skin;
    return isSkinId(value) ? value : DEFAULT_SKIN;
  });
  const [wavePalette, setWavePalette] = useState<LoginWavePalette>(() => {
    if (typeof document === "undefined") return loginWaveFallbacks.light;
    return readLoginWavePalette(document.documentElement);
  });

  useEffect(() => {
    const root = document.documentElement;
    const syncAppearance = () => {
      setIsDarkTheme(root.classList.contains("dark"));
      setSceneMode(root.dataset.garyScene || "dynamic");
      setQualityMode(normalizeGlassQuality(root.dataset.garyQuality));
      setSkinMode(isSkinId(root.dataset.skin) ? root.dataset.skin : DEFAULT_SKIN);
      setWavePalette(readLoginWavePalette(root));
    };
    const observer = new MutationObserver(syncAppearance);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-gary-scene", "data-gary-quality", "data-skin"] });
    syncAppearance();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<any>("/api/v1/version", { skipAuth: true })
      .then((payload) => {
        const version = apiData<{ version?: string }>(payload)?.version;
        if (!cancelled && version) {
          setReleaseVersion(`v ${version}`);
        }
      })
      .catch(() => {
        /* leave as 未知 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username, password);
      const state = location.state as { from?: unknown } | null;
      const stateRedirect = typeof state?.from === "string" ? state.from : "";
      const redirect = stateRedirect || params.get("redirect") || "/";
      navigate(redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const passwordToggleLabel = showPassword ? "隐藏密码" : "显示密码";
  const qualityProfile = GLASS_QUALITY_PROFILES[qualityMode];

  const closeAnnouncementForSession = () => {
    try {
      window.sessionStorage.setItem(LOGIN_ANNOUNCEMENT_SESSION_KEY, "1");
    } catch {
      // Storage restrictions should not prevent closing the announcement now.
    }
    setAnnouncementVisible(false);
  };

  const hideAnnouncementPermanently = () => {
    try {
      window.localStorage.setItem(LOGIN_ANNOUNCEMENT_HIDDEN_KEY, "1");
    } catch {
      // Storage restrictions should not prevent closing the announcement now.
    }
    setAnnouncementVisible(false);
  };

  return (
    <main className="gary-public-page msf-login-shell">
      {sceneMode === "neutral" ? (
        <SceneBackdrop />
      ) : (
        <GradientWaves
          key={`${skinMode}-${isDarkTheme ? "dark" : "light"}-${qualityMode}`}
          className="msf-login-gradient-waves"
          horizonColor={wavePalette.horizon}
          waveColor={wavePalette.wave}
          crestColor={wavePalette.crest}
          speed={sceneMode === "static" ? 0 : qualityProfile.speed}
          amplitude={3.4}
          waveScale={0.72}
          waveRatio={0.9}
          swell={38}
          turbulence={22}
          tilt={1.11}
          zoom={1}
          height={5.5}
          fogDepth={48}
          detail={qualityProfile.detail}
          brightness={1}
          opacity={1}
          mouseInteraction={sceneMode === "dynamic" && qualityMode === "full"}
          parallaxStrength={qualityMode === "full" ? 0.28 : 0}
          grain={qualityMode === "full"}
          grainIntensity={0.015}
          maxRenderPixels={qualityProfile.pixels}
          maxDpr={qualityProfile.dpr}
          powerPreference="high-performance"
        />
      )}
      <GlassFilterDefs />

      <a className="msf-login-skip" href="#login-form">
        跳到登录表单
      </a>

      <div data-login-version className="msf-login-version" data-no-translate>
        {releaseVersion}
      </div>

      {announcementVisible ? (
        <aside className="msf-login-announcement" aria-labelledby="login-announcement-title">
          <button
            type="button"
            className="msf-login-announcement-close"
            onClick={closeAnnouncementForSession}
            aria-label="关闭本次更新公告"
            title="本次关闭"
          >
            <X aria-hidden="true" />
          </button>

          <div className="msf-login-announcement-heading">
            <span className="msf-login-announcement-icon" aria-hidden="true"><Megaphone /></span>
            <div>
              <p>本次更新</p>
              <h2 id="login-announcement-title">v0.6.5：MosDNS 缓存与运行稳定性修复</h2>
            </div>
          </div>

          <ol className="msf-login-announcement-features">
            <li>
              <strong>MosDNS FakeIP 缓存修复</strong>
              <span>前置缓存不再持久化 FakeIP 响应，lazy 缓存保留期调整为 1 天；升级和清空 DNS 缓存会同步清理旧缓存与自动学习的 FakeIP 分流记忆。</span>
            </li>
            <li>
              <strong>Mihomo 与运行可靠性</strong>
              <span>修复 Rule Provider 更新 405、控制器会话误退出、MosDNS 分支误匹配和容器 CPU 指标问题；Sing-box 预留 DNS 端口已从 111 调整为 11101。</span>
            </li>
          </ol>

          <p className="msf-login-announcement-note">
            <strong>升级提示</strong>
            已有安装升级后会自动修复旧 MosDNS 缓存模板；若手工配置仍使用 127.0.0.1:111，请改为 127.0.0.1:11101。
          </p>

          <div className="msf-login-announcement-actions">
            <a href="https://github.com/scoltzero/msf" target="_blank" rel="noreferrer">前往 GitHub</a>
            <button type="button" onClick={hideAnnouncementPermanently}>不再显示</button>
          </div>
        </aside>
      ) : null}

      <section className="msf-login-stage" aria-labelledby="msf-login-brand-title">
        <div className="msf-login-brand-lockup">
          <img src="/logo/logo-square.svg" alt="" aria-hidden="true" />
          <div>
            <strong>MSF</strong>
            <span>网络服务控制台</span>
          </div>
        </div>

        <div className="msf-login-stage-content">
          <div className="msf-login-brand-visual">
            <LoginLogoShowcase />
          </div>

          <div className="msf-login-stage-copy">
            <p className="msf-login-stage-kicker" data-no-translate>
              MSF / NETWORK CONTROL
            </p>
            <h1 id="msf-login-brand-title">网络服务，尽在掌握</h1>
            <p className="msf-login-stage-description">
              统一管理您的网络服务，提供 DNS 分流、代理管理等功能
            </p>

            <ul className="msf-login-capabilities" aria-label="平台功能">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.label}>
                    <span className="msf-login-capability-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span>{feature.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <p className="msf-login-stage-footnote">MosDNS · Sing-box · Mihomo</p>
      </section>

      <section className="msf-login-entry" aria-labelledby="msf-login-title">
        <div className="msf-login-mobile-brand">
          <img src="/logo/logo-square.svg" alt="" aria-hidden="true" />
          <div>
            <strong>MSF</strong>
            <span>网络服务控制台</span>
          </div>
        </div>

        <div className="msf-login-glass-dock">
          <GlassSurface
            width="min(100%, 29rem)"
            height="auto"
            borderRadius={38}
            className="msf-login-card"
          >
            <div className="msf-login-mobile-logo">
              <LoginLogoShowcase compact />
            </div>

            <div className="msf-login-card-heading">
              <p className="msf-login-kicker">安全管理入口</p>
              <h2 id="msf-login-title">欢迎回来</h2>
              <p>登录后继续管理当前 MSF 实例</p>
            </div>

            <form id="login-form" className="msf-login-form" onSubmit={submit}>
              <div className="msf-login-control">
                <label htmlFor="login-username">用户名</label>
                <div className="msf-login-field">
                  <User aria-hidden="true" />
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="请输入用户名"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "login-error" : undefined}
                  />
                </div>
              </div>

              <div className="msf-login-control">
                <label htmlFor="login-password">密码</label>
                <div className="msf-login-field">
                  <Lock aria-hidden="true" />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "login-error" : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={passwordToggleLabel}
                    aria-pressed={showPassword}
                    className="msf-login-password-toggle"
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {error ? (
                <div id="login-error" className="msf-login-error" role="alert" aria-live="polite">
                  {error}
                </div>
              ) : null}

              <button type="submit" disabled={busy} className="msf-login-submit">
                <GlassSurface
                  width="100%"
                  height="3.45rem"
                  borderRadius={15}
                  saturation={1.14}
                  className="msf-login-submit-glass"
                >
                  {busy ? (
                    <Loader2 className="msf-login-spinner" aria-hidden="true" />
                  ) : (
                    <LogIn aria-hidden="true" />
                  )}
                  <span>{busy ? "登录中..." : "登录"}</span>
                </GlassSurface>
              </button>
            </form>

            <div className="msf-login-card-footer">
              <Shield aria-hidden="true" />
              <p>请使用初始化时创建的账号登录</p>
            </div>
          </GlassSurface>
        </div>
      </section>
    </main>
  );
}
