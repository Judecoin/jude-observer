import type { ReactNode } from "react";

export type Block = {
  height: number;
  age: string;
  hash: string;
  txs: number;
  size: string;
  difficulty: string;
  fee?: number;
  reward?: number;
  inputs?: number;
  outputs?: number;
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

export type ChainSnapshot = {
  live: boolean;
  source: string;
  node: string;
  fetchedAt: string;
  network: {
    height: number;
    difficulty: number;
    targetSeconds: number;
    hashrate: number;
    hardFork: number;
    protocol: string;
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
  blocks: Array<{ height: number; timestamp: number; hash: string; txs: number; size: number; difficulty: number; fee: number; reward: number; inputs: number; outputs: number }>;
  transactions: Array<{ hash: string; block: number; timestamp: number; size: number | null; confirmations: number; fee: number; reward: number; inputs: number; outputs: number; txType: string }>;
  transactionPool: TransactionPoolSnapshot;
  pagination: { blockPage: number; transactionPage: number; pageSize: number; transactionScanSize: number };
  serviceNodesHeight: number;
  serviceNodes: {
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
    nodes: Array<{ publicKey: string; registeredAt: number; unlockedAt: number; contributions: number }>;
  };
};

export type NetworkPreview = Pick<ChainSnapshot, "live" | "source" | "node" | "fetchedAt" | "network">;

export type QuorumSnapshot = ChainSnapshot["quorums"] & {
  live: boolean;
  fetchedAt: string;
  height: number;
};

export type ServiceNodesLiveSnapshot = {
  live: boolean;
  fetchedAt: string;
  height: number;
  serviceNodes: ChainSnapshot["serviceNodes"];
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
