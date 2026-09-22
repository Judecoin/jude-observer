import { cachedRpcFetch, cachedJsonRpc } from "./rpc";
import type { RpcInfo, RpcHeader } from "./rpc-types";

export async function networkPreviewSnapshot() {
  const [infoResponse, headerResponse] = await Promise.all([
    cachedRpcFetch<RpcInfo>("/get_info"),
    cachedJsonRpc("get_last_block_header"),
  ]);
  const info = infoResponse.data;
  const header = headerResponse.data?.result?.block_header as RpcHeader | undefined;
  if (info?.status !== "OK" || !Number.isInteger(info.height) || !header) {
    throw new Error("Invalid Judecoin network overview response");
  }
  const topHeight = Math.max(0, Number(header.height || info.height - 1));
  const latestBlockTimestamp = Number(header.timestamp || 0);
  const targetSeconds = Math.max(1, Number(info.target || 180));
  const latestBlockAgeSeconds = latestBlockTimestamp > 0
    ? Math.max(0, Math.floor(Date.now() / 1000) - latestBlockTimestamp)
    : Number.MAX_SAFE_INTEGER;
  const difficulty = Number(info.difficulty || header.difficulty || 0);

  return {
    live: true,
    source: "Judecoin mainnet",
    node: new URL(infoResponse.node).hostname,
    fetchedAt: new Date().toISOString(),
    network: {
      height: topHeight,
      difficulty,
      targetSeconds,
      hashrate: difficulty / targetSeconds,
      hardFork: Number(info.hard_fork || header.major_version),
      protocol: String(info.version || header.major_version),
      txPoolSize: Number(info.tx_pool_size || 0),
      blockSizeMedian: Number(info.block_weight_median || info.block_size_median || 0),
      blockSizeLimit: Number(info.block_weight_limit || info.block_size_limit || 0),
      coinbase: null,
      fees: null,
      minedSupply: null,
      supplyHeight: null,
      supplySource: null,
      latestBlockTimestamp,
      latestBlockAgeSeconds,
      synced: latestBlockAgeSeconds <= Math.max(900, targetSeconds * 5),
    },
  };
}
