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

import "./login.css";

const features = [
  { icon: Server, label: "DNS 服务" },
  { icon: Shield, label: "代理管理" },
  { icon: Network, label: "网络优化" },
];

const loginWavePalettes = {
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

const LOGIN_ANNOUNCEMENT_ID = "2026-08-v0.6.2-smart-core";
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

  useEffect(() => {
    const root = document.documentElement;
    const syncAppearance = () => {
      setIsDarkTheme(root.classList.contains("dark"));
      setSceneMode(root.dataset.garyScene || "dynamic");
    };
    const observer = new MutationObserver(syncAppearance);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-gary-scene"] });
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
  const wavePalette = isDarkTheme ? loginWavePalettes.dark : loginWavePalettes.light;

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
          key={isDarkTheme ? "dark" : "light"}
          className="msf-login-gradient-waves"
          horizonColor={wavePalette.horizon}
          waveColor={wavePalette.wave}
          crestColor={wavePalette.crest}
          speed={sceneMode === "static" ? 0 : 0.34}
          amplitude={3.4}
          waveScale={0.72}
          waveRatio={0.9}
          swell={38}
          turbulence={22}
          tilt={1.11}
          zoom={1}
          height={5.5}
          fogDepth={48}
          detail="medium"
          brightness={1}
          opacity={1}
          mouseInteraction={sceneMode === "dynamic"}
          parallaxStrength={0.28}
          grain
          grainIntensity={0.015}
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
              <h2 id="login-announcement-title">v0.6.2：Mihomo Smart 核心</h2>
            </div>
          </div>

          <ol className="msf-login-announcement-features">
            <li>
              <strong>Meta / Smart 双核心</strong>
              <span>现在可选择官方稳定版或 Smart Alpha 核心，并编辑 <code>smart</code> 代理分组；两种核心都会保留，切换回来无需重复下载。</span>
            </li>
            <li>
              <strong>资源与配置更可靠</strong>
              <span>LightGBM 与 ASN 数据支持进度和取消；切换核心会先回到默认配置并保留用户配置。Smart 属于实验性 Alpha 功能，使用前建议备份配置。</span>
            </li>
          </ol>

          <p className="msf-login-announcement-note">
            <strong>PS</strong>
            MSF 因代码审计未能完整保留仓库原有的 Star 与 Fork，需要各位老用户的一份助力，感激不尽。
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
