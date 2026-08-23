export type HistoryAggregation = "source" | "target" | "process" | "outbound" | "proxyGroup";

export interface ClosedConnectionRecord {
  id: string;
  source: string;
  target: string;
  process: string;
  outbound: string;
  proxyGroup: string;
  download: number;
  upload: number;
  closedAt: number;
}

export interface AggregatedConnectionRecord {
  key: string;
  download: number;
  upload: number;
  count: number;
}

const DB_NAME = "msf-mihomo-telemetry";
const DB_VERSION = 2;
const STORE_NAME = "closed-connections";
const FALLBACK_KEY = "msf-mihomo-closed-connections-v2";
const MAX_RECORDS = 5000;

function fallbackRead(): ClosedConnectionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem(FALLBACK_KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function fallbackWrite(rows: ClosedConnectionRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(rows.slice(-1000)));
  } catch {
    // Private mode/quota failures must not break the live overview.
  }
}

function openHistoryDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("closedAt", "closedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readClosedConnections(): Promise<ClosedConnectionRecord[]> {
  const db = await openHistoryDb();
  if (!db) return fallbackRead();
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result as ClosedConnectionRecord[]); };
      request.onerror = () => { db.close(); resolve(fallbackRead()); };
    } catch {
      db.close();
      resolve(fallbackRead());
    }
  });
}

export async function saveClosedConnections(rows: ClosedConnectionRecord[]) {
  if (!rows.length) return;
  const db = await openHistoryDb();
  if (!db) {
    const merged = new Map(fallbackRead().map((row) => [row.id, row]));
    rows.forEach((row) => merged.set(row.id, row));
    fallbackWrite(Array.from(merged.values()).sort((a, b) => a.closedAt - b.closedAt));
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      rows.forEach((row) => store.put(row));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch {
      db.close();
      resolve();
    }
  });
  const all = await readClosedConnections();
  if (all.length > MAX_RECORDS) await deleteClosedConnections(all.sort((a, b) => b.closedAt - a.closedAt).slice(MAX_RECORDS).map((row) => row.id));
}

async function deleteClosedConnections(ids: string[]) {
  if (!ids.length) return;
  const db = await openHistoryDb();
  if (!db) {
    const removing = new Set(ids);
    fallbackWrite(fallbackRead().filter((row) => !removing.has(row.id)));
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

export async function clearClosedConnections() {
  const db = await openHistoryDb();
  if (typeof window !== "undefined") window.localStorage.removeItem(FALLBACK_KEY);
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

export async function pruneClosedConnections(cutoff: number) {
  const rows = await readClosedConnections();
  await deleteClosedConnections(rows.filter((row) => row.closedAt < cutoff).map((row) => row.id));
}

export function toClosedConnection(row: any, closedAt = Date.now()): ClosedConnectionRecord {
  const chains = Array.isArray(row.chains) ? row.chains.map(String).filter(Boolean) : [];
  return {
    id: String(row.id),
    source: String(row.source || "-"),
    target: String(row.target || "-"),
    process: String(row.process || "-"),
    outbound: chains[0] || String(row.proxyGroup || "-"),
    proxyGroup: chains.at(-1) || String(row.proxyGroup || "-"),
    download: Number(row.download ?? row.downloadTotalValue ?? row.raw?.download ?? 0) || 0,
    upload: Number(row.upload ?? row.uploadTotalValue ?? row.raw?.upload ?? 0) || 0,
    closedAt,
  };
}

export function aggregateConnections(rows: ClosedConnectionRecord[], by: HistoryAggregation): AggregatedConnectionRecord[] {
  const map = new Map<string, AggregatedConnectionRecord>();
  for (const row of rows) {
    const key = row[by] || "-";
    const current = map.get(key) || { key, download: 0, upload: 0, count: 0 };
    current.download += row.download;
    current.upload += row.upload;
    current.count += 1;
    map.set(key, current);
  }
  return Array.from(map.values());
}
