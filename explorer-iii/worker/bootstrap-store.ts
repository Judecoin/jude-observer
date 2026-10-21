import type { Env, ExecutionContext } from "./runtime-types";

type StoredSnapshot = { key: string; data: Record<string, unknown>; height: number | null; fetchedAt: number; quality: number };
interface SnapshotStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  transaction<T>(callback: (storage: SnapshotStorage) => Promise<T>): Promise<T>;
}

export const PERSISTED_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const MAX_STORED_KEYS = 128;
const MAX_SNAPSHOT_CHARS = 2_500_000;
const WRITE_INTERVAL_MS = 30_000;
const READ_DEADLINE_MS = 700;
const STORAGE_CHUNK_CHARS = 24_000;
const keysInFlight = new Map<string, Promise<void>>();
const writeTimes = new Map<string, { fetchedAt: number; height: number | null }>();

function storedKey(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 900) return null;
  try {
    const url = new URL(raw, "https://snapshot.internal");
    if (!/^\/__explorer-bootstrap\/v1\/(network|serviceNodes|quorums|transactionPool|chain|blocks|transactions)$/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}

function snapshotEntry(key: string, value: unknown): StoredSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const fetchedAt = typeof data.fetchedAt === "string" ? Date.parse(data.fetchedAt) : NaN;
  if (!Number.isFinite(fetchedAt) || fetchedAt > Date.now() + 60_000
    || Date.now() - fetchedAt > PERSISTED_SNAPSHOT_MAX_AGE_MS
    || (data.live !== true && data.available !== true)) return null;
  const network = data.network as { height?: unknown } | undefined;
  const rawHeight = data.anchorHeight ?? network?.height ?? data.height;
  const height = Number.isSafeInteger(rawHeight) && Number(rawHeight) >= 0 ? Number(rawHeight) : null;
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.blocks) ? data.blocks : [];
  const quality = (data.pendingDetails === true || data.headerOnly === true ? 0 : 1)
    + rows.reduce((sum: number, row: Record<string, unknown>) => sum + [row?.fee, row?.reward, row?.inputs, row?.outputs].filter((field) => field != null).length, 0);
  return { key, data, height, fetchedAt, quality };
}

function preferStored(current: StoredSnapshot | undefined, next: StoredSnapshot) {
  if (!current) return next;
  if (current.height !== null && next.height !== null && current.height !== next.height) return current.height > next.height ? current : next;
  if (current.height === next.height && current.quality > next.quality) return current;
  return current.fetchedAt >= next.fetchedAt ? current : next;
}

async function readStoredSnapshot(storage: SnapshotStorage, key: string): Promise<StoredSnapshot | undefined> {
  const value = await storage.get<StoredSnapshot | { parts: number }>(key);
  if (!value) return undefined;
  if (!("parts" in value)) return value;
  if (!Number.isSafeInteger(value.parts) || value.parts < 1 || value.parts > 110) return undefined;
  const chunks = await Promise.all(Array.from({ length: value.parts }, (_, index) => storage.get<string>(`${key}:part:${index}`)));
  if (chunks.some((chunk) => typeof chunk !== "string")) return undefined;
  try { return JSON.parse(chunks.join("")) as StoredSnapshot; } catch { return undefined; }
}

async function writeStoredSnapshot(storage: SnapshotStorage, key: string, value: StoredSnapshot) {
  const previous = await storage.get<{ parts?: number }>(key);
  const serialized = JSON.stringify(value);
  const parts = Math.ceil(serialized.length / STORAGE_CHUNK_CHARS);
  for (let index = 0; index < parts; index++) await storage.put(`${key}:part:${index}`, serialized.slice(index * STORAGE_CHUNK_CHARS, (index + 1) * STORAGE_CHUNK_CHARS));
  for (let index = parts; index < (previous?.parts ?? 0); index++) await storage.delete(`${key}:part:${index}`);
  await storage.put(key, { parts });
}

async function deleteStoredSnapshot(storage: SnapshotStorage, key: string) {
  const value = await storage.get<{ parts?: number }>(key);
  for (let index = 0; index < (value?.parts ?? 0); index++) await storage.delete(`${key}:part:${index}`);
  await storage.delete(key);
}

export class ExplorerSnapshotStore {
  private readonly storage: SnapshotStorage;
  constructor(state: { storage: SnapshotStorage }) { this.storage = state.storage; }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const raw = await request.text();
      if (raw.length > MAX_SNAPSHOT_CHARS) return Response.json({ error: "Snapshot is too large" }, { status: 413 });
      let payload: { key?: unknown; data?: unknown };
      try { payload = JSON.parse(raw); } catch { return Response.json({ error: "Invalid snapshot" }, { status: 400 }); }
      const key = storedKey(payload?.key);
      const candidate = key ? snapshotEntry(key, payload?.data) : null;
      if (!key || !candidate) return Response.json({ error: "Invalid snapshot" }, { status: 400 });
      await this.storage.transaction(async (storage) => {
        const current = await readStoredSnapshot(storage, key);
        const selected = preferStored(current, candidate);
        if (selected === current || (current && selected.fetchedAt - current.fetchedAt < WRITE_INTERVAL_MS)) return;
        await writeStoredSnapshot(storage, key, selected);
        const index = (await storage.get<Array<{ key: string; fetchedAt: number }>>("index") ?? []).filter((entry) => entry.key !== key);
        index.push({ key, fetchedAt: selected.fetchedAt });
        index.sort((a, b) => b.fetchedAt - a.fetchedAt);
        for (const entry of index.slice(MAX_STORED_KEYS)) await deleteStoredSnapshot(storage, entry.key);
        await storage.put("index", index.slice(0, MAX_STORED_KEYS));
      });
      return Response.json({ stored: true });
    }
    if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
    let requested: unknown;
    try { requested = JSON.parse(new URL(request.url).searchParams.get("keys") ?? "[]"); } catch { requested = null; }
    if (!Array.isArray(requested) || requested.length > 8 || requested.some((key) => storedKey(key) === null)) {
      return Response.json({ error: "Invalid snapshot keys" }, { status: 400 });
    }
    const snapshots: Record<string, unknown> = {};
    await Promise.all(requested.map(async (raw) => {
      const key = storedKey(raw)!;
      const stored = await readStoredSnapshot(this.storage, key);
      if (stored && snapshotEntry(key, stored.data)) snapshots[key] = stored.data;
    }));
    return Response.json({ snapshots });
  }
}

function snapshotStub(env: Env | undefined, origin: string) {
  const namespace = env?.EXPLORER_SNAPSHOTS;
  return namespace?.get(namespace.idFromName(`mainnet:${origin}`));
}

export async function readPersistedSnapshots(keys: string[], origin: string, env?: Env): Promise<Record<string, unknown>> {
  const stub = snapshotStub(env, origin);
  if (!stub) return {};
  const normalized = keys.map(storedKey).filter((key): key is string => key !== null);
  const request = new Request(`https://snapshot.internal/?keys=${encodeURIComponent(JSON.stringify(normalized))}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      stub.fetch(request).then(async (response) => {
        if (!response.ok) return {};
        const value = await response.json() as { snapshots?: Record<string, unknown> };
        return value?.snapshots && typeof value.snapshots === "object" ? value.snapshots : {};
      }).catch(() => ({})),
      new Promise<Record<string, unknown>>((resolve) => { timer = setTimeout(() => resolve({}), READ_DEADLINE_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function persistBootstrapSnapshot(rawKey: string, data: unknown, env: Env | undefined, ctx: ExecutionContext) {
  const key = storedKey(rawKey);
  const candidate = key ? snapshotEntry(key, data) : null;
  if (!key || !candidate) return;
  const origin = new URL(rawKey).origin;
  const stub = snapshotStub(env, origin);
  if (!stub) return;
  const before = writeTimes.get(rawKey);
  if (keysInFlight.has(rawKey) || (before && candidate.fetchedAt - before.fetchedAt < WRITE_INTERVAL_MS)) return;
  const work = stub.fetch(new Request("https://snapshot.internal/", {
    method: "POST", body: JSON.stringify({ key, data }), headers: { "content-type": "application/json" },
  })).then((response) => {
    if (response.ok) {
      writeTimes.delete(rawKey);
      writeTimes.set(rawKey, { fetchedAt: candidate.fetchedAt, height: candidate.height });
      while (writeTimes.size > MAX_STORED_KEYS) writeTimes.delete(writeTimes.keys().next().value!);
    }
  }).catch(() => undefined).finally(() => keysInFlight.delete(rawKey));
  keysInFlight.set(rawKey, work);
  ctx.waitUntil(work);
}

export function persistedSnapshotKey(rawKey: string) { return storedKey(rawKey); }
