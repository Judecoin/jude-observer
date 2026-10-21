import { cachedJsonRpc, cachedRpcFetch } from "./rpc";
import type { DecodedBlock, DecodedTransaction, RpcHeader, RpcTransaction, RpcTransactions } from "./rpc-types";

const CHAIN_TX_BATCH_SIZE = 100;
const CHAIN_BLOCK_CONCURRENCY = 4;

export function chainHeaders(raw: unknown, start: number, end: number): RpcHeader[] {
  if (!Array.isArray(raw) || raw.length !== end - start + 1) throw new Error("Incomplete chain header range");
  const heights = new Set<number>();
  for (const header of raw as RpcHeader[]) {
    const hashes = header?.tx_hashes ?? (header?.num_txes === 0 ? [] : null);
    if (!header || !Number.isInteger(header.height) || header.height < start || header.height > end
      || heights.has(header.height) || !/^[a-f0-9]{64}$/i.test(header.hash) || header.orphan_status
      || !Number.isSafeInteger(header.timestamp) || header.timestamp < 0
      || !Number.isSafeInteger(header.num_txes) || header.num_txes < 0
      || ![header.reward, header.block_size, header.difficulty].every((value) => Number.isFinite(value) && value >= 0)
      || !Array.isArray(hashes) || hashes.length !== header.num_txes
      || hashes.some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash))
      || new Set(hashes.map((hash) => hash.toLowerCase())).size !== hashes.length) {
      throw new Error("Invalid chain header or transaction hash list");
    }
    heights.add(header.height);
  }
  return [...raw].sort((left, right) => left.height - right.height);
}

export function chainMinerHash(header: RpcHeader) {
  return typeof header.miner_tx_hash === "string" && /^[a-f0-9]{64}$/i.test(header.miner_tx_hash)
    ? header.miner_tx_hash.toLowerCase() : null;
}

// A failed batch must not discard verified records from successful batches.
export async function chainTransactionRecords(hashes: string[]) {
  const unique = [...new Set(hashes.map((hash) => hash.toLowerCase()))];
  const records: RpcTransaction[] = [];
  for (let index = 0; index < unique.length; index += CHAIN_TX_BATCH_SIZE) {
    const batch = unique.slice(index, index + CHAIN_TX_BATCH_SIZE);
    try {
      const response = await cachedRpcFetch<RpcTransactions>("/get_transactions", {
        method: "POST",
        body: JSON.stringify({ txs_hashes: batch, decode_as_json: true, tx_extra: true }),
      });
      if (Array.isArray(response.data?.txs)) {
        const requested = new Set(batch);
        records.push(...response.data.txs.filter((record) => requested.has(String(record?.tx_hash).toLowerCase())));
      }
    } catch { /* Missing details remain null and are retried by the client. */ }
  }
  return records;
}

function chainMinerTransaction(parsed: DecodedTransaction | undefined, height: number) {
  return parsed && Array.isArray(parsed.vin) && parsed.vin.length === 1
    && parsed.vin[0]?.gen?.height === height && Array.isArray(parsed.vout) ? parsed : null;
}

export async function chainBlockDetails(headers: RpcHeader[], records: RpcTransaction[]) {
  const byHash = new Map<string, RpcTransaction | null>();
  for (const record of records) {
    const hash = String(record?.tx_hash).toLowerCase();
    byHash.set(hash, byHash.has(hash) ? null : record);
  }
  const blocks: Array<DecodedBlock | null> = headers.map((header) => {
    const hash = chainMinerHash(header);
    const record = hash ? byHash.get(hash) : null;
    if (!record || record.in_pool === true || record.block_height !== header.height || !record.as_json) return null;
    try {
      const miner = chainMinerTransaction(JSON.parse(record.as_json), header.height);
      return miner ? { miner_tx: miner, tx_hashes: header.tx_hashes ?? [] } : null;
    } catch { return null; }
  });
  // Older nodes may not expose miner_tx_hash or return coinbase transactions.
  // Keep that compatibility path, but never fan out a full page concurrently.
  const missing = headers.map((_, index) => index).filter((index) => !blocks[index]);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CHAIN_BLOCK_CONCURRENCY, missing.length) }, async () => {
    while (cursor < missing.length) {
      const index = missing[cursor++];
      const header = headers[index];
      try {
        // Hash addressing cannot silently read a replacement block at this height.
        const response = await cachedJsonRpc("get_block", { hash: header.hash });
        const result = response.data?.result;
        const verified = result?.block_header;
        const parsed = JSON.parse(result?.json || "null") as DecodedBlock | null;
        const expected = header.tx_hashes ?? [];
        if (!verified || verified.hash?.toLowerCase() !== header.hash.toLowerCase()
          || verified.height !== header.height || verified.orphan_status
          || !parsed || !chainMinerTransaction(parsed.miner_tx, header.height)
          || !Array.isArray(parsed.tx_hashes) || parsed.tx_hashes.length !== expected.length
          || parsed.tx_hashes.some((hash, position) => hash.toLowerCase() !== expected[position].toLowerCase())) continue;
        blocks[index] = parsed;
      } catch { /* Preserve verified headers, never fabricate decoded fields. */ }
    }
  }));
  return blocks;
}
