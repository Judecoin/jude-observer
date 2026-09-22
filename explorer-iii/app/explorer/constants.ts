

export const TX_TYPE_META: Record<string, { label: string; icon?: string }> = {
  transfer: { label: "Transfer", icon: "/tx-types/transfer.png" }, registration: { label: "Registration", icon: "/tx-types/registration.png" },
  contribution: { label: "Contribution", icon: "/tx-types/contribution.png" }, recommission: { label: "Recommission", icon: "/tx-types/recommission.png" },
  decommission: { label: "Decommission", icon: "/tx-types/decommission.png" }, deregistration: { label: "Deregistration", icon: "/tx-types/deregistration.png" },
  "ip-change": { label: "IP Change", icon: "/tx-types/ip-change.png" }, unlock: { label: "Unlock", icon: "/tx-types/unlock.png" },
  "block-reward": { label: "Block Reward", icon: "/tx-types/block-reward.png" },

  "state-change": { label: "Unclassified State Change" },
};

export const TX_TYPE_LEGEND = ["block-reward", "transfer", "registration", "contribution", "recommission", "decommission", "deregistration", "ip-change", "unlock"];

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 25, 50, 100] as const;

export const SNAPSHOT_CACHE_TTL_MS = 5_000;

export const NETWORK_REFRESH_DELAY_MS = 2_000;

export const TRANSACTION_POOL_REFRESH_DELAY_MS = 5_000;

export const QUORUM_REFRESH_DELAY_MS = 5_000;

export const QUORUM_CATCH_UP_RETRY_DELAY_MS = 2_000;

export const SERVICE_NODE_REFRESH_DELAY_MS = 15_000;

export const SERVICE_NODE_CATCH_UP_RETRY_DELAY_MS = 5_000;

export const SERVICE_NODE_REQUEST_TIMEOUT_MS = 120_000;

export const HIDDEN_TAB_REFRESH_DELAY_MS = 30_000;

export const SNAPSHOT_RETRY_DELAYS_MS = [0, 1_200, 3_000] as const;

export const CLIENT_SNAPSHOT_MAX_CHARS = 2_500_000;

export const CLIENT_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

export const CLIENT_SNAPSHOT_FUTURE_SKEW_MS = 60_000;

export const CLIENT_CHAIN_SNAPSHOT_KEY = "judecoin:verified-chain:v1";

export const CLIENT_NETWORK_SNAPSHOT_KEY = "judecoin:verified-network:v1";

export const CLIENT_SERVICE_NODES_SNAPSHOT_KEY = "judecoin:verified-service-nodes:v1";

export const CLIENT_QUORUM_SNAPSHOT_KEY = "judecoin:verified-quorums:v1";
