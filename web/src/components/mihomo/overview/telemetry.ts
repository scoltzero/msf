export interface FaviconTarget {
  id: string;
  label: string;
  url: string;
}

export interface FaviconSample {
  targetId: string;
  round: number;
  elapsedMs: number;
  ok: boolean;
  at: number;
}

/** The four small, cache-busted browser probes used by the overview latency card. */
export const FAVICON_TARGETS: FaviconTarget[] = [
  { id: "baidu", label: "Baidu", url: "https://apps.bdimg.com/favicon.ico" },
  { id: "cloudflare", label: "Cloudflare", url: "https://www.cloudflare.com/favicon.ico" },
  { id: "github", label: "GitHub", url: "https://github.githubassets.com/favicon.ico" },
  { id: "youtube", label: "YouTube", url: "https://yt3.ggpht.com/favicon.ico" },
];

export function measureFavicon(url: string, timeoutMs = 3000): Promise<{ elapsedMs: number; ok: boolean }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof Image === "undefined") {
      resolve({ elapsedMs: 0, ok: false });
      return;
    }
    const image = new Image();
    const started = performance.now();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve({ elapsedMs: Math.max(0, Math.round(performance.now() - started)), ok });
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = `${url}${url.includes("?") ? "&" : "?"}msf_probe=${Date.now()}_${Math.random().toString(36).slice(2)}`;
  });
}

export async function runFaviconRounds(
  targets: FaviconTarget[] = FAVICON_TARGETS,
  rounds = 10,
  onSample?: (sample: FaviconSample) => void,
) {
  const samples: FaviconSample[] = [];
  await Promise.all(targets.map(async (target) => {
    for (let round = 1; round <= rounds; round += 1) {
      const result = await measureFavicon(target.url);
      const sample = { targetId: target.id, round, ...result, at: Date.now() };
      samples.push(sample);
      onSample?.(sample);
    }
  }));
  return samples;
}
