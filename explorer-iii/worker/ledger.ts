import type { BlocksPageSnapshot, ChainSnapshot, TransactionsPageSnapshot } from "../app/explorer-types";
import { explorerPageSize } from "./pagination";
import { cachedJsonRpc, cachedRpcFetch, jsonRpc, rpcFetch, rpcFetchNode } from "./rpc";
import type { DecodedTransaction, RpcHeader, RpcInfo, RpcTransaction, RpcTransactions } from "./rpc-types";
import { json } from "./responses";
import { verifiedChainTransactionDetails } from "./transactions";

const LEDGER_SCAN_CHUNK = 512;
const LEDGER_SCAN_LIMIT = 512;
const LEDGER_TX_BATCH = 100;
const LEDGER_MAX_HEIGHT = 9_999_999_999;
const LEDGER_MAX_BLOCK_TRANSACTIONS = 100_000;
const LEDGER_HASH = /^[a-f0-9]{64}$/i;

type LedgerKind = "blocks" | "transactions";
type LedgerCursor = {
  version: 1 | 2;
  kind: LedgerKind;
  anchorHeight: number;
  anchorHash: string;
  nextHeight: number;
  offset: number;
  totalRecords?: number | null;
  position?: number | null;
  pageSize?: number;
};

class LedgerError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}

function ledgerInteger(value: unknown, maximum = LEDGER_MAX_HEIGHT): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function encodeLedgerCursor(cursor: LedgerCursor) {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeLedgerCursor(raw: string, kind: LedgerKind): LedgerCursor {
  try {
    if (raw.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(raw)) throw new Error("Invalid cursor encoding");
    const decoded = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if ((decoded?.version !== 1 && decoded?.version !== 2) || decoded.kind !== kind
      || !ledgerInteger(decoded.anchorHeight) || !LEDGER_HASH.test(String(decoded.anchorHash))
      || !ledgerInteger(decoded.nextHeight) || decoded.nextHeight > decoded.anchorHeight
      || !ledgerInteger(decoded.offset, LEDGER_MAX_BLOCK_TRANSACTIONS)
      || (kind === "blocks" && decoded.offset !== 0)) throw new Error("Invalid cursor fields");
    const cursor: LedgerCursor = { version: decoded.version, kind, anchorHeight: decoded.anchorHeight, anchorHash: decoded.anchorHash.toLowerCase(), nextHeight: decoded.nextHeight, offset: decoded.offset };
    if (decoded.version === 2) {
      if (kind !== "transactions"
        || (decoded.totalRecords !== null && !ledgerInteger(decoded.totalRecords, Number.MAX_SAFE_INTEGER))
        || (decoded.position !== null && !ledgerInteger(decoded.position, Number.MAX_SAFE_INTEGER))
        || ![5, 10, 20, 25, 50, 100].includes(decoded.pageSize)
        || (decoded.totalRecords != null && decoded.totalRecords > (decoded.anchorHeight + 1) * LEDGER_MAX_BLOCK_TRANSACTIONS)
        || (decoded.totalRecords != null && decoded.position != null && decoded.position >= decoded.totalRecords)
        || (decoded.position != null && decoded.position < decoded.offset)
        || (decoded.position != null && decoded.nextHeight === decoded.anchorHeight && decoded.position !== decoded.offset)) {
        throw new Error("Invalid cursor counts");
      }
      cursor.totalRecords = decoded.totalRecords;
      cursor.position = decoded.position;
      cursor.pageSize = decoded.pageSize;
    }
    return cursor;
  } catch {
    throw new LedgerError("Invalid history cursor. Return to the latest records and try again.", 400);
  }
}

// A complete, contiguous range is required before moving a cursor. An RPC node
// silently truncating a response must never cause missing history records.
function verifiedLedgerHeaders(raw: unknown, start: number, end: number): RpcHeader[] {
  if (!Array.isArray(raw) || raw.length !== end - start + 1) {
    throw new LedgerError("The node returned an incomplete block range. Retry this page.");
  }
  const heights = new Set<number>();
  for (const header of raw as RpcHeader[]) {
    if (!header || !ledgerInteger(header.height) || header.height < start || header.height > end
      || heights.has(header.height) || !LEDGER_HASH.test(String(header.hash)) || header.orphan_status
      || !ledgerInteger(header.timestamp, Number.MAX_SAFE_INTEGER)
      || !ledgerInteger(header.num_txes, LEDGER_MAX_BLOCK_TRANSACTIONS)
      || !Number.isFinite(header.block_size) || header.block_size < 0
      || !Number.isFinite(header.difficulty) || header.difficulty < 0
      || !Number.isFinite(header.reward) || header.reward < 0) {
      throw new LedgerError("The node returned invalid block headers. Retry this page.");
    }
    heights.add(header.height);
  }
  return [...raw].sort((left, right) => right.height - left.height);
}

function ledgerTransactionHashes(header: RpcHeader) {
  const hashes = header.tx_hashes ?? (header.num_txes === 0 ? [] : null);
  if (!Array.isArray(hashes) || hashes.length !== header.num_txes
    || hashes.some((hash) => typeof hash !== "string" || !LEDGER_HASH.test(hash))
    || new Set(hashes.map((hash) => hash.toLowerCase())).size !== hashes.length) {
    throw new LedgerError("Transaction hashes are incomplete for a block. Retry this page.");
  }
  return hashes.map((hash) => hash.toLowerCase());
}

async function ledgerHeaderRange(start: number, end: number) {
  const response = await cachedJsonRpc("get_block_headers_range", {
    start_height: start, end_height: end, fill_pow_hash: false, get_tx_hashes: true,
  });
  return verifiedLedgerHeaders(response.data?.result?.headers, start, end);
}

async function ledgerContext(url: URL, kind: LedgerKind) {
  const rawSize = url.searchParams.get("pageSize");
  if (rawSize != null && !/^(5|10|20|25|50|100)$/.test(rawSize)) {
    throw new LedgerError("Choose a page size of 5, 10, 20, 25, 50, or 100.", 400);
  }
  const pageSize = rawSize == null ? 50 : explorerPageSize(rawSize);
  const rawCursor = url.searchParams.get("cursor");
  const existing = rawCursor == null ? null : decodeLedgerCursor(rawCursor, kind);
  if (existing?.version === 2 && existing.pageSize !== pageSize) {
    throw new LedgerError("This history cursor uses a different page size. Return to the latest records.", 400);
  }
  const needsTransactionCount = kind === "transactions" && existing?.totalRecords == null;
  const response = await (needsTransactionCount ? rpcFetch<RpcInfo>("/get_info") : cachedRpcFetch<RpcInfo>("/get_info"));
  const info = response.data;
  if (info?.status !== "OK" || !ledgerInteger(info.height) || info.height < 1
    || info.mainnet === false || (info.nettype != null && info.nettype !== "mainnet")) {
    throw new LedgerError("A synchronized Judecoin mainnet node is unavailable.");
  }
  const height = info.height - 1;
  const anchorHeight = existing?.anchorHeight ?? height;
  if (height < anchorHeight) throw new LedgerError("The node has not reached this history snapshot. Retry this page.");
  // Do not reuse a cached canonicality check: a reorganized anchor must be
  // rejected even when its formerly valid range still exists in the RPC cache.
  const anchorResponse = await jsonRpc("get_block_headers_range", {
    start_height: anchorHeight, end_height: anchorHeight, fill_pow_hash: false, get_tx_hashes: true,
  });
  const anchor = verifiedLedgerHeaders(anchorResponse.data?.result?.headers, anchorHeight, anchorHeight)[0];
  const anchorHash = anchor.hash.toLowerCase();
  if (existing && existing.anchorHash !== anchorHash) {
    throw new LedgerError("The chain changed since this history snapshot. Return to the latest records.", 409);
  }
  let totalRecords: number | null = kind === "blocks" ? anchorHeight + 1 : existing?.totalRecords ?? null;
  const position: number | null = kind === "blocks" ? anchorHeight - (existing?.nextHeight ?? anchorHeight)
    : existing ? existing.position ?? null : 0;
  if (needsTransactionCount && info.height === anchorHeight + 1
    && typeof info.top_block_hash === "string" && info.top_block_hash.toLowerCase() === anchorHash
    && ledgerInteger(info.tx_count, Number.MAX_SAFE_INTEGER)) {
    try {
      // get_info reads the tip before its transaction count. Two uncached
      // reads from one node must agree around anchor verification, otherwise
      // a concurrent block could attach a newer total to an older snapshot.
      const repeated = await rpcFetchNode<RpcInfo>(response.node, "/get_info", undefined, 2_500);
      if (repeated.data.status === "OK" && repeated.data.height === info.height
        && repeated.data.top_block_hash?.toLowerCase() === anchorHash
        && repeated.data.tx_count === info.tx_count && repeated.data.mainnet !== false
        && (repeated.data.nettype == null || repeated.data.nettype === "mainnet")
        && info.tx_count >= anchor.num_txes) totalRecords = info.tx_count;
    } catch { /* A fresh request retries count verification before publishing a counted page. */ }
  }
  if (totalRecords != null && position != null && position > totalRecords) {
    throw new LedgerError("The history cursor exceeds the verified transaction total. Return to the latest records.", 400);
  }
  if (kind === "transactions" && position != null && totalRecords == null) {
    if (existing && height > anchorHeight) {
      throw new LedgerError("This older history snapshot has no verified transaction total. Return to the latest records.", 400);
    }
    throw new LedgerError("The transaction total is being verified. Retry this page.");
  }
  return {
    pageSize, height, anchorHeight, anchorHash, totalRecords, position,
    node: new URL(response.node).hostname,
    cursor: existing ?? { version: 1 as const, kind, anchorHeight, anchorHash, nextHeight: anchorHeight, offset: 0 },
  };
}

async function ledgerTransactionRecords(hashes: string[]) {
  const unique = [...new Set(hashes)];
  const records: RpcTransaction[] = [];
  // Batches are bounded independently of page size and never consume a full
  // decoded block RPC per row. Missing details fail the page before any cursor
  // is exposed, so retrying cannot skip the omitted transaction.
  for (let index = 0; index < unique.length; index += LEDGER_TX_BATCH) {
    const batch = unique.slice(index, index + LEDGER_TX_BATCH);
    const response = await cachedRpcFetch<RpcTransactions>("/get_transactions", {
      method: "POST", body: JSON.stringify({ txs_hashes: batch, decode_as_json: true, tx_extra: true }),
    });
    if (!Array.isArray(response.data?.txs)) throw new LedgerError("Transaction details are unavailable. Retry this page.");
    records.push(...response.data.txs);
  }
  return records;
}

function verifyLedgerTransactionLocations(expected: Array<{ hash: string; block: number }>, records: RpcTransaction[]) {
  const expectedHeights = new Map(expected.map((record) => [record.hash, record.block]));
  if (expectedHeights.size !== expected.length) throw new LedgerError("The node returned duplicate transaction inclusion records. Retry this page.");
  for (const record of records) {
    const hash = String(record.tx_hash).toLowerCase();
    if (!expectedHeights.has(hash)) continue;
    if (record.in_pool === true || record.block_height !== expectedHeights.get(hash)) {
      throw new LedgerError("Transaction inclusion changed or is unverified. Retry this page.");
    }
  }
}

export async function transactionsPageResponse(url: URL): Promise<Response> {
  try {
    const context = await ledgerContext(url, "transactions");
    const { pageSize, anchorHeight, anchorHash, position } = context;
    let totalRecords = context.totalRecords;
    const rawTake = url.searchParams.get("take");
    if (rawTake != null && (!/^[1-9]\d{0,2}$/.test(rawTake) || Number(rawTake) > pageSize)) {
      throw new LedgerError("The requested transaction segment must contain between 1 and the selected page size records.", 400);
    }
    const requestedTake = rawTake == null ? pageSize : Number(rawTake);
    const takeLimit = totalRecords != null && position != null ? Math.min(requestedTake, totalRecords - position) : requestedTake;
    let nextHeight = context.cursor.nextHeight;
    let offset = context.cursor.offset;
    let scannedBlocks = 0;
    let finished = totalRecords != null && position != null && position === totalRecords;
    const selected: Array<{ hash: string; block: number; timestamp: number }> = [];
    while (selected.length < takeLimit && !finished && scannedBlocks < LEDGER_SCAN_LIMIT) {
      const end = nextHeight;
      const start = Math.max(0, end - Math.min(LEDGER_SCAN_CHUNK, LEDGER_SCAN_LIMIT - scannedBlocks) + 1);
      const headers = await ledgerHeaderRange(start, end);
      if (end === anchorHeight && headers[0].hash.toLowerCase() !== anchorHash) {
        throw new LedgerError("The chain changed while reading history. Return to the latest records.", 409);
      }
      if (totalRecords != null && position != null
        && headers.reduce((sum, header) => sum + header.num_txes, 0) - offset > totalRecords - position) {
        throw new LedgerError("The transaction count is smaller than the verified block records. Retry this page.");
      }
      for (const header of headers) {
        scannedBlocks += 1;
        const hashes = ledgerTransactionHashes(header);
        if (offset > hashes.length) throw new LedgerError("History cursor no longer matches this block. Return to the latest records.", 409);
        const take = Math.min(takeLimit - selected.length, hashes.length - offset);
        selected.push(...hashes.slice(offset, offset + take).map((hash) => ({ hash, block: header.height, timestamp: header.timestamp })));
        offset += take;
        if (offset < hashes.length) {
          nextHeight = header.height;
          break;
        }
        offset = 0;
        nextHeight = header.height - 1;
        if (nextHeight < 0) { finished = true; break; }
        if (selected.length === takeLimit) break;
      }
    }
    const nextPosition = position == null ? null : position + selected.length;
    if (nextPosition != null && !Number.isSafeInteger(nextPosition)) throw new LedgerError("The transaction history position is invalid. Retry this page.");
    if (totalRecords != null && nextPosition != null) {
      if (nextPosition > totalRecords || (finished && nextPosition !== totalRecords)) {
        throw new LedgerError("The transaction count does not match the verified history. Retry this page.");
      }
      if (nextPosition === totalRecords) finished = true;
    } else if (finished && nextPosition != null) {
      totalRecords = nextPosition;
    }
    const records = await ledgerTransactionRecords(selected.map((record) => record.hash));
    verifyLedgerTransactionLocations(selected, records);
    const details = verifiedChainTransactionDetails(selected.map((record) => record.hash), records);
    const rows: ChainSnapshot["transactions"] = selected.map((record) => ({
      ...record, ...details.get(record.hash)!, reward: 0, confirmations: context.height - record.block + 1,
    }));
    const hasMore = !finished;
    const result: TransactionsPageSnapshot = {
      live: true, fetchedAt: new Date().toISOString(), source: "Judecoin mainnet", node: context.node,
      height: context.height, anchorHeight, anchorHash, pageSize, rows, hasMore, scannedBlocks, totalRecords, position,
      scanLimited: hasMore && rows.length < requestedTake,
      nextCursor: hasMore ? encodeLedgerCursor({ version: 2, kind: "transactions", anchorHeight, anchorHash, nextHeight, offset, totalRecords, position: nextPosition, pageSize }) : null,
    };
    return json(result);
  } catch (error) {
    return json({ live: false, error: error instanceof Error ? error.message : "Transaction history unavailable" }, error instanceof LedgerError ? error.status : 503);
  }
}

function verifiedLedgerMiner(record: RpcTransaction | undefined, height: number) {
  if (!record || record.in_pool === true || record.block_height !== height || !record.as_json) return null;
  try {
    const parsed = JSON.parse(record.as_json) as DecodedTransaction;
    if (!Array.isArray(parsed.vin) || parsed.vin.length !== 1 || parsed.vin[0].gen?.height !== height
      || !Array.isArray(parsed.vout)) return null;
    return { inputs: 0, outputs: parsed.vout.length };
  } catch { return null; }
}

export async function blocksPageResponse(url: URL): Promise<Response> {
  try {
    const context = await ledgerContext(url, "blocks");
    const { pageSize, anchorHeight, anchorHash } = context;
    const end = context.cursor.nextHeight;
    const start = Math.max(0, end - pageSize + 1);
    const headers = await ledgerHeaderRange(start, end);
    if (end === anchorHeight && headers[0].hash.toLowerCase() !== anchorHash) {
      throw new LedgerError("The chain changed while reading history. Return to the latest records.", 409);
    }
    const overview = url.searchParams.get("overview") === "1";
    let pendingDetails = overview;
    let rows: ChainSnapshot["blocks"] = headers.map((header) => ({
      height: header.height, timestamp: header.timestamp, hash: header.hash, txs: header.num_txes,
      size: header.block_size, difficulty: header.difficulty,
      fee: header.num_txes === 0 ? 0 : null, reward: header.num_txes === 0 ? header.reward : null,
      inputs: null, outputs: null,
    }));
    if (!overview) {
      try {
        const regular = headers.flatMap((header) => ledgerTransactionHashes(header).map((hash) => ({ hash, block: header.height })));
        // An exceptionally busy range still displays verified headers promptly;
        // it does not trigger unbounded detail RPC work in a listing request.
        if (regular.length > 2_000) throw new Error("Block details exceed the listing batch limit");
        const minerHashes = headers.map((header) => header.miner_tx_hash).filter((hash): hash is string => Boolean(hash && LEDGER_HASH.test(hash))).map((hash) => hash.toLowerCase());
        const records = await ledgerTransactionRecords([...regular.map((record) => record.hash), ...minerHashes]);
        verifyLedgerTransactionLocations(regular, records);
        const details = verifiedChainTransactionDetails(regular.map((record) => record.hash), records);
        const recordByHash = new Map<string, RpcTransaction>();
        const duplicateHashes = new Set<string>();
        for (const record of records) {
          const hash = String(record.tx_hash).toLowerCase();
          if (recordByHash.has(hash)) duplicateHashes.add(hash);
          recordByHash.set(hash, record);
        }
        rows = rows.map((row, index) => {
          const header = headers[index];
          const transactions = ledgerTransactionHashes(header).map((hash) => details.get(hash)!);
          const fee = transactions.reduce((sum, record) => sum + record.fee, 0);
          if (fee > header.reward) throw new Error("Block fees exceed its total reward");
          const minerHash = header.miner_tx_hash?.toLowerCase();
          const miner = minerHash && !duplicateHashes.has(minerHash) ? verifiedLedgerMiner(recordByHash.get(minerHash), header.height) : null;
          return {
            ...row, fee, reward: header.reward - fee,
            inputs: miner ? miner.inputs + transactions.reduce((sum, record) => sum + record.inputs, 0) : null,
            outputs: miner ? miner.outputs + transactions.reduce((sum, record) => sum + record.outputs, 0) : null,
          };
        });
        pendingDetails = rows.some((row) => row.inputs == null || row.outputs == null);
      } catch {
        pendingDetails = true;
      }
    }
    const hasMore = start > 0;
    const result: BlocksPageSnapshot = {
      live: true, fetchedAt: new Date().toISOString(), source: "Judecoin mainnet", node: context.node,
      height: context.height, anchorHeight, anchorHash, pageSize, rows, hasMore,
      totalRecords: context.totalRecords, position: context.position,
      scannedBlocks: rows.length, scanLimited: false,
      ...(pendingDetails ? { pendingDetails: true } : {}),
      nextCursor: hasMore ? encodeLedgerCursor({ version: 1, kind: "blocks", anchorHeight, anchorHash, nextHeight: start - 1, offset: 0 }) : null,
    };
    return json(result);
  } catch (error) {
    return json({ live: false, error: error instanceof Error ? error.message : "Block history unavailable" }, error instanceof LedgerError ? error.status : 503);
  }
}
