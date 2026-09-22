import { EXPLORER_PAGE_SIZE, JUDECOIN_EMISSION_API } from "./constants";
import { cachedRpcFetchNode, cachedRpcFetch, cachedJsonRpc } from "./rpc";
import type { RpcEmission, RpcInfo, RpcHeader, DecodedBlock, RpcTransactions, RpcServiceNode } from "./rpc-types";
import { serviceNodeStatesRequest, buildServiceNodesSnapshot } from "./service-nodes";
import { quorumPageSnapshot } from "./quorums";
import { verifiedChainTransactionDetails } from "./transactions";
import deregisteredHistory from "../data/deregistered-service-nodes.json";
import { explorerPageSize } from "./pagination";
import { json } from "./responses";

async function chainSnapshot(
  blockPage = 0,
  transactionPage = 0,
  quorumPage = 0,
  blockPageSize = EXPLORER_PAGE_SIZE,
  transactionPageSize = EXPLORER_PAGE_SIZE,
  quorumPageSize = EXPLORER_PAGE_SIZE,
) {

  const emissionSnapshotPromise = cachedRpcFetchNode<RpcEmission>(JUDECOIN_EMISSION_API, "").catch(() => null);
  const infoResponse = await cachedRpcFetch<RpcInfo>("/get_info");
  const info = infoResponse.data;
  if (info?.status !== "OK" || !Number.isInteger(info.height)) throw new Error("Invalid Judecoin node response");

  const topHeight = Math.max(0, info.height - 1);

  const serviceNodesResponsePromise = serviceNodeStatesRequest(topHeight);

  const quorumSnapshotPromise = quorumPageSnapshot(topHeight, quorumPage, quorumPageSize).catch(() => null);
  const transactionScanSize = Math.max(160, transactionPageSize * 32);
  const transactionEndHeight = Math.max(0, topHeight - transactionPage * transactionScanSize);
  const startHeight = Math.max(0, transactionEndHeight - (transactionScanSize - 1));
  const blockEndHeight = Math.max(0, topHeight - blockPage * blockPageSize);
  const blockStartHeight = Math.max(0, blockEndHeight - (blockPageSize - 1));
  const reuseTransactionHeaders = blockPage === 0 && transactionPage === 0;

  const [headersResponse, blockHeadersResponse] = await Promise.all([
    cachedJsonRpc("get_block_headers_range", {
      start_height: startHeight,
      end_height: transactionEndHeight,
      fill_pow_hash: false,
      get_tx_hashes: true,
    }),
    reuseTransactionHeaders ? null : cachedJsonRpc("get_block_headers_range", {
      start_height: blockStartHeight,
      end_height: blockEndHeight,
      fill_pow_hash: false,
      get_tx_hashes: true,
    }),
  ]);
  const headers = (headersResponse.data?.result?.headers || []) as RpcHeader[];
  if (!headers.length) throw new Error("Judecoin node returned no block headers");

  const blockHeaders = reuseTransactionHeaders
    ? headers.filter((header) => header.height >= blockStartHeight)
    : (blockHeadersResponse?.data?.result?.headers || []) as RpcHeader[];

  const newest = [...headers].reverse();

  const selectedTipHeader = headers.find((header) => header.height === topHeight)
    ?? blockHeaders.find((header) => header.height === topHeight);

  const tipHeaderPromise = selectedTipHeader ? Promise.resolve(selectedTipHeader)
    : cachedJsonRpc("get_block_headers_range", {
      start_height: topHeight, end_height: topHeight, fill_pow_hash: false,
    }).then((response) => (response.data?.result?.headers || []).find((header: RpcHeader) => header.height === topHeight));
  const latestBlockHeaders = [...blockHeaders].reverse().slice(0, blockPageSize);
  const latestBlockDetailsPromise = Promise.all(latestBlockHeaders.map(async (header) => {
    const response = await cachedJsonRpc("get_block", { height: header.height });
    return JSON.parse(response.data?.result?.json || "{}") as DecodedBlock;
  }));
  const transactionBlocks = newest.filter((header) => header.num_txes > 0).slice(0, transactionPageSize);
  const transactionGroups = transactionBlocks.map((header) => {
    return (Array.isArray(header.tx_hashes) ? header.tx_hashes : []).map((hash: string) => ({
      hash,
      block: header.height,
      timestamp: header.timestamp,
      size: null,
      confirmations: topHeight - header.height + 1,
    }));
  });

  const transactionBase = transactionGroups.flat().slice(0, transactionPageSize);
  const requestedTxHashes = [...new Set([
    ...transactionBase.map((transaction) => transaction.hash),
    ...latestBlockHeaders.flatMap((header) => Array.isArray(header.tx_hashes) ? header.tx_hashes : []),
  ])];
  const transactionDetailsPromise = requestedTxHashes.length ? cachedRpcFetch<RpcTransactions>("/get_transactions", {
    method: "POST",
    body: JSON.stringify({ txs_hashes: requestedTxHashes, decode_as_json: true, tx_extra: true }),
  }) : { data: { txs: [] } };
  const [serviceNodesResponse, resolvedQuorumSnapshot, emissionResponse, latestBlockDetails, transactionDetailsResponse, tipHeader] = await Promise.all([
    serviceNodesResponsePromise,
    quorumSnapshotPromise,
    emissionSnapshotPromise,
    latestBlockDetailsPromise,
    transactionDetailsPromise,
    tipHeaderPromise,
  ]);
  if (!tipHeader || !Number.isInteger(tipHeader.timestamp)) throw new Error("Live chain tip header unavailable");
  const latestBlockTimestamp = Number(tipHeader.timestamp);
  const latestBlockAgeSeconds = latestBlockTimestamp > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - latestBlockTimestamp) : Number.MAX_SAFE_INTEGER;
  const targetSeconds = Math.max(1, Number(info.target || 180));
  const serviceNodeTopHeight = Number(serviceNodesResponse.data?.info?.height) - 1;
  const serviceNodeStatesResult = serviceNodesResponse.data?.serviceNodeStates;
  if (!Array.isArray(serviceNodeStatesResult)) {
    throw new Error("Invalid Judecoin service-node response");
  }
  const serviceNodeStates = serviceNodeStatesResult as RpcServiceNode[];
  const currentServiceNodeStates = serviceNodeStates.filter(
    (node) => node.requested_unlock_height === 0 || node.requested_unlock_height > serviceNodeTopHeight,
  );
  let quorumSnapshot: Awaited<ReturnType<typeof quorumPageSnapshot>> = {
    live: false, fetchedAt: new Date().toISOString(), height: topHeight,
    source: "Judecoin mainnet quorum data", type: "Service Node testing", quorumType: 0,
    trusted: false, page: quorumPage, pageSize: quorumPageSize, hasOlder: true, truncated: false, records: [], unavailable: ["Checkpoint", "Blink", "Pulse"],
  };
  if (resolvedQuorumSnapshot) quorumSnapshot = resolvedQuorumSnapshot;
  const emissionRecord = emissionResponse?.data?.status === "success" ? emissionResponse.data?.data : null;
  const minedSupply = Number(emissionRecord?.coinbase || 0);
  const supplyHeight = Number(emissionRecord?.blk_no || 0);
  const hasCurrentMinedSupply = Number.isFinite(minedSupply)
    && minedSupply > 0
    && Number.isInteger(supplyHeight)
    && Math.abs(supplyHeight - topHeight) <= 1_000;
  const transactionDetails = verifiedChainTransactionDetails(
    requestedTxHashes,
    transactionDetailsResponse.data?.txs,
  );

  return {
    live: true,
    source: "Judecoin mainnet",
    node: new URL(infoResponse.node).hostname,
    fetchedAt: new Date().toISOString(),
    network: {
      height: topHeight,
      difficulty: Number(info.difficulty || tipHeader.difficulty),
      targetSeconds,
      hashrate: Number(info.difficulty || tipHeader.difficulty) / targetSeconds,
      hardFork: Number(info.hard_fork || tipHeader.major_version),
      protocol: String(info.version || tipHeader.major_version),
      txPoolSize: Number(info.tx_pool_size || 0),
      blockSizeMedian: Number(info.block_weight_median || info.block_size_median || 0),
      blockSizeLimit: Number(info.block_weight_limit || info.block_size_limit || 0),
      coinbase: null,
      fees: null,
      minedSupply: hasCurrentMinedSupply ? minedSupply : null,
      supplyHeight: hasCurrentMinedSupply ? supplyHeight : null,
      supplySource: hasCurrentMinedSupply ? "Judecoin emission index API" : null,
      latestBlockTimestamp,
      latestBlockAgeSeconds,
      synced: latestBlockAgeSeconds <= Math.max(900, targetSeconds * 5),
    },
    transactionPool: {
      available: false,
      count: 0,
      totalBytes: 0,
      transactions: [],
    },
    pagination: { blockPage, transactionPage, pageSize: blockPageSize, transactionScanSize },
    blocks: latestBlockHeaders.map((header, index) => {
      const parsed = latestBlockDetails[index] || {};
      const minerInputs = Array.isArray(parsed.miner_tx?.vin) && parsed.miner_tx.vin.some((input) => input?.gen) ? 0 : (parsed.miner_tx?.vin?.length || 0);
      const minerOutputs = parsed.miner_tx?.vout?.length || 0;
      const regularTransactions = (parsed.tx_hashes || []).map(
        (hash: string) => transactionDetails.get(String(hash).toLowerCase()),
      ).filter(Boolean) as Array<{ fee: number; inputs: number; outputs: number }>;
      const blockFee = regularTransactions.reduce((sum, transaction) => sum + transaction.fee, 0);
      return {
      height: header.height,
      timestamp: header.timestamp,
      hash: header.hash,
      txs: header.num_txes,
      size: header.block_size,
      difficulty: header.difficulty,
      fee: blockFee,
      reward: Math.max(0, Number(header.reward || 0) - blockFee),
      inputs: minerInputs + regularTransactions.reduce((sum, transaction) => sum + transaction.inputs, 0),
      outputs: minerOutputs + regularTransactions.reduce((sum, transaction) => sum + transaction.outputs, 0),
    }; }),
    transactions: transactionBase.map((transaction) => {
      const details = transactionDetails.get(transaction.hash.toLowerCase());
      if (!details) throw new Error(`Verified transaction details missing for ${transaction.hash}`);
      return { ...transaction, txType: details.txType, size: details.size, fee: details.fee, reward: 0, inputs: details.inputs, outputs: details.outputs };
    }),
    serviceNodesHeight: serviceNodeTopHeight,
    serviceNodes: buildServiceNodesSnapshot(currentServiceNodeStates, serviceNodeTopHeight),
    quorums: quorumSnapshot,
    deregisteredServiceNodes: {
      total: deregisteredHistory.nodes.length,
      page: 0,
      pageSize: deregisteredHistory.nodes.length,
      indexedThrough: deregisteredHistory.sourceHeight,
      generatedAt: deregisteredHistory.generatedAt,
      nodes: deregisteredHistory.nodes
        .map((node) => ({ ...node })),
    },
  };
}

export async function createChainResponse(url: URL) {
  try {
    const blockPage = Math.min(10000, Math.max(0, Number.parseInt(url.searchParams.get("blockPage") || "0", 10) || 0));
    const transactionPage = Math.min(10000, Math.max(0, Number.parseInt(url.searchParams.get("transactionPage") || "0", 10) || 0));
    const quorumPage = Math.min(10000, Math.max(0, Number.parseInt(url.searchParams.get("quorumPage") || "0", 10) || 0));
    const blockPageSize = explorerPageSize(url.searchParams.get("blockPageSize"));
    const transactionPageSize = explorerPageSize(url.searchParams.get("transactionPageSize"));
    const quorumPageSize = explorerPageSize(url.searchParams.get("quorumPageSize"));
    const snapshot = await chainSnapshot(
      blockPage, transactionPage, quorumPage,
      blockPageSize, transactionPageSize, quorumPageSize,
    );
    const requestedTip = Number.parseInt(url.searchParams.get("tip") || "", 10);
    if (Number.isInteger(requestedTip) && requestedTip >= 0 && snapshot.network.height < requestedTip) {
      throw new Error("Judecoin chain snapshot has not reached the requested tip");
    }
    return json(snapshot);
  } catch (error) {
    return json({ live: false, error: error instanceof Error ? error.message : "Network data unavailable" }, 503);
  }
}
