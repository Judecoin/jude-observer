import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import deregisteredHistory from "../data/deregistered-service-nodes.json";
import serviceNodeStakeIndex from "../data/service-node-stake-index.json";
import { createDeregistrationTracker } from "./deregistration";

interface AssetFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const JUDECOIN_RPC_NODES = [
  "http://node1.judecoin.com:16061",
  "http://node.judecoin.info:16061",
  "http://67.230.167.187:16061",
] as const;

const JUDECOIN_EMISSION_API = "https://www.judeblock.net/api/emission";

const EXPLORER_PAGE_SIZE = 5;
const EXPLORER_PAGE_SIZES = new Set([5, 10, 20, 25, 50, 100]);
const MAX_QUORUM_PAGE = 10_000;
const CHAIN_CACHE_FRESH_MS = 5_000;
const CHAIN_CACHE_STALE_MS = 300_000;
const CHAIN_CACHE_TTL_SECONDS = 600;
const CHAIN_CACHE_CREATED_HEADER = "x-judecoin-snapshot-created-at";
const SERVICE_NODES_CACHE_FRESH_MS = 5_000;
const SERVICE_NODES_CACHE_STALE_MS = 300_000;
const SERVICE_NODES_CACHE_TTL_SECONDS = 600;
const SERVICE_NODES_CACHE_CREATED_HEADER = "x-judecoin-service-nodes-created-at";
const NETWORK_CACHE_FRESH_MS = 3_000;
const NETWORK_CACHE_STALE_MS = 15_000;
const NETWORK_CACHE_TTL_SECONDS = 30;
const NETWORK_CACHE_CREATED_HEADER = "x-judecoin-network-created-at";
const TRANSACTION_POOL_CACHE_FRESH_MS = 5_000;
const TRANSACTION_POOL_CACHE_STALE_MS = 15_000;
const TRANSACTION_POOL_CACHE_TTL_SECONDS = 30;
const TRANSACTION_POOL_CACHE_CREATED_HEADER = "x-judecoin-pool-created-at";
const QUORUM_CACHE_FRESH_MS = 15_000;
const QUORUM_CACHE_STALE_MS = 300_000;
const QUORUM_CACHE_TTL_SECONDS = 600;
const QUORUM_CACHE_CREATED_HEADER = "x-judecoin-quorum-created-at";
const MAX_QUORUM_TIP = 100_000_000;
const RPC_CACHE_MAX_ENTRIES = 200;

interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function explorerPageSize(value: string | null) {
  const parsed = Number.parseInt(value || String(EXPLORER_PAGE_SIZE), 10);
  return EXPLORER_PAGE_SIZES.has(parsed) ? parsed : EXPLORER_PAGE_SIZE;
}

function requestedQuorumPage(url: URL) {
  const raw = url.searchParams.get("page") || "0";
  if (!/^\d{1,5}$/.test(raw)) throw new RangeError("Invalid quorum page");
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page < 0 || page > MAX_QUORUM_PAGE) {
    throw new RangeError("Invalid quorum page");
  }
  return page;
}

function requestedQuorumTip(url: URL) {
  const raw = url.searchParams.get("tip");
  if (raw == null || raw === "") return undefined;
  if (!/^\d{1,9}$/.test(raw)) throw new RangeError("Invalid quorum tip");
  const tip = Number(raw);
  if (!Number.isSafeInteger(tip) || tip < 0 || tip > MAX_QUORUM_TIP) {
    throw new RangeError("Invalid quorum tip");
  }
  return tip;
}

type ExplorerTxType = "block-reward" | "transfer" | "registration" | "contribution" | "recommission" | "decommission" | "deregistration" | "ip-change" | "unlock" | "state-change";

function classifyTransaction(parsed: any, rpcExtra: any = {}): ExplorerTxType {
  const type = Number(parsed?.type || 0);
  
  
  
  
  const extra = rpcExtra?.extra && typeof rpcExtra.extra === "object" ? rpcExtra.extra : rpcExtra;
  const state = String(extra?.sn_state_change?.type || "").toLowerCase();
  if (state === "dereg" || state === "deregister" || state === "deregistration") return "deregistration";
  if (state === "decom" || state === "decomm" || state === "decommission") return "decommission";
  if (state === "recom" || state === "recomm" || state === "recommission") return "recommission";
  if (state === "ip" || state === "ip-change" || state === "ip_change") return "ip-change";

  
  
  if (extra?.sn_registration) return "registration";
  if (extra?.sn_contributor) return "contribution";
  if (type === 2 || extra?.key_image_unlock) return "unlock";
  if (Array.isArray(parsed?.vin) && parsed.vin.some((input: any) => input?.gen)) return "block-reward";
  if (type === 0) return "transfer";
  if (type === 1) return "state-change";
  
  
  if (type === 3) return "state-change";
  return "state-change";
}

type VerifiedChainTransactionDetail = {
  fee: number;
  inputs: number;
  outputs: number;
  size: number;
  txType: ExplorerTxType;
};

function verifiedChainTransactionDetails(requestedHashes: string[], rawTransactions: unknown) {
  if (!Array.isArray(rawTransactions)) {
    throw new Error("Judecoin returned no transaction-detail array");
  }
  const requested = new Set(requestedHashes.map((hash) => String(hash).toLowerCase()));
  if ([...requested].some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Judecoin returned an invalid requested transaction hash");
  }
  const details = new Map<string, VerifiedChainTransactionDetail>();
  for (const transaction of rawTransactions) {
    const hash = String(transaction?.tx_hash || "").toLowerCase();
    if (!requested.has(hash)) continue;
    if (details.has(hash)) throw new Error(`Judecoin returned duplicate transaction details for ${hash}`);
    if (typeof transaction?.as_json !== "string" || !transaction.as_json) {
      throw new Error(`Judecoin returned incomplete transaction details for ${hash}`);
    }
    const parsed = JSON.parse(transaction.as_json);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.vin) || !Array.isArray(parsed.vout)) {
      throw new Error(`Judecoin returned incomplete transaction fields for ${hash}`);
    }
    
    
    const protocolZeroFee = parsed.rct_signatures?.type === 0;
    if (parsed.rct_signatures?.txnFee == null && !protocolZeroFee) {
      throw new Error(`Judecoin returned incomplete transaction fee fields for ${hash}`);
    }
    const fee = protocolZeroFee ? 0 : Number(parsed.rct_signatures.txnFee);
    const size = Number(transaction.size);
    if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(size) || size < 0) {
      throw new Error(`Judecoin returned invalid transaction numbers for ${hash}`);
    }
    details.set(hash, {
      fee,
      inputs: parsed.vin.length,
      outputs: parsed.vout.length,
      size,
      txType: classifyTransaction(parsed, transaction),
    });
  }
  const missing = [...requested].filter((hash) => !details.has(hash));
  if (missing.length) {
    throw new Error(`Judecoin omitted ${missing.length} requested transaction detail(s)`);
  }
  return details;
}

function requireSynchronizedPoolQuorum(count: number) {
  if (!Number.isInteger(count) || count < 2) {
    throw new Error("At least two synchronized Judecoin transaction pools are required");
  }
}

type RpcHeader = {
  block_size: number;
  difficulty: number;
  hash: string;
  height: number;
  major_version: number;
  miner_tx_hash?: string;
  num_txes: number;
  reward: number;
  timestamp: number;
  tx_hashes?: string[];
};

type RpcServiceNode = {
  active: boolean;
  funded: boolean;
  last_reward_block_height: number;
  last_uptime_proof: number;
  registration_height: number;
  requested_unlock_height: number;
  service_node_pubkey: string;
  service_node_version: number[];
  staking_requirement: number;
  total_contributed: number;
  contributors?: Array<{ address: string; amount: number; reserved: number }>;
  portions_for_operator?: number;
  decommission_count?: number;
  earned_downtime_blocks?: number;
};

function serviceNodeTotalReserved(node: RpcServiceNode) {
  return (node.contributors || []).reduce(
    (sum, contributor) => sum + Math.max(0, Number(contributor.reserved || 0)),
    0,
  );
}

function mapAwaitingServiceNodes(states: RpcServiceNode[]) {
  return states
    .filter((node) => !node.funded)
    .sort((a, b) => {
      const aRequired = Math.max(0, Number(a.staking_requirement || 0) - Number(a.total_contributed || 0));
      const bRequired = Math.max(0, Number(b.staking_requirement || 0) - Number(b.total_contributed || 0));
      return aRequired - bRequired
        || Number(b.registration_height || 0) - Number(a.registration_height || 0)
        || a.service_node_pubkey.localeCompare(b.service_node_pubkey);
    })
    .map((node) => {
      const requirement = Number(node.staking_requirement || 0);
      const contributed = Number(node.total_contributed || 0);
      const totalReserved = serviceNodeTotalReserved(node);
      return {
        publicKey: node.service_node_pubkey,
        contributors: node.contributors?.length || 0,
        maxContributors: 9,
        operatorFee: Number.isFinite(Number(node.portions_for_operator))
          ? Math.round((Number(node.portions_for_operator) / 1.8446744073709552e19) * 10_000) / 100
          : null,
        contributed,
        requirement,
        totalReserved,
        contributionRequired: Math.max(0, requirement - contributed),
        contributionOpen: Math.max(0, requirement - totalReserved),
        reservedRemaining: Math.max(0, totalReserved - contributed),
        registeredAt: Number(node.registration_height || 0),
        lastRewardAt: Number(node.last_reward_block_height || 0),
        unlockAt: Number(node.requested_unlock_height || 0),
      };
    });
}

async function rpcFetchNode(node: string, path: string, init?: RequestInit, timeoutOverrideMs?: number): Promise<{ node: string; data: any }> {
  const controller = new AbortController();
  const body = typeof init?.body === "string" ? init.body : "";
  
  
  
  const timeoutMs = timeoutOverrideMs
    ?? (path === "/json_rpc" && body.includes('"method":"get_service_nodes"') ? 35_000 : 15_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${node}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(init?.headers || {}) },
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    return { node, data: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

let preferredRpcNode: string | null = null;

async function rpcFetch(path: string, init?: RequestInit): Promise<{ node: string; data: any }> {
  let lastError: unknown;
  const nodes = preferredRpcNode
    ? [preferredRpcNode, ...JUDECOIN_RPC_NODES.filter((node) => node !== preferredRpcNode)]
    : [...JUDECOIN_RPC_NODES];
  for (const node of nodes) {
    try {
      const result = await rpcFetchNode(node, path, init);
      preferredRpcNode = node;
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No synchronized Judecoin data source is reachable");
}

async function jsonRpc(method: string, params: Record<string, unknown> = {}) {
  return rpcFetch("/json_rpc", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "explorer-read-only", method, params }),
  });
}

type RpcResult = Awaited<ReturnType<typeof rpcFetch>>;
type RpcCacheEntry = { value?: RpcResult; expiresAt: number; pending?: Promise<RpcResult> };
const rpcResponseCache = new Map<string, RpcCacheEntry>();


const RPC_CACHE_TTL_MS = 3_000;

async function cachedRpcResult(key: string, load: () => Promise<RpcResult>) {
  const now = Date.now();
  for (const [cachedKey, entry] of rpcResponseCache) {
    if (!entry.pending && entry.expiresAt <= now) rpcResponseCache.delete(cachedKey);
  }
  const cached = rpcResponseCache.get(key);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.pending) return cached.pending;
  while (rpcResponseCache.size >= RPC_CACHE_MAX_ENTRIES) {
    const oldestKey = rpcResponseCache.keys().next().value as string | undefined;
    if (oldestKey == null) break;
    rpcResponseCache.delete(oldestKey);
  }
  const pending: Promise<RpcResult> = load().then((value) => {
    if (rpcResponseCache.get(key)?.pending !== pending) return value;
    while (rpcResponseCache.size >= RPC_CACHE_MAX_ENTRIES && !rpcResponseCache.has(key)) {
      const oldestKey = rpcResponseCache.keys().next().value as string | undefined;
      if (oldestKey == null) break;
      rpcResponseCache.delete(oldestKey);
    }
    rpcResponseCache.set(key, { value, expiresAt: Date.now() + RPC_CACHE_TTL_MS });
    return value;
  }).catch((error) => {
    if (rpcResponseCache.get(key)?.pending === pending) rpcResponseCache.delete(key);
    throw error;
  });
  rpcResponseCache.set(key, { expiresAt: 0, pending });
  return pending;
}

function requestCacheKey(scope: string, path: string, init?: RequestInit) {
  return `${scope}:${path}:${String(init?.method || "GET")}:${String(init?.body || "")}`;
}

function cachedRpcFetch(path: string, init?: RequestInit) {
  return cachedRpcResult(requestCacheKey("any", path, init), () => rpcFetch(path, init));
}

function cachedRpcFetchNode(node: string, path: string, init?: RequestInit) {
  return cachedRpcResult(requestCacheKey(node, path, init), () => rpcFetchNode(node, path, init));
}

function cachedJsonRpc(method: string, params: Record<string, unknown> = {}) {
  const init = {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "explorer-read-only", method, params }),
  };
  return cachedRpcFetch("/json_rpc", init);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function noStoreJson(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("cache-control", "no-store");
  return response;
}

const deregistrationTrackers = new Map<string, ReturnType<typeof createDeregistrationTracker>>();

function deregistrationTracker(origin: string) {
  const existing = deregistrationTrackers.get(origin);
  if (existing) return existing;
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  const cacheKey = new Request(`${origin}/_internal/stake-index-v2`);
  const tracker = createDeregistrationTracker(serviceNodeStakeIndex, async () => {
    let info: RpcResult | undefined;
    let blacklist: unknown;
    const nodes = preferredRpcNode
      ? [preferredRpcNode, ...JUDECOIN_RPC_NODES.filter((node) => node !== preferredRpcNode)]
      : [...JUDECOIN_RPC_NODES];
    for (const node of nodes) {
      try {
        const candidate = await rpcFetchNode(node, "/get_info");
        if (candidate.data?.status !== "OK" || !Number.isInteger(candidate.data.height)
          || candidate.data.height - 1 < serviceNodeStakeIndex.scannedThrough) continue;
        const response = await rpcFetchNode(node, "/json_rpc", {
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
        preferredRpcNode = node;
        break;
      } catch {
        continue;
      }
    }
    if (!info) throw new Error("Deregistration data unavailable");
    const sourceNode = info.node;
    const call = async (method: string, params = {}) => {
      const response = await rpcFetchNode(sourceNode, "/json_rpc", {
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
        const response = await rpcFetchNode(sourceNode, "/get_transactions", {
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

async function serviceNodeStatesRequest(requestedTip?: number) {
  const params = {
    fields: {
      service_node_pubkey: true,
      active: true,
      funded: true,
      staking_requirement: true,
      total_contributed: true,
      registration_height: true,
      last_reward_block_height: true,
      last_uptime_proof: true,
      service_node_version: true,
      requested_unlock_height: true,
      contributors: true,
      portions_for_operator: true,
      decommission_count: true,
      earned_downtime_blocks: true,
    },
  };
  const init = {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "explorer-read-only", method: "get_service_nodes", params }),
  };

  
  
  
  
  const cacheKey = "service-nodes:paired-v3";
  const load = async () => {
    const result = await Promise.any(JUDECOIN_RPC_NODES.map(async (node) => {
      const [infoResponse, serviceNodesResponse] = await Promise.all([
        rpcFetchNode(node, "/get_info", undefined, 35_000),
        rpcFetchNode(node, "/json_rpc", init),
      ]);
      const info = infoResponse.data;
      const serviceNodesResult = serviceNodesResponse.data?.result;
      const topHeight = Number(info?.height) - 1;
      if (info?.status !== "OK" || info?.mainnet !== true || info?.nettype !== "mainnet"
        || !Number.isInteger(info?.height) || topHeight < 0
        || serviceNodesResult?.status !== "OK"
        || !Array.isArray(serviceNodesResult?.service_node_states)
        || (Number.isInteger(requestedTip) && Number(requestedTip) >= 0 && topHeight < Number(requestedTip))) {
        throw new Error("Invalid Judecoin service-node response");
      }
      return {
        node,
        data: {
          info,
          serviceNodeStates: serviceNodesResult.service_node_states,
        },
      };
    }));
    preferredRpcNode = result.node;
    return result;
  };

  let result = await cachedRpcResult(cacheKey, load);
  const cachedTopHeight = Number(result.data?.info?.height) - 1;
  if (Number.isInteger(requestedTip) && Number(requestedTip) >= 0 && cachedTopHeight < Number(requestedTip)) {
    
    
    rpcResponseCache.delete(cacheKey);
    result = await cachedRpcResult(cacheKey, load);
  }
  return result;
}

function buildServiceNodesSnapshot(currentServiceNodeStates: RpcServiceNode[], topHeight: number) {
  return {
    total: currentServiceNodeStates.length,
    active: currentServiceNodeStates.filter((node) => node.active).length,
    funded: currentServiceNodeStates.filter((node) => node.funded).length,
    exiting: currentServiceNodeStates.filter((node) => node.requested_unlock_height > topHeight).length,
    decommissioned: currentServiceNodeStates.filter(
      (node) => !node.active && node.funded && node.requested_unlock_height === 0,
    ).length,
    stakingRequirement: currentServiceNodeStates[0]?.staking_requirement || 0,
    totalContributed: currentServiceNodeStates.reduce((sum, node) => sum + Number(node.total_contributed || 0), 0),
    page: 0,
    pageSize: currentServiceNodeStates.length,
    awaitingNodes: mapAwaitingServiceNodes(currentServiceNodeStates),
    nodes: [...currentServiceNodeStates]
      .sort((a, b) => {
        return Number(b.last_reward_block_height || 0) - Number(a.last_reward_block_height || 0)
          || Number(b.registration_height || 0) - Number(a.registration_height || 0)
          || a.service_node_pubkey.localeCompare(b.service_node_pubkey);
      })
      .map((node) => ({
        publicKey: node.service_node_pubkey,
        active: node.active,
        funded: node.funded,
        contributed: node.total_contributed,
        requirement: node.staking_requirement,
        registeredAt: node.registration_height,
        lastRewardAt: node.last_reward_block_height,
        lastUptimeProof: node.last_uptime_proof,
        version: node.service_node_version.join("."),
        unlocking: node.requested_unlock_height > topHeight,
        unlockAt: Number(node.requested_unlock_height || 0),
        contributors: node.contributors?.length || 0,
        maxContributors: 9,
        operatorFee: Number.isFinite(Number(node.portions_for_operator))
          ? Math.round((Number(node.portions_for_operator) / 1.8446744073709552e19) * 10_000) / 100
          : null,
      })),
    unlockingNodes: currentServiceNodeStates
      .filter((node) => node.requested_unlock_height > topHeight)
      .sort((a, b) => a.requested_unlock_height - b.requested_unlock_height)
      .map((node) => ({
        publicKey: node.service_node_pubkey,
        contributed: Number(node.total_contributed || 0),
        registeredAt: Number(node.registration_height || 0),
        lastRewardAt: Number(node.last_reward_block_height || 0),
        unlockAt: Number(node.requested_unlock_height || 0),
      })),
    decommissionedNodes: currentServiceNodeStates
      .filter((node) => !node.active && node.funded && node.requested_unlock_height === 0)
      .sort((a, b) => b.last_uptime_proof - a.last_uptime_proof)
      .map((node) => ({
        publicKey: node.service_node_pubkey,
        contributors: node.contributors?.length || 0,
        maxContributors: 9,
        operatorFee: Number.isFinite(Number(node.portions_for_operator))
          ? Math.round((Number(node.portions_for_operator) / 1.8446744073709552e19) * 10_000) / 100
          : null,
        lastUptimeProof: Number(node.last_uptime_proof || 0),
        decommissionCount: Number(node.decommission_count || 0),
        downtimeCredit: Number(node.earned_downtime_blocks || 0),
      })),
  };
}

async function serviceNodesLiveSnapshot(requestedTip?: number) {
  const serviceNodesResponse = await serviceNodeStatesRequest(requestedTip);
  const info = serviceNodesResponse.data?.info;
  const serviceNodeStates = serviceNodesResponse.data?.serviceNodeStates;
  if (info?.status !== "OK" || info?.mainnet !== true || info?.nettype !== "mainnet"
    || !Number.isInteger(info.height)) throw new Error("Invalid Judecoin node response");
  if (!Array.isArray(serviceNodeStates)) {
    throw new Error("Invalid Judecoin service-node response");
  }
  const topHeight = Math.max(0, info.height - 1);
  if (Number.isInteger(requestedTip) && Number(requestedTip) >= 0 && topHeight < Number(requestedTip)) {
    throw new Error("Judecoin Service Node snapshot has not reached the requested tip");
  }
  const currentServiceNodeStates = (serviceNodeStates as RpcServiceNode[]).filter(
    (node) => node.requested_unlock_height === 0 || node.requested_unlock_height > topHeight,
  );
  return {
    live: true,
    fetchedAt: new Date().toISOString(),
    height: topHeight,
    serviceNodes: buildServiceNodesSnapshot(currentServiceNodeStates, topHeight),
  };
}

function verifiedTestingQuorumRecords(quorumResponse: RpcResult, pageSize: number) {
  const result = quorumResponse.data?.result;
  if (result?.status !== "OK" || result.untrusted !== false || !Array.isArray(result.quorums)) {
    throw new Error("Invalid Judecoin testing-quorum response");
  }
  const records = result.quorums.map((entry: any) => {
    if (!Number.isInteger(entry?.height)
      || !Array.isArray(entry?.quorum?.validators)
      || !Array.isArray(entry?.quorum?.workers)) {
      throw new Error("Incomplete Judecoin testing-quorum record");
    }
    return {
      height: Number(entry.height),
      validators: entry.quorum.validators.map(String),
      workers: entry.quorum.workers.map(String),
    };
  })
    .filter((entry: { height: number }) => entry.height >= 0)
    .sort((a: { height: number }, b: { height: number }) => b.height - a.height)
    .slice(0, pageSize);
  if (!records.length) throw new Error("Judecoin returned no testing-quorum records");
  return { result, records };
}

async function verifiedTestingQuorumRequest(
  params: Record<string, unknown>,
  pageSize: number,
  expectedEndHeight?: number,
) {
  const init = {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "explorer-read-only", method: "get_quorum_state", params }),
  };
  const verified = await Promise.any(JUDECOIN_RPC_NODES.map(async (node) => {
    const response = await cachedRpcFetchNode(node, "/json_rpc", init);
    const parsed = verifiedTestingQuorumRecords(response, pageSize);
    if (expectedEndHeight != null) {
      const expectedStartHeight = Number(params.start_height);
      const expectedCount = expectedEndHeight - expectedStartHeight + 1;
      const isCompleteRange = Number.isSafeInteger(expectedStartHeight)
        && parsed.records.length === expectedCount
        && parsed.records.every((record: { height: number }, index: number) => (
          record.height === expectedEndHeight - index
        ));
      if (!isCompleteRange) {
        throw new Error("Judecoin testing-quorum data has not reached the complete requested range");
      }
    }
    return { node, ...parsed };
  }));
  preferredRpcNode = verified.node;
  return verified;
}

async function quorumPageSnapshot(topHeight: number, quorumPage: number, pageSize = EXPLORER_PAGE_SIZE) {
  if (quorumPage * pageSize > topHeight) throw new RangeError("Quorum page is beyond the requested chain tip");
  const quorumEndHeight = Math.max(0, topHeight - quorumPage * pageSize);
  const { result, records } = await verifiedTestingQuorumRequest({
    quorum_type: 0,
    start_height: Math.max(0, quorumEndHeight - (pageSize - 1)),
    end_height: quorumEndHeight,
  }, pageSize, quorumEndHeight);
  const protocolHasOlder = topHeight - (quorumPage + 1) * pageSize >= 0;
  return {
    live: true,
    fetchedAt: new Date().toISOString(),
    height: topHeight,
    source: "Judecoin mainnet quorum data",
    type: "Service Node testing",
    quorumType: 0,
    trusted: result.untrusted === false,
    page: quorumPage,
    pageSize,
    hasOlder: quorumPage < MAX_QUORUM_PAGE && protocolHasOlder,
    truncated: quorumPage >= MAX_QUORUM_PAGE && protocolHasOlder,
    records,
    unavailable: ["Checkpoint", "Blink", "Pulse"],
  };
}

async function latestQuorumSnapshot(pageSize = EXPLORER_PAGE_SIZE) {
  
  
  
  const { result, records } = await verifiedTestingQuorumRequest({}, 1);
  const topHeight = records[0].height;
  return {
    live: true,
    fetchedAt: new Date().toISOString(),
    height: topHeight,
    source: "Judecoin mainnet quorum data",
    type: "Service Node testing",
    quorumType: 0,
    trusted: result.untrusted === false,
    page: 0,
    pageSize,
    hasOlder: topHeight - pageSize >= 0,
    truncated: false,
    records,
    unavailable: ["Checkpoint", "Blink", "Pulse"],
  };
}

async function transactionPoolSnapshot() {
  
  
  
  
  const poolResults = await Promise.allSettled(
    JUDECOIN_RPC_NODES.map(async (node) => {
      const [nodeInfo, pool] = await Promise.all([
        cachedRpcFetchNode(node, "/get_info"),
        cachedRpcFetchNode(node, "/get_transaction_pool"),
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
  const observations = new Map<string, { transaction: any; nodes: string[] }>();
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

  const poolDetails = new Map<string, any>();
  const validationResults = await Promise.allSettled(synchronizedPools.map(async (candidate) => {
    const hashes = candidate.transactions
      .map((transaction: any) => String(transaction.id_hash || "").toLowerCase())
      .filter((hash: string) => /^[a-f0-9]{64}$/.test(hash));
    if (!hashes.length) return [];
    const response = await cachedRpcFetchNode(candidate.node, "/get_transactions", {
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
    .filter((transaction: any) => /^[a-f0-9]{64}$/.test(String(transaction.id_hash || "")))
    .sort((a: any, b: any) => Number(b.receive_time || b.last_relayed_time || 0) - Number(a.receive_time || a.last_relayed_time || 0))
    .slice(0, EXPLORER_PAGE_SIZE)
    .map((transaction: any) => {
      const parsed = JSON.parse(transaction.tx_json || "{}");
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
    totalBytes: rawPool.reduce((sum: number, transaction: any) => (
      sum + Number(transaction.blob_size || transaction.weight || 0)
    ), 0),
    transactions,
  };
}

async function networkPreviewSnapshot() {
  const [infoResponse, headerResponse] = await Promise.all([
    cachedRpcFetch("/get_info"),
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

async function chainSnapshot(
  blockPage = 0,
  transactionPage = 0,
  quorumPage = 0,
  blockPageSize = EXPLORER_PAGE_SIZE,
  transactionPageSize = EXPLORER_PAGE_SIZE,
  quorumPageSize = EXPLORER_PAGE_SIZE,
) {
  
  
  const emissionSnapshotPromise = cachedRpcFetchNode(JUDECOIN_EMISSION_API, "").catch(() => null);
  const infoResponse = await cachedRpcFetch("/get_info");
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
    return JSON.parse(response.data?.result?.json || "{}");
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
  const transactionDetailsPromise = requestedTxHashes.length ? cachedRpcFetch("/get_transactions", {
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
      const minerInputs = Array.isArray(parsed.miner_tx?.vin) && parsed.miner_tx.vin.some((input: any) => input?.gen) ? 0 : (parsed.miner_tx?.vin?.length || 0);
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

async function createChainResponse(url: URL) {
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

function storedChainResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=0, s-maxage=${CHAIN_CACHE_TTL_SECONDS}`);
  headers.set(CHAIN_CACHE_CREATED_HEADER, String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function noStoreResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}



function chainCacheKey(request: Request, url: URL) {
  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  for (const name of ["blockPage", "transactionPage", "quorumPage"]) {
    const value = Math.min(10000, Math.max(0, Number.parseInt(url.searchParams.get(name) || "0", 10) || 0));
    cacheUrl.searchParams.set(name, String(value));
  }
  for (const name of ["blockPageSize", "transactionPageSize", "quorumPageSize"]) {
    cacheUrl.searchParams.set(name, String(explorerPageSize(url.searchParams.get(name))));
  }
  return new Request(cacheUrl, { method: "GET" });
}

const pendingChainRefreshes = new WeakMap<EdgeCache, Map<string, Promise<Response>>>();

async function writeChainCache(cache: EdgeCache, cacheKey: Request, url: URL) {
  const response = await createChainResponse(url);
  if (!response.ok) return response;
  const stored = storedChainResponse(response);
  try {
    const [next, current] = await Promise.all([
      stored.clone().json() as Promise<{ network?: { height?: number } }>,
      cache.match(cacheKey),
    ]);
    if (current) {
      const previous = await current.clone().json() as { network?: { height?: number } };
      if (Number.isInteger(previous.network?.height)
        && Number(previous.network?.height) > Number(next.network?.height)) {
        return noStoreResponse(current);
      }
    }
    await cache.put(cacheKey, stored.clone());
  } catch {
    
  }
  return noStoreResponse(stored);
}

async function refreshChainCache(cache: EdgeCache, cacheKey: Request, url: URL) {
  let pendingForCache = pendingChainRefreshes.get(cache);
  if (!pendingForCache) {
    pendingForCache = new Map();
    pendingChainRefreshes.set(cache, pendingForCache);
  }
  const requestedTip = Number.parseInt(url.searchParams.get("tip") || "", 10);
  
  const pendingKey = `${cacheKey.url}|${Number.isInteger(requestedTip) && requestedTip >= 0 ? requestedTip : "any"}`;
  let pending = pendingForCache.get(pendingKey);
  if (!pending) {
    pending = writeChainCache(cache, cacheKey, url).finally(() => pendingForCache.delete(pendingKey));
    pendingForCache.set(pendingKey, pending);
  }
  return (await pending).clone();
}

async function cachedChainResponse(request: Request, url: URL, ctx: ExecutionContext) {
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache) return createChainResponse(url);

  const cacheKey = chainCacheKey(request, url);
  let cached: Response | undefined;
  try {
    cached = await cache.match(cacheKey);
  } catch {
    return createChainResponse(url);
  }

  if (cached) {
    const createdAt = Number(cached.headers.get(CHAIN_CACHE_CREATED_HEADER) || 0);
    const age = Math.max(0, Date.now() - createdAt);
    const requestedTip = Number.parseInt(url.searchParams.get("tip") || "", 10);
    let reachesMinimumHeight = true;
    if (Number.isInteger(requestedTip) && requestedTip >= 0) {
      const snapshot = await cached.clone().json().catch(() => null) as { network?: { height?: number } } | null;
      reachesMinimumHeight = Number.isInteger(snapshot?.network?.height)
        && Number(snapshot?.network?.height) >= requestedTip;
    }
    if (createdAt > 0 && age <= CHAIN_CACHE_FRESH_MS && reachesMinimumHeight) return noStoreResponse(cached);
    if (createdAt > 0 && age <= CHAIN_CACHE_STALE_MS && reachesMinimumHeight) {
      ctx.waitUntil(refreshChainCache(cache, cacheKey, url).then(() => undefined));
      return noStoreResponse(cached);
    }
  }
  const refreshed = await refreshChainCache(cache, cacheKey, url);
  return refreshed.ok || !cached ? refreshed : noStoreResponse(cached);
}

async function createServiceNodesLiveResponse(url: URL) {
  try {
    const requestedTip = Number.parseInt(url.searchParams.get("tip") || "", 10);
    return noStoreJson(await serviceNodesLiveSnapshot(requestedTip));
  } catch (error) {
    return noStoreJson({
      live: false,
      error: error instanceof Error ? error.message : "Service-node data unavailable",
    }, 503);
  }
}

async function createNetworkLiveResponse() {
  try {
    return noStoreJson(await networkPreviewSnapshot());
  } catch (error) {
    return noStoreJson({
      live: false,
      error: error instanceof Error ? error.message : "Network overview unavailable",
    }, 503);
  }
}

async function createTransactionPoolLiveResponse() {
  try {
    return noStoreJson(await transactionPoolSnapshot());
  } catch (error) {
    return noStoreJson({
      available: false,
      error: error instanceof Error ? error.message : "Transaction pool unavailable",
    }, 503);
  }
}

async function createQuorumLiveResponse(url: URL) {
  try {
    const quorumPage = requestedQuorumPage(url);
    const pageSize = explorerPageSize(url.searchParams.get("pageSize"));
    const requestedTip = requestedQuorumTip(url);
    const latestOnly = url.searchParams.get("latest") === "1"
      && quorumPage === 0
      && requestedTip == null;
    if (latestOnly) return noStoreJson(await latestQuorumSnapshot(pageSize));
    let topHeight = requestedTip;
    if (topHeight == null) {
      const infoResponse = await cachedRpcFetch("/get_info");
      if (infoResponse.data?.status !== "OK" || !Number.isInteger(infoResponse.data?.height)) {
        throw new Error("Invalid Judecoin node response");
      }
      topHeight = Math.max(0, Number(infoResponse.data.height) - 1);
    }
    return noStoreJson(await quorumPageSnapshot(topHeight, quorumPage, pageSize));
  } catch (error) {
    return noStoreJson({
      live: false,
      error: error instanceof Error ? error.message : "Quorum data unavailable",
    }, error instanceof RangeError ? 400 : 503);
  }
}

type LiveCachePolicy = {
  path: string;
  freshMs: number;
  staleMs: number;
  ttlSeconds: number;
  createdHeader: string;
  minimumHeight?: number;
};

function storedLiveResponse(response: Response, policy: LiveCachePolicy) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=0, s-maxage=${policy.ttlSeconds}`);
  headers.set(policy.createdHeader, String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function refreshLiveCache(cache: EdgeCache, cacheKey: Request, policy: LiveCachePolicy, create: () => Promise<Response>) {
  const response = await create();
  if (!response.ok) return response;
  const stored = storedLiveResponse(response, policy);
  try {
    const [nextSnapshot, current] = await Promise.all([
      stored.clone().json().catch(() => null) as Promise<{ height?: number } | null>,
      cache.match(cacheKey).catch(() => undefined),
    ]);
    if (current && Number.isInteger(nextSnapshot?.height)) {
      const currentSnapshot = await current.clone().json().catch(() => null) as { height?: number } | null;
      if (Number.isInteger(currentSnapshot?.height)
        && Number(currentSnapshot?.height) > Number(nextSnapshot?.height)) {
        return noStoreResponse(current);
      }
    }
    await cache.put(cacheKey, stored.clone());
  } catch {
    
  }
  return noStoreResponse(stored);
}

async function cachedLiveResponse(url: URL, policy: LiveCachePolicy, create: () => Promise<Response>, ctx: ExecutionContext) {
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache) return create();
  const cacheKey = new Request(`${url.origin}${policy.path}`, { method: "GET" });
  let cached: Response | undefined;
  try {
    cached = await cache.match(cacheKey);
  } catch {
    return create();
  }
  if (cached) {
    const createdAt = Number(cached.headers.get(policy.createdHeader) || 0);
    const age = Math.max(0, Date.now() - createdAt);
    let reachesMinimumHeight = true;
    if (Number.isInteger(policy.minimumHeight) && Number(policy.minimumHeight) >= 0) {
      try {
        const snapshot = await cached.clone().json() as { height?: number };
        reachesMinimumHeight = Number.isInteger(snapshot.height)
          && Number(snapshot.height) >= Number(policy.minimumHeight);
      } catch {
        reachesMinimumHeight = false;
      }
    }
    if (createdAt > 0 && age <= policy.freshMs && reachesMinimumHeight) return noStoreResponse(cached);
    if (createdAt > 0 && age <= policy.staleMs && reachesMinimumHeight) {
      ctx.waitUntil(refreshLiveCache(cache, cacheKey, policy, create).then(() => undefined));
      return noStoreResponse(cached);
    }
  }
  const refreshed = await refreshLiveCache(cache, cacheKey, policy, create);
  return refreshed.ok || !cached ? refreshed : noStoreResponse(cached);
}

async function cachedServiceNodesLiveResponse(url: URL, ctx: ExecutionContext) {
  
  
  
  
  const requestedTip = Number.parseInt(url.searchParams.get("tip") || "", 10);
  return cachedLiveResponse(url, {
    path: "/api/service-nodes-live",
    freshMs: SERVICE_NODES_CACHE_FRESH_MS,
    staleMs: SERVICE_NODES_CACHE_STALE_MS,
    ttlSeconds: SERVICE_NODES_CACHE_TTL_SECONDS,
    createdHeader: SERVICE_NODES_CACHE_CREATED_HEADER,
    minimumHeight: Number.isInteger(requestedTip) && requestedTip >= 0 ? requestedTip : undefined,
  }, () => createServiceNodesLiveResponse(new URL(url.toString())), ctx);
}

async function cachedNetworkLiveResponse(url: URL, ctx: ExecutionContext) {
  return cachedLiveResponse(url, {
    path: "/api/network",
    freshMs: NETWORK_CACHE_FRESH_MS,
    staleMs: NETWORK_CACHE_STALE_MS,
    ttlSeconds: NETWORK_CACHE_TTL_SECONDS,
    createdHeader: NETWORK_CACHE_CREATED_HEADER,
  }, createNetworkLiveResponse, ctx);
}

async function cachedTransactionPoolLiveResponse(url: URL, ctx: ExecutionContext) {
  return cachedLiveResponse(url, {
    path: "/api/transaction-pool",
    freshMs: TRANSACTION_POOL_CACHE_FRESH_MS,
    staleMs: TRANSACTION_POOL_CACHE_STALE_MS,
    ttlSeconds: TRANSACTION_POOL_CACHE_TTL_SECONDS,
    createdHeader: TRANSACTION_POOL_CACHE_CREATED_HEADER,
  }, createTransactionPoolLiveResponse, ctx);
}

async function cachedQuorumLiveResponse(url: URL, ctx: ExecutionContext) {
  let quorumPage: number;
  let requestedTip: number | undefined;
  try {
    quorumPage = requestedQuorumPage(url);
    requestedTip = requestedQuorumTip(url);
  } catch (error) {
    return noStoreJson({ live: false, error: error instanceof Error ? error.message : "Invalid quorum request" }, 400);
  }
  const pageSize = explorerPageSize(url.searchParams.get("pageSize"));
  if (requestedTip != null && quorumPage * pageSize > requestedTip) {
    return noStoreJson({ live: false, error: "Quorum page is beyond the requested chain tip" }, 400);
  }
  const latestOnly = url.searchParams.get("latest") === "1"
    && quorumPage === 0
    && requestedTip == null;
  return cachedLiveResponse(url, {
    path: `/api/quorums?page=${quorumPage}&pageSize=${pageSize}${latestOnly ? "&latest=1" : requestedTip == null ? "" : `&tip=${requestedTip}`}`,
    freshMs: QUORUM_CACHE_FRESH_MS,
    staleMs: QUORUM_CACHE_STALE_MS,
    ttlSeconds: QUORUM_CACHE_TTL_SECONDS,
    createdHeader: QUORUM_CACHE_CREATED_HEADER,
    minimumHeight: !latestOnly ? requestedTip : undefined,
  }, () => createQuorumLiveResponse(new URL(url.toString())), ctx);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/deregistered-service-nodes" && request.method === "GET") {
      const data = await deregistrationTracker(url.origin).read();
      return new Response(JSON.stringify(data), {
        status: data.status === "unavailable" ? 503 : 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (url.pathname === "/api/block" && request.method === "GET") {
      const id = url.searchParams.get("id") || "";
      const isHeight = /^\d{1,10}$/.test(id);
      const isHash = /^[a-f0-9]{64}$/i.test(id);
      if (!isHeight && !isHash) return json({ error: "Enter a valid block height or 64-character block hash" }, 400);
      try {
        const response = await jsonRpc("get_block", isHeight ? { height: Number(id) } : { hash: id.toLowerCase() });
        const header = response.data?.result?.block_header as RpcHeader | undefined;
        if (!header) return json({ error: "Block not found" }, 404);
        const blockResult = response.data?.result || {};
        const parsedBlock = JSON.parse(blockResult.json || "{}");
        const minerHash = String(blockResult.miner_tx_hash || header.miner_tx_hash || "");
        const minerResponse = minerHash ? await rpcFetch("/get_transactions", {
          method: "POST",
          body: JSON.stringify({ txs_hashes: [minerHash], decode_as_json: true }),
        }) : { data: { txs: [] } };
        const minerRecord = minerResponse.data?.txs?.[0] || {};
        const minerTransaction = JSON.parse(minerRecord.as_json || JSON.stringify(parsedBlock.miner_tx || {}));
        const extraBytes = Array.isArray(minerTransaction.extra) ? minerTransaction.extra : [];
        const publicKeyOffset = extraBytes.findIndex((value: number, index: number) => value === 1 && extraBytes.length >= index + 33);
        const txPublicKey = publicKeyOffset >= 0
          ? extraBytes.slice(publicKeyOffset + 1, publicKeyOffset + 33).map((value: number) => value.toString(16).padStart(2, "0")).join("")
          : "";
        const outputs = (minerTransaction.vout || []).map((output: any, index: number) => ({
          index,
          amount: Number(output.amount || 0),
          key: String(output.target?.key || ""),
          globalIndex: Number(minerRecord.output_indices?.[index] ?? -1),
          unlockHeight: Number(minerTransaction.output_unlock_times?.[index] ?? minerTransaction.unlock_time ?? 0),
        }));
        return json({
          type: "block",
          height: header.height,
          hash: header.hash,
          timestamp: header.timestamp,
          transactions: header.num_txes,
          size: header.block_size,
          difficulty: header.difficulty,
          majorVersion: header.major_version,
          minorVersion: Number((header as any).minor_version || 0),
          orphan: Boolean((header as any).orphan_status),
          confirmations: Number((header as any).depth || 0) + 1,
          reward: Number((header as any).reward || 0),
          minerTransaction: {
            hash: minerHash,
            publicKey: txPublicKey,
            version: Number(minerTransaction.version || 0),
            type: Number(minerTransaction.type || 0),
            unlockHeight: Number(minerTransaction.unlock_time || 0),
            size: Number(minerRecord.size || 0),
            fee: Number(minerTransaction.rct_signatures?.txnFee || 0),
            ringCtType: Number(minerTransaction.rct_signatures?.type || 0),
            serviceNodeWinner: String((header as any).service_node_winner || ""),
            extra: extraBytes.map((value: number) => value.toString(16).padStart(2, "0")).join(""),
            outputs,
            raw: minerTransaction,
          },
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Block lookup failed" }, 502);
      }
    }

    if (url.pathname === "/api/transaction" && request.method === "GET") {
      const hash = (url.searchParams.get("hash") || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) return json({ error: "Enter a valid 64-character transaction hash" }, 400);
      try {
        const response = await rpcFetch("/get_transactions", {
          method: "POST",
          body: JSON.stringify({ txs_hashes: [hash], decode_as_json: true, tx_extra: true }),
        });
        let tx = response.data?.txs?.[0];
        if (!tx) {
          
          
          
          
          const lookupNodes = [...new Set([
            response.node,
            ...(preferredRpcNode ? [preferredRpcNode] : []),
            ...JUDECOIN_RPC_NODES,
          ])];
          let poolTransaction: any = null;
          for (const node of lookupNodes) {
            try {
              const poolResponse = await cachedRpcFetchNode(node, "/get_transaction_pool");
              poolTransaction = (Array.isArray(poolResponse.data?.transactions) ? poolResponse.data.transactions : [])
                .find((transaction: any) => String(transaction.id_hash || "").toLowerCase() === hash);
              if (poolTransaction) break;
            } catch {
              
            }
          }
          if (!poolTransaction) return json({ error: "Transaction not found" }, 404);
          tx = {
            tx_hash: hash,
            as_json: String(poolTransaction.tx_json || "{}"),
            block_height: 0,
            block_timestamp: Number(poolTransaction.receive_time || poolTransaction.last_relayed_time || 0),
            size: Number(poolTransaction.blob_size || poolTransaction.weight || 0),
            fee: Number(poolTransaction.fee || 0),
            in_pool: true,
            blink: Boolean(poolTransaction.blink),
            double_spend_seen: Boolean(poolTransaction.double_spend_seen),
            output_indices: [],
            extra: poolTransaction.extra,
          };
        }
        const parsed = JSON.parse(tx.as_json || tx.tx_json || "{}");
        const extraBytes = Array.isArray(parsed.extra) ? parsed.extra : [];
        const publicKeyOffset = extraBytes.findIndex((value: number, index: number) => value === 1 && extraBytes.length >= index + 33);
        const txPublicKey = publicKeyOffset >= 0 ? extraBytes.slice(publicKeyOffset + 1, publicKeyOffset + 33).map((value: number) => value.toString(16).padStart(2, "0")).join("") : "";
        const paymentIdOffset = extraBytes.findIndex((value: number, index: number) => value === 2 && extraBytes[index + 1] === 9 && extraBytes[index + 2] === 1 && extraBytes.length >= index + 11);
        const paymentId = paymentIdOffset >= 0 ? extraBytes.slice(paymentIdOffset + 3, paymentIdOffset + 11).map((value: number) => value.toString(16).padStart(2, "0")).join("") : "";
        const inputs = (parsed.vin || []).map((input: any, index: number) => {
          let absoluteOffset = 0;
          const keyOffsets = Array.isArray(input.key?.key_offsets)
            ? input.key.key_offsets.map((offset: unknown) => {
                absoluteOffset += Number(offset || 0);
                return absoluteOffset;
              })
            : [];
          return {
            index,
            type: input.gen ? "coinbase" : input.key ? "key" : "special",
            keyImage: String(input.key?.k_image || ""),
            amount: Number(input.key?.amount || 0),
            ringSize: keyOffsets.length,
            keyOffsets,
            ringMembers: [] as Array<{ index: number; outputKey: string; transactionHash: string; blockHeight: number; unlocked: boolean }>,
          };
        });
        const requestedRingOutputs = inputs.flatMap((input: any) => input.keyOffsets.map((offset: number) => ({ amount: input.amount, index: offset })));
        
        
        const [infoResponse] = await Promise.all([
          rpcFetch("/get_info"),
          requestedRingOutputs.length ? rpcFetch("/get_outs", {
              method: "POST",
              body: JSON.stringify({ outputs: requestedRingOutputs, get_txid: true }),
            }).then((ringResponse) => {
            const ringOutputs = Array.isArray(ringResponse.data?.outs) ? ringResponse.data.outs : [];
            let cursor = 0;
            for (const input of inputs) {
              input.ringMembers = input.keyOffsets.map((offset: number) => {
                const member = ringOutputs[cursor++] || {};
                return {
                  index: offset,
                  outputKey: String(member.key || ""),
                  transactionHash: String(member.txid || ""),
                  blockHeight: Number(member.height || 0),
                  unlocked: Boolean(member.unlocked),
                };
              });
            }
          }).catch(() => {
            
            
          }) : null,
        ]);
        return json({
          type: "transaction",
          hash: tx.tx_hash || hash,
          blockHeight: tx.block_height,
          confirmations: tx.in_pool ? 0 : Math.max(0, Number(infoResponse.data?.height || 0) - Number(tx.block_height || 0) + 1),
          timestamp: tx.block_timestamp,
          size: tx.size,
          inPool: Boolean(tx.in_pool),
          blink: Boolean(tx.blink),
          doubleSpendSeen: Boolean(tx.double_spend_seen),
          version: Number(parsed.version || 0),
          transactionType: Number(parsed.type || 0),
          txType: classifyTransaction(parsed, tx),
          unlockTime: Number(parsed.unlock_time || 0),
          fee: Number(parsed.rct_signatures?.txnFee || tx.fee || 0),
          ringCtType: Number(parsed.rct_signatures?.type || 0),
          publicKey: txPublicKey,
          paymentId,
          extra: extraBytes.map((value: number) => value.toString(16).padStart(2, "0")).join(""),
          inputs,
          outputs: (parsed.vout || []).map((output: any, index: number) => ({ index, key: String(output.target?.key || ""), globalIndex: Number(tx.output_indices?.[index] ?? -1), unlockHeight: Number(parsed.output_unlock_times?.[index] ?? parsed.unlock_time ?? 0), confidential: Number(output.amount || 0) === 0 })),
          raw: parsed,
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Transaction lookup failed" }, 502);
      }
    }

    if (url.pathname === "/api/service-node" && request.method === "GET") {
      const key = (url.searchParams.get("key") || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(key)) return json({ error: "Enter a valid 64-character service-node public key" }, 400);
      try {
        const response = await jsonRpc("get_service_nodes", {
          service_node_pubkeys: [key],
          fields: {
            service_node_pubkey: true,
            active: true,
            funded: true,
            operator_address: true,
            contributors: true,
            public_ip: true,
            quorumnet_port: true,
            staking_requirement: true,
            total_contributed: true,
            registration_height: true,
            last_reward_block_height: true,
            last_uptime_proof: true,
            service_node_version: true,
            requested_unlock_height: true,
            decommission_count: true,
            swarm_id: true,
            last_decommission_height: true,
            last_ip_change_height: true,
            recommission_credit: true,
            registration_hf_version: true,
            storage_port: true,
            storage_lmq_port: true,
            pubkey_ed25519: true,
            pubkey_x25519: true,
          },
        });
        const node = response.data?.result?.service_node_states?.[0];
        if (!node) {
          const tracker = deregistrationTracker(url.origin);
          const current = await tracker.read();
          const historicalNode = tracker.find(key) || deregisteredHistory.nodes.find((entry) => entry.publicKey === key);
          if (!historicalNode && !current.live) return json({ error: "Service node records are synchronizing" }, 503);
          if (!historicalNode) return json({ error: "Service node not found" }, 404);
          return json({
            type: "service-node",
            historical: true,
            publicKey: historicalNode.publicKey,
            active: false,
            funded: false,
            registrationHeight: historicalNode.registeredAt,
            unlockHeight: historicalNode.unlockedAt,
            contributions: historicalNode.contributions,
          });
        }
        return json({
          type: "service-node",
          publicKey: node.service_node_pubkey,
          active: Boolean(node.active),
          funded: Boolean(node.funded),
          operatorAddress: node.operator_address || null,
          publicEndpoint: node.public_ip ? [node.public_ip, node.quorumnet_port].filter(Boolean).join(":") : null,
          stakingRequirement: Number(node.staking_requirement || 0),
          totalContributed: Number(node.total_contributed || 0),
          registrationHeight: Number(node.registration_height || 0),
          lastRewardHeight: Number(node.last_reward_block_height || 0),
          lastUptimeProof: Number(node.last_uptime_proof || 0),
          version: Array.isArray(node.service_node_version) && node.service_node_version.length ? node.service_node_version.join(".") : null,
          unlockHeight: Number(node.requested_unlock_height || 0),
          decommissionCount: Number(node.decommission_count || 0),
          swarmId: node.swarm_id == null ? null : Number.isSafeInteger(node.swarm_id) ? String(node.swarm_id) : `${String(node.swarm_id)} (numeric precision not guaranteed)`,
          lastDecommissionHeight: Number(node.last_decommission_height || 0),
          lastIpChangeHeight: Number(node.last_ip_change_height || 0),
          recommissionCredit: Number(node.recommission_credit || 0),
          registrationProtocol: Number(node.registration_hf_version || 0),
          storagePort: Number(node.storage_port || 0),
          storageLmqPort: Number(node.storage_lmq_port || 0),
          ed25519PublicKey: String(node.pubkey_ed25519 || ""),
          x25519PublicKey: String(node.pubkey_x25519 || ""),
          contributors: (node.contributors || []).map((contributor: any) => ({
            address: contributor.address,
            amount: Number(contributor.amount || 0),
            reserved: Number(contributor.reserved || 0),
          })),
          raw: node,
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Service-node lookup failed" }, 502);
      }
    }

    if (url.pathname === "/api/quorums" && request.method === "GET") {
      return cachedQuorumLiveResponse(url, ctx);
    }

    if (url.pathname === "/api/network" && request.method === "GET") {
      return cachedNetworkLiveResponse(url, ctx);
    }

    if (url.pathname === "/api/transaction-pool" && request.method === "GET") {
      return cachedTransactionPoolLiveResponse(url, ctx);
    }

    if (url.pathname === "/api/service-nodes-live" && request.method === "GET") {
      return cachedServiceNodesLiveResponse(url, ctx);
    }

    if (url.pathname === "/api/chain" && request.method === "GET") {
      return cachedChainResponse(request, url, ctx);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
