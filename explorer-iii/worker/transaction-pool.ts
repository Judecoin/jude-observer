import { JUDECOIN_RPC_NODES, EXPLORER_PAGE_SIZE } from "./constants";
import { cachedRpcFetchNode } from "./rpc";
import type { RpcInfo, RpcPool, RpcPoolTransaction, RpcTransaction, RpcTransactions, DecodedTransaction } from "./rpc-types";
import { requireSynchronizedPoolQuorum, classifyTransaction } from "./transactions";

export async function transactionPoolSnapshot() {

  const poolResults = await Promise.allSettled(
    JUDECOIN_RPC_NODES.map(async (node) => {
      const [nodeInfo, pool] = await Promise.all([
        cachedRpcFetchNode<RpcInfo>(node, "/get_info"),
        cachedRpcFetchNode<RpcPool>(node, "/get_transaction_pool"),
      ]);
      return {
        node,
        height: Number(nodeInfo.data?.height || 0),
        status: String(nodeInfo.data?.status || ""),
        transactions: Array.isArray(pool.data?.transactions) ? pool.data.transactions : [],
      };
    }),
  );
  const reachablePools = poolResults
    .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    .filter((candidate) => candidate.status === "OK" && Number.isInteger(candidate.height) && candidate.height > 0);
  if (!reachablePools.length) throw new Error("No Judecoin transaction pool is reachable");
  const synchronizedHeight = Math.max(...reachablePools.map((candidate) => candidate.height));
  const synchronizedPools = reachablePools.filter((candidate) => candidate.height === synchronizedHeight);
  requireSynchronizedPoolQuorum(synchronizedPools.length);
  const observations = new Map<string, { transaction: RpcPoolTransaction; nodes: string[] }>();
  for (const candidate of synchronizedPools) {
    for (const transaction of candidate.transactions) {
      const hash = String(transaction.id_hash || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) continue;
      const observation = observations.get(hash) || { transaction, nodes: [] };
      if (!observation.nodes.includes(candidate.node)) observation.nodes.push(candidate.node);
      if (String(transaction.tx_json || "").length > String(observation.transaction.tx_json || "").length) {
        observation.transaction = transaction;
      }
      observations.set(hash, observation);
    }
  }

  const poolDetails = new Map<string, RpcTransaction>();
  const validationResults = await Promise.allSettled(synchronizedPools.map(async (candidate) => {
    const hashes = candidate.transactions
      .map((transaction) => String(transaction.id_hash || "").toLowerCase())
      .filter((hash: string) => /^[a-f0-9]{64}$/.test(hash));
    if (!hashes.length) return [];
    const response = await cachedRpcFetchNode<RpcTransactions>(candidate.node, "/get_transactions", {
      method: "POST",
      body: JSON.stringify({ txs_hashes: hashes, decode_as_json: true, tx_extra: true }),
    });
    return Array.isArray(response.data?.txs) ? response.data.txs : [];
  }));
  for (const result of validationResults) {
    if (result.status !== "fulfilled") continue;
    for (const detail of result.value) {
      const hash = String(detail.tx_hash || "").toLowerCase();
      if (!observations.has(hash)) continue;
      if (detail.in_pool !== true || Number(detail.block_height || 0) > 0 || detail.double_spend_seen === true) continue;
      poolDetails.set(hash, detail);
    }
  }
  const rawPool = [...observations.entries()]
    .filter(([hash, observation]) => observation.nodes.length >= 2 && poolDetails.has(hash))
    .map(([, observation]) => observation.transaction);
  const transactions = rawPool
    .filter((transaction) => /^[a-f0-9]{64}$/.test(String(transaction.id_hash || "")))
    .sort((a, b) => Number(b.receive_time || b.last_relayed_time || 0) - Number(a.receive_time || a.last_relayed_time || 0))
    .slice(0, EXPLORER_PAGE_SIZE)
    .map((transaction) => {
      const parsed: DecodedTransaction = JSON.parse(transaction.tx_json || "{}");
      const decoded = poolDetails.get(String(transaction.id_hash || ""));
      return {
        hash: String(transaction.id_hash || ""),
        receivedAt: Number(transaction.receive_time || transaction.last_relayed_time || 0),
        txType: classifyTransaction(parsed, decoded || transaction),
        fee: Number(transaction.fee || parsed.rct_signatures?.txnFee || 0),
        size: Number(transaction.blob_size || transaction.weight || 0),
        inputs: Array.isArray(parsed.vin) ? parsed.vin.length : 0,
        outputs: Array.isArray(parsed.vout) ? parsed.vout.length : 0,
      };
    })
    .filter((transaction: { hash: string }) => /^[a-f0-9]{64}$/.test(transaction.hash));

  return {
    available: true,
    count: rawPool.length,
    totalBytes: rawPool.reduce((sum: number, transaction) => (
      sum + Number(transaction.blob_size || transaction.weight || 0)
    ), 0),
    transactions,
  };
}
