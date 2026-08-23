"use client";

import { useState, useCallback } from "react";
import { ToastStack, type ToastItem } from "@/components/rules/RuleDialogs";

export function useToaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const showToast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  }, []);
  return { toasts, showToast };
}

export { ToastStack };
