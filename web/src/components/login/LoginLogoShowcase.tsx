import { cn } from "@/lib/utils";

type LoginLogoShowcaseProps = {
  compact?: boolean;
  className?: string;
};

export function LoginLogoShowcase({ compact = false, className }: LoginLogoShowcaseProps) {
  return (
    <div
      className={cn("msf-orbit-mark", compact && "msf-orbit-mark--compact", className)}
      role="img"
      aria-label="MSF"
    >
      <div className="msf-orbit-mark__aura" aria-hidden="true" />
      <div className="msf-orbit-mark__ring msf-orbit-mark__ring--far" aria-hidden="true" />
      <div className="msf-orbit-mark__ring msf-orbit-mark__ring--near" aria-hidden="true" />
      <div className="msf-orbit-mark__ring msf-orbit-mark__ring--polar" aria-hidden="true" />
      <div className="msf-orbit-mark__tile" aria-hidden="true">
        <img
          src="/logo-motion/msf-mizar-orbit-weave.svg"
          alt=""
          draggable={false}
          className="msf-orbit-mark__logo"
        />
      </div>
    </div>
  );
}
