import { useEffect, useRef, useState, type ReactNode } from "react";

/** Retain layout space and mount optional content only near the viewport. */
export function DeferredSection({ children, height = 280 }: { children: ReactNode; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "120px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} style={{ minHeight: height }}>{visible ? children : null}</div>;
}
