import type { BlocksPageSnapshot, TransactionsPageSnapshot } from "../explorer-types";

export type LedgerKind = "blocks" | "transactions";
const LEDGER_REQUEST_TIMEOUT_MS = 35_000;
const LEDGER_CHECKPOINT_TTL_MS = 6 * 60_000;
const LEDGER_CHECKPOINT_MAX_ENTRIES = 16;
type LedgerResponse = BlocksPageSnapshot | TransactionsPageSnapshot;
type LedgerCheckpoint = { data: LedgerResponse; seenCursors: string[]; expiresAt: number };
const ledgerCheckpoints = new Map<string, LedgerCheckpoint>();

class LedgerReadError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

function rememberLedgerCheckpoint(key: string, data: LedgerResponse, seenCursors: Set<string>) {
  ledgerCheckpoints.delete(key);
  while (ledgerCheckpoints.size >= LEDGER_CHECKPOINT_MAX_ENTRIES) ledgerCheckpoints.delete(ledgerCheckpoints.keys().next().value!);
  ledgerCheckpoints.set(key, { data, seenCursors: [...seenCursors], expiresAt: Date.now() + LEDGER_CHECKPOINT_TTL_MS });
}

function ledgerCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

async function readLedgerSegment(kind: LedgerKind, params: URLSearchParams, signal: AbortSignal): Promise<LedgerResponse> {
  signal.throwIfAborted();
  let response: Response;
  let data;
  try {
    response = await fetch(`/api/${kind}?${params}`, { cache: "no-store", signal });
    data = await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new LedgerReadError("Mainnet data unavailable. Retrying…", true);
  }
  if (!response.ok) throw new LedgerReadError(response.status === 409
    ? "The selected history changed. Return to latest to continue."
    : response.status === 400 ? "This history link is invalid. Return to latest to continue."
      : "Mainnet data unavailable. Retrying…", response.status >= 500 || response.status === 429);
  if (data?.live !== true || !ledgerCount(data.anchorHeight)
    || !ledgerCount(data.height) || data.height < data.anchorHeight || !/^[a-f0-9]{64}$/i.test(data.anchorHash)
    || data.pageSize !== Number(params.get("pageSize")) || !Array.isArray(data.rows)
    || data.rows.length > Number(params.get("take") ?? params.get("pageSize")) || typeof data.hasMore !== "boolean"
    || (data.nextCursor !== null && (typeof data.nextCursor !== "string" || data.nextCursor.length > 512))
    || data.hasMore !== (typeof data.nextCursor === "string" && data.nextCursor.length > 0)
    || !ledgerCount(data.scannedBlocks) || typeof data.scanLimited !== "boolean"
    || typeof data.fetchedAt !== "string" || !Number.isFinite(Date.parse(data.fetchedAt))) throw new LedgerReadError("Invalid mainnet response. Retrying…");
  data.anchorHash = data.anchorHash.toLowerCase();
  if (kind === "blocks") {
    // Older block responses have enough verified height information to derive
    // their position; transaction positions cannot be reconstructed this way.
    if (data.totalRecords === undefined) data.totalRecords = data.anchorHeight + 1;
    if (data.position === undefined) data.position = data.rows.length ? data.anchorHeight - data.rows[0].height : null;
  }
  if ((data.totalRecords !== null && !ledgerCount(data.totalRecords))
    || (data.position !== null && !ledgerCount(data.position))
    || (data.totalRecords !== null && data.position !== null && (
      data.position + data.rows.length > data.totalRecords
      || (data.hasMore ? data.position + data.rows.length >= data.totalRecords : data.position + data.rows.length !== data.totalRecords)
    )) || (kind === "blocks" && (data.totalRecords !== data.anchorHeight + 1 || !ledgerCount(data.position)))) {
    throw new LedgerReadError("Invalid history position. Retrying…");
  }
  const unique = new Set<string>();
  let previousHeight: number | null = null;
  for (const row of data.rows) {
    const identity = kind === "blocks" ? String(row.height) : String(row.hash).toLowerCase();
    const optionalCount = (value: unknown) => value === null || ledgerCount(value);
    const height = kind === "blocks" ? row.height : row.block;
    if (!/^[a-f0-9]{64}$/i.test(row.hash) || unique.has(identity)
      || !ledgerCount(row.timestamp)
      || (kind === "blocks" ? !ledgerCount(row.height) || row.height > data.anchorHeight
        || ![row.txs, row.size, row.difficulty].every(ledgerCount) || ![row.fee, row.reward, row.inputs, row.outputs].every(optionalCount)
        : !ledgerCount(row.block) || row.block > data.anchorHeight || typeof row.txType !== "string"
          || ![row.confirmations, row.fee, row.reward, row.inputs, row.outputs].every(ledgerCount) || !optionalCount(row.size))
      || (previousHeight !== null && (kind === "blocks" ? height !== previousHeight - 1 : height > previousHeight))) throw new LedgerReadError("Invalid mainnet records. Retrying…");
    unique.add(identity);
    previousHeight = height;
  }
  if (kind === "blocks" && data.rows.length && data.position !== data.anchorHeight - data.rows[0].height) throw new LedgerReadError("Invalid history position. Retrying…");
  return data;
}

export async function fetchLedgerPage(kind: LedgerKind, params: URLSearchParams, signal?: AbortSignal, scope: "home" | "page" = "page"): Promise<LedgerResponse> {
  const normalizedParams = new URLSearchParams(params);
  normalizedParams.sort();
  const checkpointKey = `${scope}:${kind}:${normalizedParams}`;
  for (const [key, checkpoint] of ledgerCheckpoints) if (checkpoint.expiresAt <= Date.now()) ledgerCheckpoints.delete(key);
  const controller = new AbortController();
  const cancel = () => { ledgerCheckpoints.delete(checkpointKey); controller.abort(signal?.reason); };
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timeoutMs = params.get("overview") === "1" ? 12_000 : LEDGER_REQUEST_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const timer = window.setTimeout(() => controller.abort(new DOMException("Mainnet request timed out. Retrying…", "TimeoutError")), timeoutMs);
  try {
    const pageSize = Number(params.get("pageSize"));
    if (!ledgerCount(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid history page size.");
    const requestParams = new URLSearchParams(params);
    const checkpoint = kind === "transactions" ? ledgerCheckpoints.get(checkpointKey) : undefined;
    const seenCursors = new Set<string>(checkpoint?.seenCursors);
    let assembled: LedgerResponse | null = checkpoint?.data ?? null;
    const seenHashes = new Set<string>(assembled?.rows.map((row) => row.hash.toLowerCase()));
    const lastRow = assembled?.rows.at(-1);
    let previousBlock: number | null = lastRow ? "block" in lastRow ? lastRow.block : lastRow.height : null;
    if (assembled?.nextCursor) requestParams.set("cursor", assembled.nextCursor);
    while (true) {
      if (Date.now() >= deadline) controller.abort();
      controller.signal.throwIfAborted();
      const cursor = requestParams.get("cursor");
      if (cursor) {
        if (seenCursors.has(cursor)) throw new LedgerReadError("History cursor did not advance. Retrying…");
        seenCursors.add(cursor);
      }
      const collected = assembled?.rows.length ?? 0;
      if (kind === "transactions") requestParams.set("take", String(pageSize - collected));
      const segment = await readLedgerSegment(kind, requestParams, controller.signal);
      if (!assembled && segment.position !== null && segment.position % pageSize !== 0) {
        throw new LedgerReadError("This history cursor does not start at a page boundary. Return to latest to continue.");
      }
      if (assembled && (segment.anchorHeight !== assembled.anchorHeight || segment.anchorHash !== assembled.anchorHash
        || (assembled.totalRecords !== null && segment.totalRecords !== assembled.totalRecords)
        || (assembled.position === null ? segment.position !== null : segment.position !== assembled.position + collected))) {
        throw new LedgerReadError("History segments are inconsistent. Retrying…");
      }
      for (const row of segment.rows) {
        const block = "block" in row ? row.block : row.height;
        const hash = row.hash.toLowerCase();
        if (seenHashes.has(hash) || (previousBlock !== null && block > previousBlock)) throw new LedgerReadError("History records overlap or are out of order. Retrying…");
        seenHashes.add(hash);
        previousBlock = block;
      }
      if (segment.nextCursor && seenCursors.has(segment.nextCursor)) throw new LedgerReadError("History cursor did not advance. Retrying…");
      if (segment.hasMore && segment.rows.length === 0 && segment.scannedBlocks === 0) throw new LedgerReadError("History scan did not advance. Retrying…");
      const previous = assembled as LedgerResponse | null;
      assembled = previous ? {
        ...previous, fetchedAt: segment.fetchedAt, height: Math.max(previous.height, segment.height),
        rows: [...previous.rows, ...segment.rows], nextCursor: segment.nextCursor, hasMore: segment.hasMore,
        scannedBlocks: previous.scannedBlocks + segment.scannedBlocks, scanLimited: segment.scanLimited,
        totalRecords: segment.totalRecords,
      } as LedgerResponse : segment;
      // A user page is published atomically. Sparse scan windows are internal
      // segments, never short intermediate pages exposed to Next/Previous.
      if (kind !== "transactions" || assembled.rows.length === pageSize || !assembled.hasMore) {
        ledgerCheckpoints.delete(checkpointKey);
        return { ...assembled, scanLimited: false };
      }
      // Progress survives a transport timeout without exposing a partial user
      // page. Every resumed segment rechecks its canonical anchor and counts.
      rememberLedgerCheckpoint(checkpointKey, assembled, seenCursors);
      requestParams.set("cursor", assembled.nextCursor!);
    }
  } catch (error) {
    if (signal?.aborted || (!controller.signal.aborted && !(error instanceof LedgerReadError && error.retryable))) ledgerCheckpoints.delete(checkpointKey);
    if (controller.signal.aborted && !signal?.aborted) throw new Error("Mainnet request timed out. Retrying…");
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
