import { useCallback, useEffect, useState } from "react";
import { getAssistantStatus } from "@/features/assistant/api";
import { useAuth } from "@/lib/auth";
import { AssistantOrb } from "./orb/AssistantOrb";
import { AssistantPanel } from "./AssistantPanel";
import type { OrbRenderState } from "./orb/OrbRenderer";
import "./assistant.css";

export function AssistantWidget() {
  const [enabled, setEnabled] = useState(false);
  const [orbEnabled, setOrbEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OrbRenderState>("idle");
  const { user } = useAuth();

  useEffect(() => {
    if (user?.role !== "admin") {
      setEnabled(false);
      setOrbEnabled(false);
      return;
    }
    let active = true;
    const refresh = () => {
      getAssistantStatus().then((status) => {
        if (!active) return;
        setEnabled(Boolean(status.admin && status.enabled));
        setOrbEnabled(Boolean(status.admin && status.enabled && status.orb_enabled));
      }).catch(() => {
        if (active) {
          setEnabled(false);
          setOrbEnabled(false);
        }
      });
    };
    refresh();
    window.addEventListener("msf-assistant-settings-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("msf-assistant-settings-updated", refresh);
    };
  }, [user?.role]);

  const handleStateChange = useCallback((next: OrbRenderState) => setState(next), []);
  if (!enabled) return null;

  return (
    <>
      {orbEnabled ? <AssistantOrb state={state} onClick={() => setOpen(true)} /> : null}
      <AssistantPanel open={open} onClose={() => setOpen(false)} onStateChange={handleStateChange} />
    </>
  );
}
