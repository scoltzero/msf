import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { OrbRenderer, type OrbRendererBackend, type OrbRenderState } from "./OrbRenderer";
import "./assistant-orb.css";

interface AssistantOrbProps {
  state?: OrbRenderState;
  onClick?: () => void;
  disabled?: boolean;
}

export function AssistantOrb({ state = "idle", onClick, disabled = false }: AssistantOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<OrbRenderer | null>(null);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dockedSide, setDockedSide] = useState<"left" | "right" | null>(null);
  const [rendererBackend, setRendererBackend] = useState<OrbRendererBackend | null>(null);

  const getBounds = () => {
    const size = 72;
    const mobile = window.innerWidth <= 767;
    const bottomClearance = mobile ? 96 : 16;
    return {
      size,
      minX: -size / 2,
      maxX: Math.max(-size / 2, window.innerWidth - size / 2),
      minY: 8,
      maxY: Math.max(8, window.innerHeight - size - bottomClearance),
    };
  };

  const clampPosition = (x: number, y: number) => {
    const bounds = getBounds();
    return {
      x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
      y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
    };
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("msf-assistant-orb-position");
      if (!raw) return;
      const saved = JSON.parse(raw) as { x?: number; y?: number };
      if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) setPosition(clampPosition(Number(saved.x), Number(saved.y)));
    } catch {
      // A blocked storage area should not prevent the assistant from opening.
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => current ? clampPosition(current.x, current.y) : current);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || disabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRendererBackend(null);
      return;
    }
    const renderer = new OrbRenderer(canvas);
    rendererRef.current = renderer;
    let disposed = false;
    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe(canvas);
    const handleVisibility = () => renderer.setPaused(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", handleVisibility);
    renderer.init().then((backend) => {
      if (!disposed) setRendererBackend(backend);
    }).catch(() => {
      if (!disposed) setRendererBackend(null);
    });
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      observer.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [disabled]);

  useEffect(() => {
    rendererRef.current?.setState(state);
  }, [state]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const origin = position || { x: rect.left, y: rect.top };
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    };
    element.setPointerCapture?.(event.pointerId);
    element.style.right = "auto";
    element.style.bottom = "auto";
    element.style.left = `${origin.x}px`;
    element.style.top = `${origin.y}px`;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    const next = clampPosition(drag.originX + dx, drag.originY + dy);
    const element = event.currentTarget;
    element.style.left = `${next.x}px`;
    element.style.top = `${next.y}px`;
    element.classList.add("assistant-orb--dragging");
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const bounds = getBounds();
    let next = clampPosition(rect.left, rect.top);
    let side: "left" | "right" | null = null;
    const dockThreshold = Math.max(40, bounds.size * 0.55);
    if (next.x <= dockThreshold) {
      next = { ...next, x: bounds.minX };
      side = "left";
    } else if (next.x >= bounds.maxX - dockThreshold) {
      next = { ...next, x: bounds.maxX };
      side = "right";
    }
    setPosition(next);
    setDockedSide(side);
    try {
      window.localStorage.setItem("msf-assistant-orb-position", JSON.stringify(next));
    } catch {
      // Position persistence is optional.
    }
    element.releasePointerCapture?.(event.pointerId);
    element.classList.remove("assistant-orb--dragging");
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClick?.();
  };

  return (
    <button
      type="button"
      ref={orbRef}
      className={cn("assistant-orb", `assistant-orb--${state}`, rendererBackend ? "assistant-orb--rendered" : "assistant-orb--fallback", position && "assistant-orb--positioned", dockedSide && `assistant-orb--docked-${dockedSide}`)}
      data-renderer={rendererBackend || "fallback"}
      style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      disabled={disabled}
      aria-label="打开 AI 助手，可拖动到屏幕边缘"
      title="打开 AI 助手，拖动可贴边隐藏"
    >
      <canvas ref={canvasRef} className="assistant-orb__canvas" aria-hidden="true" />
      <span className="assistant-orb__fallback" aria-hidden="true" />
      <span className="assistant-orb__edge" aria-hidden="true" />
    </button>
  );
}
