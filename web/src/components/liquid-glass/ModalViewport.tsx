"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

let bodyScrollLocks = 0;
let previousBodyOverflow = "";

function lockBodyScroll() {
  if (bodyScrollLocks === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLocks += 1;
}

function unlockBodyScroll() {
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
  if (bodyScrollLocks === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
}

export function ModalViewport({
  children,
  onClose,
  className,
  overlayClassName,
  closeOnEscape = true,
  lockScroll = true,
}: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
  overlayClassName?: string;
  closeOnEscape?: boolean;
  lockScroll?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
    if (lockScroll) lockBodyScroll();

    const onKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === "Escape") closeRef.current?.();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (lockScroll) unlockBodyScroll();
    };
  }, [closeOnEscape, lockScroll]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[100] isolate flex items-center justify-center overscroll-contain p-3 sm:p-4",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 z-0 animate-fade-in",
          overlayClassName ?? "bg-slate-950/25 dark:bg-black/50",
        )}
        onClick={onClose}
      />
      <div className="pointer-events-none relative z-[1] flex max-h-full w-full items-center justify-center [&>*]:pointer-events-auto">
        {children}
      </div>
    </div>,
    document.body,
  );
}
