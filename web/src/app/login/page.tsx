import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  Network,
  Server,
  Shield,
  User,
} from "lucide-react";

import { LoginLogoShowcase } from "@/components/login/LoginLogoShowcase";
import { GlassFilterDefs } from "@/components/liquid-glass/GlassFilterDefs";
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
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDarkTheme(root.classList.contains("dark"));
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    syncTheme();
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

  return (
    <main className="gary-public-page msf-login-shell">
      <GradientWaves
        key={isDarkTheme ? "dark" : "light"}
        className="msf-login-gradient-waves"
        horizonColor={wavePalette.horizon}
        waveColor={wavePalette.wave}
        crestColor={wavePalette.crest}
        speed={0.34}
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
        mouseInteraction
        parallaxStrength={0.28}
        grain
        grainIntensity={0.015}
      />
      <GlassFilterDefs />

      <a className="msf-login-skip" href="#login-form">
        跳到登录表单
      </a>

      <div data-login-version className="msf-login-version" data-no-translate>
        {releaseVersion}
      </div>

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

        <p className="msf-login-stage-footnote">MosDNS · Mihomo</p>
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
