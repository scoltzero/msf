"use client";

import { useEffect, useState } from "react";
import { getToken } from "@/lib/api";

export interface MihomoTrafficSample {
  at: number;
  downloadSpeed: number;
  uploadSpeed: number;
}

interface TrafficStreamState {
  connected: boolean;
  sample: MihomoTrafficSample | null;
}

function numericValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Subscribe to the same native Mihomo /traffic WebSocket used by Zashboard. */
export function useMihomoTrafficStream() {
  const [state, setState] = useState<TrafficStreamState>({ connected: false, sample: null });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const token = getToken();
      if (!token) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/api/v1/mihomo/controller/traffic?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);
      socket.onopen = () => setState((current) => ({ ...current, connected: true }));
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
          setState({
            connected: true,
            sample: {
              at: Date.now(),
              downloadSpeed: numericValue(payload.down ?? payload.download),
              uploadSpeed: numericValue(payload.up ?? payload.upload),
            },
          });
        } catch {
          // Ignore malformed frames and keep the last valid sample visible.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        socket = null;
        if (stopped) return;
        setState({ connected: false, sample: null });
        reconnectTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return state;
}
