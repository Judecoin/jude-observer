

export const JUDECOIN_RPC_NODES = [
  "http://node1.judecoin.com:16061",
  "http://node.judecoin.info:16061",
  "http://67.230.167.187:16061",
] as const;

export const JUDECOIN_EMISSION_API = "https://www.judeblock.net/api/emission";

export const EXPLORER_PAGE_SIZE = 5;

export const EXPLORER_PAGE_SIZES = new Set([5, 10, 20, 25, 50, 100]);

export const MAX_QUORUM_PAGE = 10_000;

export const CHAIN_CACHE_FRESH_MS = 5_000;

export const CHAIN_CACHE_STALE_MS = 300_000;

export const CHAIN_CACHE_TTL_SECONDS = 600;

export const CHAIN_CACHE_CREATED_HEADER = "x-judecoin-snapshot-created-at";

export const SERVICE_NODES_CACHE_FRESH_MS = 5_000;

export const SERVICE_NODES_CACHE_STALE_MS = 300_000;

export const SERVICE_NODES_CACHE_TTL_SECONDS = 600;

export const SERVICE_NODES_CACHE_CREATED_HEADER = "x-judecoin-service-nodes-created-at";

export const NETWORK_CACHE_FRESH_MS = 3_000;

export const NETWORK_CACHE_STALE_MS = 15_000;

export const NETWORK_CACHE_TTL_SECONDS = 30;

export const NETWORK_CACHE_CREATED_HEADER = "x-judecoin-network-created-at";

export const TRANSACTION_POOL_CACHE_FRESH_MS = 5_000;

export const TRANSACTION_POOL_CACHE_STALE_MS = 15_000;

export const TRANSACTION_POOL_CACHE_TTL_SECONDS = 30;

export const TRANSACTION_POOL_CACHE_CREATED_HEADER = "x-judecoin-pool-created-at";

export const QUORUM_CACHE_FRESH_MS = 15_000;

export const QUORUM_CACHE_STALE_MS = 300_000;

export const QUORUM_CACHE_TTL_SECONDS = 600;

export const QUORUM_CACHE_CREATED_HEADER = "x-judecoin-quorum-created-at";

export const MAX_QUORUM_TIP = 100_000_000;

export const RPC_CACHE_MAX_ENTRIES = 200;

export const RPC_CACHE_TTL_MS = 3_000;
