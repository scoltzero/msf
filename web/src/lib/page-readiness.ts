import { useEffect, useRef, useState } from "react";

/** Defer optional work until the current page has rendered its primary data. */
export function useDeferredWork(enabled: boolean, delay = 200) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(timer);
  }, [enabled, delay]);
  return ready && enabled;
}

export function usePageReady(ready: boolean) {
  const reported = useRef(false);
  useEffect(() => {
    if (!ready || reported.current) return;
    reported.current = true;
    // The mark records a committed primary-data render, not network completion.
    performance.mark("msf-primary-ready");
    window.dispatchEvent(new CustomEvent("msf-page-ready", { detail: window.location.pathname }));
  }, [ready]);
}
