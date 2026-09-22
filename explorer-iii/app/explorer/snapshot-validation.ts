import type { ServiceNodesLiveSnapshot, NetworkPreview, QuorumSnapshot, ChainSnapshot } from "../explorer-types";
import { PAGE_SIZE_OPTIONS } from "./constants";

export function isNewerHeightSnapshot(currentHeight: number, currentFetchedAt: string, nextHeight: number, nextFetchedAt: string) {
  if (nextHeight !== currentHeight) return nextHeight > currentHeight;
  return Date.parse(nextFetchedAt) > Date.parse(currentFetchedAt);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

export function isValidServiceNodesSnapshot(value: unknown): value is ServiceNodesLiveSnapshot {
  const snapshot = value as ServiceNodesLiveSnapshot | null;
  const nodes = snapshot?.serviceNodes;
  if (snapshot?.live !== true || !isNonNegativeInteger(snapshot.height)
    || typeof snapshot.fetchedAt !== "string" || !Number.isFinite(Date.parse(snapshot.fetchedAt))
    || !nodes) return false;
  const counts = [nodes.total, nodes.active, nodes.funded, nodes.exiting, nodes.decommissioned];
  return counts.every(isNonNegativeInteger)
    && nodes.active <= nodes.total
    && nodes.funded <= nodes.total
    && Array.isArray(nodes.nodes)
    && nodes.nodes.length === nodes.total
    && nodes.nodes.every((node) => node && typeof node.publicKey === "string"
      && typeof node.active === "boolean" && typeof node.funded === "boolean"
      && typeof node.version === "string" && typeof node.unlocking === "boolean"
      && [node.contributed, node.requirement, node.registeredAt, node.lastRewardAt, node.unlockAt,
        node.contributors, node.maxContributors, node.lastUptimeProof].every(isNonNegativeInteger))
    && new Set(nodes.nodes.map((node) => node.publicKey)).size === nodes.total
    && nodes.nodes.filter((node) => node.active).length === nodes.active
    && nodes.nodes.filter((node) => node.funded).length === nodes.funded
    && Number.isFinite(nodes.totalContributed) && nodes.totalContributed >= 0
    && Number.isFinite(nodes.stakingRequirement) && nodes.stakingRequirement >= 0
    && Array.isArray(nodes.awaitingNodes)
    && nodes.awaitingNodes.length === nodes.total - nodes.funded
    && nodes.awaitingNodes.every((node) => node && typeof node.publicKey === "string"
      && [node.contributors, node.maxContributors, node.contributed, node.requirement,
        node.contributionRequired, node.contributionOpen, node.reservedRemaining,
        node.registeredAt, node.lastRewardAt, node.unlockAt].every(isNonNegativeInteger))
    && Array.isArray(nodes.unlockingNodes)
    && nodes.unlockingNodes.length === nodes.exiting
    && nodes.unlockingNodes.every((node) => node && typeof node.publicKey === "string"
      && [node.contributed, node.registeredAt, node.lastRewardAt, node.unlockAt].every(isNonNegativeInteger))
    && Array.isArray(nodes.decommissionedNodes)
    && nodes.decommissionedNodes.length === nodes.decommissioned
    && nodes.decommissionedNodes.every((node) => node && typeof node.publicKey === "string"
      && [node.contributors, node.maxContributors, node.lastUptimeProof,
        node.decommissionCount].every(isNonNegativeInteger) && Number.isInteger(node.downtimeCredit));
}

export function isValidNetworkPreview(value: unknown): value is NetworkPreview {
  const snapshot = value as NetworkPreview | null;
  return snapshot?.live === true
    && typeof snapshot.fetchedAt === "string"
    && Number.isFinite(Date.parse(snapshot.fetchedAt))
    && isNonNegativeInteger(snapshot.network?.height)
    && Number.isFinite(snapshot.network?.difficulty)
    && Number.isFinite(snapshot.network?.hashrate)
    && [snapshot.network?.targetSeconds, snapshot.network?.latestBlockTimestamp,
      snapshot.network?.hardFork, snapshot.network?.blockSizeMedian, snapshot.network?.blockSizeLimit].every(isNonNegativeInteger)
    && typeof snapshot.network?.protocol === "string"
    && typeof snapshot.network?.synced === "boolean";
}

export function isValidQuorumSnapshot(value: unknown): value is QuorumSnapshot {
  const snapshot = value as QuorumSnapshot | null;
  return snapshot?.live === true
    && snapshot.trusted === true
    && isNonNegativeInteger(snapshot.height)
    && typeof snapshot.fetchedAt === "string"
    && Number.isFinite(Date.parse(snapshot.fetchedAt))
    && isNonNegativeInteger(snapshot.page)
    && isNonNegativeInteger(snapshot.pageSize)
    && Array.isArray(snapshot.records)
    && snapshot.records.length > 0
    && snapshot.records.every((record) => isNonNegativeInteger(record.height)
      && Array.isArray(record.validators) && Array.isArray(record.workers)
      && [...record.validators, ...record.workers].every((key) => typeof key === "string"));
}

export function isValidChainSnapshot(value: unknown): value is ChainSnapshot {
  const snapshot = value as ChainSnapshot | null;
  return snapshot?.live === true
    && typeof snapshot.fetchedAt === "string"
    && Number.isFinite(Date.parse(snapshot.fetchedAt))
    && isValidNetworkPreview(snapshot)
    && Array.isArray(snapshot.blocks)
    && snapshot.blocks.every((block) => block && typeof block.hash === "string"
      && [block.height, block.timestamp, block.txs, block.size, block.difficulty,
        block.fee, block.reward, block.inputs, block.outputs].every(isNonNegativeInteger))
    && Array.isArray(snapshot.transactions)
    && snapshot.transactions.every((tx) => tx && typeof tx.hash === "string" && typeof tx.txType === "string"
      && [tx.block, tx.timestamp, tx.confirmations, tx.fee, tx.inputs, tx.outputs].every(isNonNegativeInteger)
      && (tx.size === null || isNonNegativeInteger(tx.size)))
    && isValidServiceNodesSnapshot({ live: snapshot.live, fetchedAt: snapshot.fetchedAt,
      height: snapshot.serviceNodesHeight, serviceNodes: snapshot.serviceNodes })
    && isNonNegativeInteger(snapshot.pagination?.blockPage)
    && isNonNegativeInteger(snapshot.pagination?.transactionPage)
    && PAGE_SIZE_OPTIONS.includes(snapshot.pagination?.pageSize as typeof PAGE_SIZE_OPTIONS[number])
    && isNonNegativeInteger(snapshot.pagination?.transactionScanSize)
    && isNonNegativeInteger(snapshot.quorums?.page)
    && isNonNegativeInteger(snapshot.quorums?.pageSize)
    && Array.isArray(snapshot.quorums?.records)
    && typeof snapshot.transactionPool?.available === "boolean";
}

export function sameChainSelection(left: ChainSnapshot, right: ChainSnapshot) {
  return left.pagination.blockPage === right.pagination.blockPage
    && left.pagination.transactionPage === right.pagination.transactionPage
    && left.pagination.pageSize === right.pagination.pageSize
    && left.pagination.transactionScanSize === right.pagination.transactionScanSize
    && left.quorums.page === right.quorums.page
    && left.quorums.pageSize === right.quorums.pageSize;
}
