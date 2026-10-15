import type { ExplorerBootstrap, BlocksPageSnapshot, TransactionsPageSnapshot } from "../app/explorer-types";
import { isValidChainSnapshot, isValidNetworkPreview, isValidQuorumSnapshot, isValidServiceNodesSnapshot } from "../app/explorer/snapshot-validation";
import { cachedNetworkLiveResponse, cachedQuorumLiveResponse, cachedServiceNodesLiveResponse, cachedTransactionPoolLiveResponse } from "./live-responses";
import { cachedChainResponse } from "./chain-cache";
import { blocksPageResponse, transactionsPageResponse } from "./ledger";
import type { EdgeCache, ExecutionContext } from "./runtime-types";

export type BootstrapSnapshotKind = Exclude<keyof ExplorerBootstrap, "ledgerRequest" | "renderedAt">;
type Snapshot = NonNullable<ExplorerBootstrap[BootstrapSnapshotKind]> & { fetchedAt: string };
type Component = { kind: BootstrapSnapshotKind; url: URL; key: string };
type Entry = { data: Snapshot; fetchedAt: number };
const FRESH_MS = 5_000;
const STALE_MS = 300_000;
const FIRST_RENDER_MS = 4_000;
const PRODUCER_MS = 35_000;
const MAX_ENTRIES = 128;
const MAX_PENDING = 64;
const HASH = /^[a-f0-9]{64}$/i;
const sizes = new Set([5, 10, 20, 25, 50, 100]);
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<Snapshot | null>>();
const writes = new Map<string, Promise<Snapshot>>();

function emptyBootstrap(): ExplorerBootstrap {
  return { network: null, serviceNodes: null, quorums: null, transactionPool: null, chain: null, blocks: null, transactions: null, ledgerRequest: null };
}

function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

function cursorFields(raw: string, kind: "blocks" | "transactions", pageSize: number) {
  try {
    if (raw.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(raw)) return null;
    const value = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if (![1, 2].includes(value.version) || value.kind !== kind || !count(value.anchorHeight)
      || !HASH.test(value.anchorHash) || !count(value.nextHeight) || value.nextHeight > value.anchorHeight
      || !count(value.offset) || value.offset > 100_000 || (kind === "blocks" && value.offset !== 0)) return null;
    if (kind === "transactions" && (value.version !== 2 || value.pageSize !== pageSize
      || !count(value.position) || value.position % pageSize !== 0 || !count(value.totalRecords)
      || value.position >= value.totalRecords)) return null;
    return value as { anchorHeight: number; anchorHash: string; nextHeight: number; position?: number };
  } catch { return null; }
}

function component(kind: BootstrapSnapshotKind, source: URL): Component | null {
  const url = new URL(source);
  const params = new URLSearchParams();
  if (kind === "blocks" || kind === "transactions") {
    const raw = url.searchParams.get("pageSize") ?? "50";
    const pageSize = Number(raw);
    if (!/^(5|10|20|25|50|100)$/.test(raw) || !sizes.has(pageSize)) return null;
    params.set("pageSize", String(pageSize));
    if (url.searchParams.has("cursor")) {
      const cursor = url.searchParams.get("cursor")!;
      if (!cursorFields(cursor, kind, pageSize)) return null;
      params.set("cursor", cursor);
    }
  } else if (kind === "quorums") {
    if (Number(url.searchParams.get("page") ?? "0") !== 0 || url.searchParams.has("tip")) return null;
    const raw = url.searchParams.get("pageSize") ?? "10";
    if (!/^(5|10|20|25|50|100)$/.test(raw)) return null;
    params.set("pageSize", raw);
    params.set("latest", "1");
  } else if (kind === "chain") {
    if (Number(url.searchParams.get("blockPage") ?? "0") !== 0 || Number(url.searchParams.get("transactionPage") ?? "0") !== 0) return null;
    const blockSize = url.searchParams.get("blockPageSize") ?? "10";
    const transactionSize = url.searchParams.get("transactionPageSize") ?? "10";
    if (!/^(5|10|20|25|50|100)$/.test(blockSize) || !/^(5|10|20|25|50|100)$/.test(transactionSize)) return null;
    params.set("blockPage", "0"); params.set("transactionPage", "0");
    params.set("blockPageSize", blockSize); params.set("transactionPageSize", transactionSize);
  }
  const keyUrl = new URL(`/__explorer-bootstrap/v1/${kind}`, url.origin);
  keyUrl.search = params.toString();
  return { kind, url, key: keyUrl.toString() };
}

export function bootstrapCacheKey(kind: BootstrapSnapshotKind, url: URL): string | null {
  return component(kind, url)?.key ?? null;
}

function validLedger(kind: "blocks" | "transactions", value: unknown, url: URL) {
  const data = value as BlocksPageSnapshot | TransactionsPageSnapshot | null;
  const pageSize = Number(url.searchParams.get("pageSize") ?? 50);
  if (data?.live !== true || data.pageSize !== pageSize || !count(data.anchorHeight) || !count(data.height)
    || data.height < data.anchorHeight || !HASH.test(data.anchorHash) || !Array.isArray(data.rows)
    || data.rows.length > pageSize || !count(data.totalRecords) || !count(data.position)
    || data.position % pageSize !== 0 || typeof data.hasMore !== "boolean"
    || data.hasMore !== (typeof data.nextCursor === "string" && data.nextCursor.length > 0)
    || (!data.hasMore && data.nextCursor !== null) || data.position + data.rows.length > data.totalRecords
    || (data.hasMore && data.position + data.rows.length >= data.totalRecords)
    || (!data.hasMore && data.position + data.rows.length !== data.totalRecords)
    || (data.hasMore && data.rows.length !== pageSize)) return false;
  const rawCursor = url.searchParams.get("cursor");
  if (rawCursor) {
    const cursor = cursorFields(rawCursor, kind, pageSize);
    if (!cursor || cursor.anchorHeight !== data.anchorHeight || cursor.anchorHash.toLowerCase() !== data.anchorHash.toLowerCase()
      || (kind === "transactions" ? cursor.position !== data.position : data.anchorHeight - cursor.nextHeight !== data.position)) return false;
  } else if (data.position !== 0) return false;
  const seen = new Set<string>();
  let previous: number | null = null;
  for (const row of data.rows) {
    const height = "height" in row ? row.height : row.block;
    if (!count(height) || height > data.anchorHeight || !HASH.test(row.hash) || seen.has(row.hash.toLowerCase())
      || !count(row.timestamp) || ![row.fee, row.reward, row.inputs, row.outputs].every((value) => value === null || count(value))
      || (kind === "blocks" ? !("txs" in row) || ![row.txs, row.size, row.difficulty].every(count)
        : !("confirmations" in row) || !count(row.confirmations) || (row.size !== null && !count(row.size)) || typeof row.txType !== "string")
      || (previous != null && (kind === "blocks" ? height !== previous - 1 : height > previous))) return false;
    seen.add(row.hash.toLowerCase()); previous = height;
  }
  return kind !== "blocks" || data.totalRecords === data.anchorHeight + 1;
}

function validSnapshot(kind: BootstrapSnapshotKind, value: unknown, url: URL): value is Snapshot {
  const data = value as { fetchedAt?: string } | null;
  if (!data || typeof data.fetchedAt !== "string" || !Number.isFinite(Date.parse(data.fetchedAt))
    || Date.parse(data.fetchedAt) > Date.now() + 60_000) return false;
  if (kind === "network") return isValidNetworkPreview(value);
  if (kind === "serviceNodes") return isValidServiceNodesSnapshot(value);
  if (kind === "quorums") return isValidQuorumSnapshot(value);
  if (kind === "chain") return isValidChainSnapshot(value);
  if (kind === "blocks" || kind === "transactions") return validLedger(kind, value, url);
  const pool = value as ExplorerBootstrap["transactionPool"];
  return pool?.available === true && count(pool.count) && count(pool.totalBytes) && Array.isArray(pool.transactions)
    && pool.transactions.length <= Math.min(pool.count, 5) && pool.transactions.every((tx) => HASH.test(tx.hash) && count(tx.receivedAt)
      && count(tx.size) && count(tx.fee) && count(tx.inputs) && count(tx.outputs) && typeof tx.txType === "string");
}

function snapshotHeight(data: Snapshot) {
  if ("anchorHeight" in data) return data.anchorHeight;
  if ("network" in data) return data.network.height;
  return "height" in data ? data.height : null;
}

function betterEntry(current: Entry | null, next: Entry) {
  if (!current) return next;
  const before = snapshotHeight(current.data), after = snapshotHeight(next.data);
  if (before != null && after != null && before !== after) return before > after ? current : next;
  const beforeHash = "anchorHash" in current.data ? current.data.anchorHash : "blocks" in current.data ? current.data.blocks[0]?.hash : null;
  const afterHash = "anchorHash" in next.data ? next.data.anchorHash : "blocks" in next.data ? next.data.blocks[0]?.hash : null;
  if (before != null && after === before && beforeHash === afterHash) {
    const quality = (data: Snapshot) => {
      const rows = "rows" in data ? data.rows : "blocks" in data ? data.blocks : [];
      return ("pendingDetails" in data && data.pendingDetails ? 0 : 1)
        + rows.reduce((sum, row) => sum + [row.fee, row.reward, row.inputs, row.outputs].filter((value) => value != null).length, 0);
    };
    if (quality(current.data) > quality(next.data)) return current;
  }
  return current.fetchedAt > next.fetchedAt ? current : next;
}

function cacheApi() { return (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default; }

async function readEntry(item: Component): Promise<Entry | null> {
  let entry = memory.get(item.key) ?? null;
  if (entry && Date.now() - entry.fetchedAt <= STALE_MS) return entry;
  try {
    const cached = await cacheApi()?.match(new Request(item.key));
    if (cached) {
      const value: unknown = await cached.json();
      if (validSnapshot(item.kind, value, item.url)) entry = betterEntry(entry, { data: value, fetchedAt: Date.parse(value.fetchedAt) });
    }
  } catch { /* Public cache availability must not block a render. */ }
  if (!entry || Date.now() - entry.fetchedAt > STALE_MS) { memory.delete(item.key); return null; }
  return entry;
}

async function storeEntry(item: Component, data: Snapshot): Promise<Snapshot> {
  const previous = writes.get(item.key);
  const save = (previous?.catch(() => data) ?? Promise.resolve(data)).then(async () => {
    const candidate = { data, fetchedAt: Date.parse(data.fetchedAt) };
    const selected = betterEntry(await readEntry(item), candidate);
    memory.delete(item.key);
    while (memory.size >= MAX_ENTRIES) memory.delete(memory.keys().next().value!);
    memory.set(item.key, selected);
    try {
      await cacheApi()?.put(new Request(item.key), new Response(JSON.stringify(selected.data), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
      }));
    } catch { /* Keep the verified in-process fallback when Cache API fails. */ }
    return selected.data;
  });
  writes.set(item.key, save);
  try { return await save; } finally { if (writes.get(item.key) === save) writes.delete(item.key); }
}

async function responseData(item: Component, response: Response) {
  if (!response.ok) return null;
  let data: unknown = await response.json();
  if (item.kind === "transactionPool" && data && typeof data === "object" && !("fetchedAt" in data)) {
    const created = Number(response.headers.get("x-judecoin-pool-created-at"));
    data = { ...data, fetchedAt: new Date(created > 0 ? created : Date.now()).toISOString() };
  }
  return validSnapshot(item.kind, data, item.url) ? data : null;
}

async function transactionUserPage(item: Component): Promise<TransactionsPageSnapshot | null> {
  const url = new URL(item.url);
  const pageSize = Number(url.searchParams.get("pageSize") ?? 50);
  const deadline = Date.now() + PRODUCER_MS;
  const seen = new Set<string>();
  const hashes = new Set<string>();
  let assembled: TransactionsPageSnapshot | null = null;
  while (Date.now() < deadline) {
    const cursor = url.searchParams.get("cursor");
    if (cursor && seen.has(cursor)) return null;
    if (cursor) seen.add(cursor);
    url.searchParams.set("take", String(pageSize - (assembled?.rows.length ?? 0)));
    const response = await transactionsPageResponse(url);
    if (!response.ok) return null;
    const segment = await response.json() as TransactionsPageSnapshot;
    const collected = assembled?.rows.length ?? 0;
    if (segment.live !== true || segment.pageSize !== pageSize || !count(segment.totalRecords) || !count(segment.position)
      || !Array.isArray(segment.rows) || segment.rows.length > pageSize - collected
      || (assembled && (segment.anchorHeight !== assembled.anchorHeight || segment.anchorHash !== assembled.anchorHash
        || segment.totalRecords !== assembled.totalRecords || segment.position !== assembled.position! + collected))) return null;
    for (const row of segment.rows) {
      if (hashes.has(row.hash)) return null;
      hashes.add(row.hash);
    }
    const previous = assembled as TransactionsPageSnapshot | null;
    assembled = previous ? { ...previous, rows: [...previous.rows, ...segment.rows], fetchedAt: segment.fetchedAt,
      height: Math.max(previous.height, segment.height), nextCursor: segment.nextCursor, hasMore: segment.hasMore,
      scannedBlocks: previous.scannedBlocks + segment.scannedBlocks, scanLimited: segment.scanLimited } : segment;
    if (assembled.rows.length === pageSize || !assembled.hasMore) {
      assembled.scanLimited = false;
      return validLedger("transactions", assembled, item.url) ? assembled : null;
    }
    if (!assembled.nextCursor || seen.has(assembled.nextCursor) || (!segment.rows.length && !segment.scannedBlocks)) return null;
    url.searchParams.set("cursor", assembled.nextCursor);
  }
  return null;
}

async function loadComponent(item: Component, ctx: ExecutionContext): Promise<Snapshot | null> {
  if (item.kind === "transactions") return transactionUserPage(item);
  let response: Response;
  if (item.kind === "network") response = await cachedNetworkLiveResponse(item.url, ctx);
  else if (item.kind === "serviceNodes") response = await cachedServiceNodesLiveResponse(item.url, ctx);
  else if (item.kind === "quorums") response = await cachedQuorumLiveResponse(item.url, ctx);
  else if (item.kind === "transactionPool") response = await cachedTransactionPoolLiveResponse(item.url, ctx);
  else if (item.kind === "chain") response = await cachedChainResponse(new Request(item.url), item.url, ctx);
  else response = await blocksPageResponse(item.url);
  return responseData(item, response);
}

function refreshComponent(item: Component, ctx: ExecutionContext) {
  const existing = pending.get(item.key);
  if (existing) return existing;
  if (pending.size >= MAX_PENDING) return Promise.resolve(null);
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PRODUCER_MS); });
  const work = Promise.race([loadComponent(item, ctx).catch(() => null), deadline]).then(async (data) => (
    data && validSnapshot(item.kind, data, item.url) ? storeEntry(item, data) : null
  )).finally(() => { clearTimeout(timer); if (pending.get(item.key) === work) pending.delete(item.key); });
  pending.set(item.key, work);
  ctx.waitUntil(work.then(() => undefined));
  return work;
}

export async function rememberBootstrapResponse(kind: BootstrapSnapshotKind, url: URL, response: Response, ctx: ExecutionContext): Promise<void> {
  const item = component(kind, url);
  if (!item || !response.ok) return;
  const work = responseData(item, response.clone()).then((data) => data ? storeEntry(item, data) : undefined).catch(() => undefined);
  ctx.waitUntil(work);
}

export async function explorerBootstrap(url: URL, ctx: ExecutionContext): Promise<ExplorerBootstrap> {
  const result = emptyBootstrap();
  const route = url.pathname.replace(/\/$/, "") || "/";
  if (!["/", "/service-nodes", "/statistics", "/blocks", "/transactions"].includes(route)) return result;
  const items: Component[] = [];
  const add = (kind: BootstrapSnapshotKind, path: string) => { const item = component(kind, new URL(path, url)); if (item) items.push(item); };
  add("network", "/api/network");
  if (route === "/blocks" || route === "/transactions") {
    const kind = route === "/blocks" ? "blocks" : "transactions";
    const requestUrl = new URL(`/api/${kind}`, url);
    requestUrl.searchParams.set("pageSize", url.searchParams.get("pageSize") ?? "50");
    if (url.searchParams.has("cursor")) requestUrl.searchParams.set("cursor", url.searchParams.get("cursor")!);
    const item = component(kind, requestUrl);
    if (item) items.push(item);
  } else {
    add("serviceNodes", "/api/service-nodes-live");
    if (route !== "/service-nodes") {
      add("quorums", "/api/quorums?pageSize=10&latest=1");
      add("transactionPool", "/api/transaction-pool");
      add("chain", `/api/chain?blockPage=0&blockPageSize=10&transactionPage=0&transactionPageSize=10${route === "/" ? "&overview=1" : ""}`);
    }
    if (route === "/") {
      add("blocks", "/api/blocks?pageSize=10");
      add("transactions", "/api/transactions?pageSize=10");
    }
  }
  const writeResult = (item: Component, data: Snapshot) => { Object.assign(result, { [item.kind]: data }); };
  const work = items.map(async (item) => {
    const cached = await readEntry(item);
    if (cached) {
      writeResult(item, cached.data);
      if (Date.now() - cached.fetchedAt > FRESH_MS) void refreshComponent(item, ctx);
      return;
    }
    const fresh = await refreshComponent(item, ctx);
    if (fresh) writeResult(item, fresh);
  });
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([Promise.allSettled(work), new Promise<void>((resolve) => { timer = setTimeout(resolve, FIRST_RENDER_MS); })]);
  clearTimeout(timer!);
  const snapshot = { ...result };
  const ledger = route === "/blocks" ? snapshot.blocks : route === "/transactions" ? snapshot.transactions : null;
  if (ledger && count(ledger.position)) snapshot.ledgerRequest = {
    cursor: url.searchParams.get("cursor"), pageSize: ledger.pageSize, page: Math.floor(ledger.position / ledger.pageSize),
  };
  return snapshot;
}
