import { createDeregistrationTracker } from "./deregistration";
import type { EdgeCache } from "./runtime-types";
import serviceNodeStakeIndex from "../data/service-node-stake-index.json";
import type { RpcResult, RpcInfo, RpcEnvelope, RpcMethods, RpcTransactions } from "./rpc-types";
import { rpcNodePreference, rpcFetchNode } from "./rpc";
import { JUDECOIN_RPC_NODES } from "./constants";

const deregistrationTrackers = new Map<string, ReturnType<typeof createDeregistrationTracker>>();

export function deregistrationTracker(origin: string) {
  const existing = deregistrationTrackers.get(origin);
  if (existing) return existing;
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  const cacheKey = new Request(`${origin}/_internal/stake-index-v2`);
  const tracker = createDeregistrationTracker(serviceNodeStakeIndex, async () => {
    let info: RpcResult<RpcInfo> | undefined;
    let blacklist: unknown;
    const nodes = rpcNodePreference.current
      ? [rpcNodePreference.current, ...JUDECOIN_RPC_NODES.filter((node) => node !== rpcNodePreference.current)]
      : [...JUDECOIN_RPC_NODES];
    for (const node of nodes) {
      try {
        const candidate = await rpcFetchNode<RpcInfo>(node, "/get_info");
        if (candidate.data?.status !== "OK" || !Number.isInteger(candidate.data.height)
          || candidate.data.height - 1 < serviceNodeStakeIndex.scannedThrough) continue;
        const response = await rpcFetchNode<RpcEnvelope<RpcMethods["get_service_node_blacklisted_key_images"]>>(node, "/json_rpc", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "node-lifecycle",
            method: "get_service_node_blacklisted_key_images",
            params: {},
          }),
        });
        if (!Array.isArray(response.data?.result?.blacklist)) continue;
        info = candidate;
        blacklist = response.data.result.blacklist;
        rpcNodePreference.current = node;
        break;
      } catch {
        continue;
      }
    }
    if (!info) throw new Error("Deregistration data unavailable");
    const sourceNode = info.node;
    const call = async <M extends keyof RpcMethods>(method: M, params = {}) => {
      const response = await rpcFetchNode<RpcEnvelope<RpcMethods[M]>>(sourceNode, "/json_rpc", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: "node-lifecycle", method, params }),
      });
      if (!response.data?.result) throw new Error("Invalid node lifecycle response");
      return response.data.result;
    };
    return {
      height: info.data.height - 1,
      blacklist: async () => blacklist as Array<{ key_image: string; unlock_height: number }>,
      headers: async (start: number, end: number) => (await call("get_block_headers_range", {
        start_height: start,
        end_height: end,
        get_tx_hashes: true,
      })).headers,
      transactions: async (hashes: string[]) => {
        const response = await rpcFetchNode<RpcTransactions>(sourceNode, "/get_transactions", {
          method: "POST",
          body: JSON.stringify({ txs_hashes: hashes, decode_as_json: true, tx_extra: true, stake_info: true, prune: true }),
        });
        return response.data.txs;
      },
    };
  }, cache ? {
    load: async () => {
      const response = await cache.match(cacheKey);
      return response ? response.json() : null;
    },
    save: async (value) => {
      await cache.put(cacheKey, new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=604800" },
      }));
    },
  } : undefined);
  deregistrationTrackers.set(origin, tracker);
  return tracker;
}
