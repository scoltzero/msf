import { useId, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

const FLOW_DELAYS = [0, 0.8, 1.6, 2.4, 3.2];
const SIDE_FLOW_DELAYS = [0.4, 1.2, 2, 2.8, 3.6];
const LOGIN_LOGO_MOTION_ASSET_BASE = "/logo-motion/assets";
const LOGIN_LOGO_MOTION_FIT = "matrix(1.60068 0 0 1.60068 -307.55 -310.75)";

type LoginLogoShowcaseProps = {
  compact?: boolean;
  className?: string;
};

type LoginMotionLogoProps = {
  compact: boolean;
  maskId: string;
};

function LoginMotionLogo({ compact, maskId }: LoginMotionLogoProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="MSF"
      className={cn(
        "login-motion-logo relative z-10 overflow-visible drop-shadow-2xl",
        compact ? "h-[4.4rem] w-[4.4rem]" : "h-[6.6rem] w-[6.6rem]",
      )}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="285" y="175" width="460" height="430">
          <rect x="285" y="175" width="460" height="430" fill="black" />
          <path
            className="login-motion-draw-stroke"
            pathLength="1"
            d="M 365 552 C 365 486 365 360 365 278 C 365 238 416 229 437 266 L 508 414 C 530 458 552 458 575 414 L 636 286 C 660 238 700 241 700 284 C 700 356 700 480 700 552"
            fill="none"
            stroke="white"
            strokeWidth="165"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1 1"
            strokeDashoffset="0"
          />
          <rect className="login-motion-final-fill" x="285" y="175" width="460" height="430" fill="white" opacity="1" />
        </mask>
      </defs>

      <g fill="none" transform={LOGIN_LOGO_MOTION_FIT}>
        <image
          className="login-motion-branch-left"
          x="213"
          y="504"
          width="303"
          height="319"
          href={`${LOGIN_LOGO_MOTION_ASSET_BASE}/msm_branch_left_original.png`}
          preserveAspectRatio="none"
        />
        <image
          className="login-motion-branch-right"
          x="508"
          y="504"
          width="303"
          height="313"
          href={`${LOGIN_LOGO_MOTION_ASSET_BASE}/msm_branch_right_original.png`}
          preserveAspectRatio="none"
        />
        <image
          className="login-motion-m-original"
          x="313"
          y="205"
          width="399"
          height="361"
          href={`${LOGIN_LOGO_MOTION_ASSET_BASE}/msm_m_original.png`}
          preserveAspectRatio="none"
          mask={`url(#${maskId})`}
        />
      </g>
    </svg>
  );
}

export function LoginLogoShowcase({ compact = false, className }: LoginLogoShowcaseProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientInId = `login-logo-gradient-in-${id}`;
  const gradientLeftId = `login-logo-gradient-left-${id}`;
  const gradientRightId = `login-logo-gradient-right-${id}`;
  const motionMaskId = `login-logo-motion-mask-${id}`;

  useGSAP(
    () => {
      const q = gsap.utils.selector(rootRef);
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(q(".login-logo-card"), { y: 0, rotation: 0 });
        gsap.set(q(".login-logo-tile"), { rotation: 0 });
        gsap.set(q(".login-orbit-ring"), { rotation: 0 });
        gsap.set(q(".login-flow-dot"), { autoAlpha: 0 });
        gsap.set(q(".login-ping"), { autoAlpha: 0 });
        gsap.set(q(".login-pulse-core"), { xPercent: -50, yPercent: -50, scale: 1, autoAlpha: 1 });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.set(cardRef.current, { y: 0, rotation: -2, transformOrigin: "50% 50%" });
        gsap.to(cardRef.current, {
          y: -10,
          rotation: 2,
          duration: 2,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });

        gsap.to(tileRef.current, {
          rotation: 360,
          duration: 16,
          repeat: -1,
          ease: "none",
          transformOrigin: "50% 50%",
        });

        gsap.to(q(".login-orbit-ring-1"), {
          rotation: 360,
          duration: 10,
          repeat: -1,
          ease: "none",
          transformOrigin: "50% 50%",
        });
        gsap.to(q(".login-orbit-ring-2"), {
          rotation: -360,
          duration: 15,
          repeat: -1,
          ease: "none",
          transformOrigin: "50% 50%",
        });
        gsap.to(q(".login-orbit-ring-3"), {
          rotation: 360,
          duration: 20,
          repeat: -1,
          ease: "none",
          transformOrigin: "50% 50%",
        });

        gsap.to(q(".login-flow-path"), {
          strokeDashoffset: -12,
          duration: 1.5,
          repeat: -1,
          ease: "none",
        });

        gsap.to(q(".login-source-glow"), {
          scale: 1.35,
          autoAlpha: 0.35,
          duration: 2,
          repeat: -1,
          yoyo: true,
          stagger: 0.45,
          ease: "sine.inOut",
          transformOrigin: "50% 50%",
        });

        q(".login-flow-dot-in").forEach((dot) => {
          const delay = Number((dot as HTMLElement).dataset.delay || 0);
          gsap.fromTo(
            dot,
            { y: -100, xPercent: -50, scale: 0.8, autoAlpha: 0 },
            {
              keyframes: [
                { y: -50, scale: 1, autoAlpha: 1, duration: 0.6 },
                { y: 0, scale: 1.1, autoAlpha: 1, duration: 1.4 },
                { y: 0, scale: 0.9, autoAlpha: 0, duration: 0.2 },
                { y: 0, scale: 0.8, autoAlpha: 0, duration: 1.8 },
              ],
              repeat: -1,
              delay,
              ease: "none",
            },
          );
        });

        q(".login-flow-dot-left").forEach((dot) => {
          const delay = Number((dot as HTMLElement).dataset.delay || 0);
          gsap.fromTo(
            dot,
            { x: 0, yPercent: -50, scale: 0.8, autoAlpha: 0 },
            {
              keyframes: [
                { x: 0, scale: 0.8, autoAlpha: 0, duration: 2 },
                { x: -10, scale: 1, autoAlpha: 1, duration: 0.2 },
                { x: -100, scale: 0.8, autoAlpha: 0, duration: 1.8 },
              ],
              repeat: -1,
              delay,
              ease: "none",
            },
          );
        });

        q(".login-flow-dot-right").forEach((dot) => {
          const delay = Number((dot as HTMLElement).dataset.delay || 0);
          gsap.fromTo(
            dot,
            { x: 0, yPercent: -50, scale: 0.8, autoAlpha: 0 },
            {
              keyframes: [
                { x: 0, scale: 0.8, autoAlpha: 0, duration: 2 },
                { x: 10, scale: 1, autoAlpha: 1, duration: 0.2 },
                { x: 100, scale: 0.8, autoAlpha: 0, duration: 1.8 },
              ],
              repeat: -1,
              delay,
              ease: "none",
            },
          );
        });

        q(".login-ping").forEach((ping, index) => {
          gsap.fromTo(
            ping,
            { xPercent: -50, yPercent: -50, scale: 0.6, autoAlpha: 0.55 },
            {
              scale: 2.15,
              autoAlpha: 0,
              duration: 2,
              repeat: -1,
              delay: index * 0.5,
              ease: "sine.out",
            },
          );
        });

        gsap.fromTo(
          q(".login-pulse-core"),
          { xPercent: -50, yPercent: -50, scale: 1, autoAlpha: 1 },
          {
            scale: 1.45,
            autoAlpha: 0.6,
            duration: 1,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            transformOrigin: "50% 50%",
          },
        );
      });

      return () => mm.revert();
    },
    { scope: rootRef },
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative mx-auto flex items-center justify-center",
        compact ? "h-[6.75rem] w-[6.75rem]" : "h-[10.25rem] w-[10.25rem]",
        className,
      )}
      aria-label="MSF logo"
    >
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden="true"
          className={cn(
            "login-glow-halo absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl animate-pulse-subtle",
            compact ? "h-[6.75rem] w-[6.75rem]" : "h-[10.25rem] w-[10.25rem]",
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "login-glow-halo absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/10 blur-2xl animate-pulse-subtle lg:block",
            compact ? "lg:hidden" : "h-[10.25rem] w-[10.25rem]",
          )}
        />
        <div aria-hidden="true" className="absolute left-1/2 top-0 -translate-x-1/2">
          <div className={cn("login-source-glow rounded-full bg-primary/30 blur-md", compact ? "h-4 w-4" : "h-5 w-5")} />
        </div>
        <div aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2">
          <div className={cn("login-source-glow rounded-full bg-green-400/30 blur-md", compact ? "h-4 w-4" : "h-5 w-5")} />
        </div>
        <div aria-hidden="true" className="absolute right-0 top-1/2 -translate-y-1/2">
          <div className={cn("login-source-glow rounded-full bg-blue-400/30 blur-md", compact ? "h-4 w-4" : "h-5 w-5")} />
        </div>

        {!compact && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -m-24">
            <svg className="absolute inset-0 h-full w-full opacity-40" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradientInId} x1="50%" y1="0%" x2="50%" y2="100%">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0" />
                  <stop offset="50%" stopColor="#0ea5e9" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.6" />
                </linearGradient>
                <linearGradient id={gradientLeftId} x1="100%" y1="50%" x2="0%" y2="50%">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                </linearGradient>
                <linearGradient id={gradientRightId} x1="0%" y1="50%" x2="100%" y2="50%">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className="login-flow-path" d="M 50 0 L 50 50" stroke={`url(#${gradientInId})`} strokeWidth="0.7" strokeDasharray="8 4" fill="none" strokeLinecap="round" />
              <path className="login-flow-path" d="M 50 50 L 0 50" stroke={`url(#${gradientLeftId})`} strokeWidth="0.7" strokeDasharray="8 4" fill="none" strokeLinecap="round" />
              <path className="login-flow-path" d="M 50 50 L 100 50" stroke={`url(#${gradientRightId})`} strokeWidth="0.7" strokeDasharray="8 4" fill="none" strokeLinecap="round" />
            </svg>

            {FLOW_DELAYS.map((delay) => (
              <span
                key={`in-${delay}`}
                data-delay={delay}
                className="login-flow-dot login-flow-dot-in absolute left-1/2 top-0 h-2.5 w-2.5 rounded-full bg-gradient-to-r from-primary to-purple-500 shadow-lg shadow-primary/40"
              />
            ))}
            {SIDE_FLOW_DELAYS.map((delay) => (
              <span
                key={`left-${delay}`}
                data-delay={delay}
                className="login-flow-dot login-flow-dot-left absolute left-0 top-1/2 h-2.5 w-2.5 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 shadow-lg shadow-green-400/30"
              />
            ))}
            {SIDE_FLOW_DELAYS.map((delay) => (
              <span
                key={`right-${delay}`}
                data-delay={delay}
                className="login-flow-dot login-flow-dot-right absolute right-0 top-1/2 h-2.5 w-2.5 rounded-full bg-gradient-to-r from-blue-400 to-cyan-500 shadow-lg shadow-blue-400/30"
              />
            ))}
          </div>
        )}

        <div
          aria-hidden="true"
          className={cn(
            "login-orbit-ring login-orbit-ring-1 absolute rounded-full border-[3px] border-primary/30",
            compact ? "-inset-2" : "-inset-4",
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "login-orbit-ring login-orbit-ring-2 absolute rounded-full border-[3px] border-blue-400/20",
            compact ? "-inset-4" : "-inset-6",
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "login-orbit-ring login-orbit-ring-3 absolute rounded-full border-2 border-purple-400/15",
            compact ? "hidden" : "-inset-8 hidden lg:block",
          )}
        />

        <div
          ref={cardRef}
          className={cn(
            "login-logo-card relative flex items-center justify-center rounded-3xl bg-white shadow-2xl dark:bg-slate-800",
            compact ? "h-[6.75rem] w-[6.75rem]" : "h-[10.25rem] w-[10.25rem]",
          )}
        >
          <div ref={tileRef} aria-hidden="true" className="login-logo-tile absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/20 via-transparent to-blue-400/20" />
          <LoginMotionLogo compact={compact} maskId={motionMaskId} />
        </div>

        <span aria-hidden="true" className={cn("login-ping absolute left-1/2 top-1/2 rounded-full bg-primary/40", compact ? "h-3 w-3" : "h-4 w-4")} />
        <span aria-hidden="true" className={cn("login-ping absolute left-1/2 top-1/2 rounded-full bg-primary/60", compact ? "hidden" : "hidden h-3 w-3 lg:block")} />
        <span aria-hidden="true" className={cn("login-pulse-core absolute left-1/2 top-1/2 rounded-full bg-primary", compact ? "h-1.5 w-1.5" : "h-2 w-2")} />
      </div>
    </div>
  );
}
