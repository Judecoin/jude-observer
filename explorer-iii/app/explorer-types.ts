import type { ReactNode } from "react";

export type Block = {
  height: number;
  age: string;
  hash: string;
  txs: number;
  size: string;
  difficulty: string;
  fee?: number | null;
  reward?: number | null;
  inputs?: number | null;
  outputs?: number | null;
};

export type Transaction = {
  hash: string;
  age: string;
  block: number;
  size: string;
  confirmations: number;
  fee?: number;
  reward?: number;
  inputs?: number;
  outputs?: number;
  txType: string;
};

export type TransactionPoolSnapshot = {
  available: boolean;
  count: number;
  totalBytes: number;
  transactions: Array<{ hash: string; receivedAt: number; txType: string; fee: number; size: number; inputs: number; outputs: number }>;
};

export type AwaitingServiceNode = {
  publicKey: string;
  contributors: number;
  maxContributors: number;
  operatorFee: number | null;
  contributed: number;
  requirement: number;
  totalReserved: number;
  contributionRequired: number;
  contributionOpen: number;
  reservedRemaining: number;
  registeredAt: number;
  lastRewardAt: number;
  unlockAt: number;
};

export type UpgradeReadiness = {
  targetVersion: string;
  eligibleTotal: number;
  upgraded: number;
  pending: number;
  unknown: number;
  percentage: number | null;
  versions: Array<{ version: string; count: number }>;
  scope: "registered-service-nodes";
};

export type ForkObservation = {
  height: number;
  observedAt: string;
  source: string;
  readiness: UpgradeReadiness;
};

export type ForkArchiveSnapshot = {
  available: boolean;
  preFork: ForkObservation | null;
  exactClosingSnapshot: boolean;
};

export type ForkSnapshot = {
  activationHeight: number;
  targetProtocol: number | null;
  targetVersion: string;
  currentProtocol: number;
  phase: "scheduled" | "activated" | "unverified";
  blocksRemaining: number;
  blocksSinceActivation: number;
  estimatedActivationAt: string | null;
  observedAt: string;
  activationBlock: { height: number; hash: string; timestamp: number; protocol: number } | null;
};

export type ServiceNodesSnapshot = {
  upgradeReadiness?: UpgradeReadiness;
  forkArchive?: ForkArchiveSnapshot;
  total: number;
  active: number;
  funded: number;
  exiting: number;
  decommissioned: number;
  stakingRequirement: number;
  totalContributed: number;
  page: number;
  pageSize: number;
  decommissionedNodes: Array<{
    publicKey: string;
    contributors: number;
    maxContributors: number;
    operatorFee: number | null;
    lastUptimeProof: number;
    decommissionCount: number;
    downtimeCredit: number;
  }>;
  awaitingNodes?: AwaitingServiceNode[];
  nodes: Array<{
    publicKey: string;
    active: boolean;
    funded: boolean;
    contributed: number;
    requirement: number;
    registeredAt: number;
    lastRewardAt: number;
    lastUptimeProof: number;
    version: string;
    unlocking: boolean;
    unlockAt: number;
    contributors: number;
    maxContributors: number;
    operatorFee: number | null;
  }>;
  unlockingNodes: Array<{
    publicKey: string;
    contributed: number;
    registeredAt: number;
    lastRewardAt: number;
    unlockAt: number;
  }>;
};

export type ChainSnapshot = {
  live: boolean;
  pendingDetails?: boolean;
  headerOnly?: boolean;
  source: string;
  node: string;
  fetchedAt: string;
  network: {
    height: number;
    difficulty: number;
    targetSeconds: number;
    targetVerified?: boolean;
    hashrate: number;
    hardFork: number;
    protocol: string;
    fork?: ForkSnapshot;
    txPoolSize: number;
    blockSizeMedian: number;
    blockSizeLimit: number;
    coinbase: string | null;
    fees: string | null;
    minedSupply: number | null;
    supplyHeight: number | null;
    supplySource: string | null;
    latestBlockTimestamp: number;
    latestBlockAgeSeconds: number;
    synced: boolean;
  };
  blocks: Array<{ height: number; timestamp: number; hash: string; txs: number; size: number; difficulty: number; fee: number | null; reward: number | null; inputs: number | null; outputs: number | null }>;
  transactions: Array<{ hash: string; block: number; timestamp: number; size: number | null; confirmations: number; fee: number; reward: number; inputs: number; outputs: number; txType: string }>;
  transactionPool: TransactionPoolSnapshot;
  pagination: { blockPage: number; transactionPage: number; pageSize: number; transactionScanSize: number };
  serviceNodesHeight: number | null;
  serviceNodes: ServiceNodesSnapshot | null;
  quorums: {
    source: string;
    type: string;
    quorumType: number;
    trusted: boolean;
    page: number;
    pageSize: number;
    hasOlder: boolean;
    truncated: boolean;
    records: Array<{ height: number; validators: string[]; workers: string[] }>;
    unavailable: string[];
  };
  deregisteredServiceNodes?: {
    total: number;
    page: number;
    pageSize: number;
    indexedThrough: number;
    generatedAt: string;
    nodes: Array<{ publicKey: string; registeredAt: number; unlockedAt: number; contributions: number; unlockHeightVerified?: boolean }>;
  };
};

export type NetworkPreview = Pick<ChainSnapshot, "live" | "source" | "node" | "fetchedAt" | "network">;

export type LedgerPageSnapshot<Row> = {
  live: boolean;
  fetchedAt: string;
  source: string;
  node: string;
  height: number;
  anchorHeight: number;
  anchorHash: string;
  pageSize: number;
  rows: Row[];
  nextCursor: string | null;
  hasMore: boolean;
  scannedBlocks: number;
  scanLimited: boolean;
  totalRecords: number | null;
  position: number | null;
  pendingDetails?: boolean;
};

export type BlocksPageSnapshot = LedgerPageSnapshot<ChainSnapshot["blocks"][number]>;
export type TransactionsPageSnapshot = LedgerPageSnapshot<ChainSnapshot["transactions"][number]>;

export type ExplorerBootstrap = {
  renderedAt?: number;
  network: NetworkPreview | null;
  serviceNodes: ServiceNodesLiveSnapshot | null;
  quorums: QuorumSnapshot | null;
  transactionPool: TransactionPoolSnapshot | null;
  chain: ChainSnapshot | null;
  blocks: BlocksPageSnapshot | null;
  transactions: TransactionsPageSnapshot | null;
  ledgerRequest: { cursor: string | null; pageSize: number; page: number } | null;
};

export type QuorumSnapshot = ChainSnapshot["quorums"] & {
  live: boolean;
  fetchedAt: string;
  height: number;
};

export type ServiceNodesLiveSnapshot = {
  live: boolean;
  fetchedAt: string;
  height: number;
  serviceNodes: ServiceNodesSnapshot;
};

export type Detail = {
  title: string;
  kind?: "transaction" | "block" | "service-node";
  rows: Array<{ label: string; value: ReactNode }>;
  sections?: Array<{ kicker: string; title: string; rows: Array<{ label: string; value: ReactNode }> }>;
  inputs?: Array<{ index: number; type: string; keyImage: string; amount: number; ringSize: number; keyOffsets?: number[]; ringMembers?: Array<{ index: number; outputKey: string; transactionHash: string; blockHeight: number; unlocked: boolean }> }>;
  note?: string;
  fullPage?: boolean;
  outputs?: Array<{ index: number; amount?: number; key: string; globalIndex: number; unlockHeight: number; confidential?: boolean }>;
  outputTitle?: string;
  raw?: string;
};

export type DetailKind = NonNullable<Detail["kind"]>;
export type DetailPending = { title: string; kind: DetailKind; message: string };
