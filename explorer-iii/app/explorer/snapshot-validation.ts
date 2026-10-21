import type { ServiceNodesLiveSnapshot, NetworkPreview, QuorumSnapshot, ChainSnapshot, UpgradeReadiness, ForkArchiveSnapshot, ForkSnapshot } from "../explorer-types";
import { PAGE_SIZE_OPTIONS } from "./constants";

export function isNewerHeightSnapshot(currentHeight: number, currentFetchedAt: string, nextHeight: number, nextFetchedAt: string) {
  if (nextHeight !== currentHeight) return nextHeight > currentHeight;
  return Date.parse(nextFetchedAt) > Date.parse(currentFetchedAt);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNullableNonNegativeInteger(value: unknown) {
  return value === null || isNonNegativeInteger(value);
}

const FORK_ACTIVATION_HEIGHT = 882_300;
const FORK_REQUIRED_PROTOCOL = 17;
const FORK_REQUIRED_RELEASE = "4.0.0";

function forkSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validForkDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isValidUpgradeReadiness(value: unknown, expectedTotal?: number): value is UpgradeReadiness {
  const readiness = value as UpgradeReadiness | null;
  if (!readiness || readiness.targetVersion !== FORK_REQUIRED_RELEASE || readiness.scope !== "registered-service-nodes"
    || ![readiness.eligibleTotal, readiness.upgraded, readiness.pending, readiness.unknown].every(forkSafeCount)
    || (expectedTotal !== undefined && readiness.eligibleTotal !== expectedTotal)
    || readiness.upgraded + readiness.pending + readiness.unknown !== readiness.eligibleTotal
    || !Array.isArray(readiness.versions)) return false;
  const percentage = readiness.eligibleTotal > 0
    ? Math.round(readiness.upgraded / readiness.eligibleTotal * 10_000) / 100 : null;
  if (readiness.percentage !== percentage) return false;
  const versions = new Set<string>();
  let upgraded = 0;
  let pending = 0;
  for (const entry of readiness.versions) {
    if (!entry || typeof entry.version !== "string" || !forkSafeCount(entry.count) || entry.count === 0
      || versions.has(entry.version)) return false;
    const parts = entry.version.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^(0|[1-9]\d*)$/.test(part) || !forkSafeCount(Number(part)))
      || parts.every((part) => Number(part) === 0)) return false;
    versions.add(entry.version);
    if (Number(parts[0]) >= 4) upgraded += entry.count;
    else pending += entry.count;
  }
  return upgraded === readiness.upgraded && pending === readiness.pending;
}

export function isValidForkArchive(value: unknown): value is ForkArchiveSnapshot {
  const archive = value as ForkArchiveSnapshot | null;
  if (!archive || typeof archive.available !== "boolean" || typeof archive.exactClosingSnapshot !== "boolean") return false;
  if (archive.preFork === null) return archive.exactClosingSnapshot === false;
  const observation = archive.preFork;
  return archive.available === true && observation != null
    && forkSafeCount(observation.height) && observation.height < FORK_ACTIVATION_HEIGHT
    && validForkDate(observation.observedAt) && Date.parse(observation.observedAt) <= Date.now() + 60_000
    && typeof observation.source === "string" && observation.source.length > 0 && observation.source.length <= 256
    && isValidUpgradeReadiness(observation.readiness) && observation.readiness.eligibleTotal > 0
    && archive.exactClosingSnapshot === (observation.height === FORK_ACTIVATION_HEIGHT - 1);
}

export function isValidForkSnapshot(value: unknown, network: ChainSnapshot["network"]): value is ForkSnapshot {
  const fork = value as ForkSnapshot | null;
  if (!fork || fork.activationHeight !== FORK_ACTIVATION_HEIGHT || fork.targetProtocol !== FORK_REQUIRED_PROTOCOL
    || fork.targetVersion !== FORK_REQUIRED_RELEASE || fork.currentProtocol !== network.hardFork
    || !forkSafeCount(fork.currentProtocol) || !validForkDate(fork.observedAt)
    || Date.parse(fork.observedAt) > Date.now() + 60_000
    || fork.blocksRemaining !== Math.max(0, FORK_ACTIVATION_HEIGHT - network.height)
    || fork.blocksSinceActivation !== Math.max(0, network.height - FORK_ACTIVATION_HEIGHT)) return false;
  const heightReached = network.height >= FORK_ACTIVATION_HEIGHT;
  if (fork.estimatedActivationAt !== null && (!validForkDate(fork.estimatedActivationAt)
    || heightReached || Date.parse(fork.estimatedActivationAt) <= Date.parse(fork.observedAt))) return false;
  const block = fork.activationBlock;
  if (block !== null && (!heightReached || !block || block.height !== FORK_ACTIVATION_HEIGHT
    || typeof block.hash !== "string" || !/^[a-f0-9]{64}$/i.test(block.hash)
    || !forkSafeCount(block.timestamp) || block.timestamp === 0
    || !forkSafeCount(block.protocol) || block.protocol === 0)) return false;
  const activated = heightReached && block?.protocol === FORK_REQUIRED_PROTOCOL && fork.currentProtocol >= FORK_REQUIRED_PROTOCOL;
  return fork.phase === (!heightReached ? "scheduled" : activated ? "activated" : "unverified");
}

export function isValidServiceNodesSnapshot(value: unknown): value is ServiceNodesLiveSnapshot {
  const snapshot = value as ServiceNodesLiveSnapshot | null;
  const nodes = snapshot?.serviceNodes;
  if (snapshot?.live !== true || !isNonNegativeInteger(snapshot.height)
    || typeof snapshot.fetchedAt !== "string" || !Number.isFinite(Date.parse(snapshot.fetchedAt))
    || !nodes) return false;
  const counts = [nodes.total, nodes.active, nodes.funded, nodes.exiting, nodes.decommissioned];
  return counts.every(isNonNegativeInteger)
    && (nodes.upgradeReadiness === undefined || isValidUpgradeReadiness(nodes.upgradeReadiness, nodes.total))
    && (nodes.forkArchive === undefined || isValidForkArchive(nodes.forkArchive))
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
    && (snapshot.network?.fork === undefined || isValidForkSnapshot(snapshot.network.fork, snapshot.network))
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
      && [block.height, block.timestamp, block.txs, block.size, block.difficulty].every(isNonNegativeInteger)
      && [block.fee, block.reward, block.inputs, block.outputs].every(isNullableNonNegativeInteger))
    && Array.isArray(snapshot.transactions)
    && snapshot.transactions.every((tx) => tx && typeof tx.hash === "string" && typeof tx.txType === "string"
      && [tx.block, tx.timestamp, tx.confirmations, tx.fee, tx.inputs, tx.outputs].every(isNonNegativeInteger)
      && (tx.size === null || isNonNegativeInteger(tx.size)))
    && ((snapshot.serviceNodes === null && snapshot.serviceNodesHeight === null)
      || isValidServiceNodesSnapshot({ live: snapshot.live, fetchedAt: snapshot.fetchedAt,
        height: snapshot.serviceNodesHeight, serviceNodes: snapshot.serviceNodes }))
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

export function shouldAcceptChainSnapshot(current: ChainSnapshot, next: ChainSnapshot) {
  if (!sameChainSelection(current, next)) return true;
  if (next.network.height !== current.network.height) return next.network.height > current.network.height;
  // Header previews can finish after decoded details. Completeness takes
  // precedence over request timestamps at the same chain height.
  if (Boolean(current.pendingDetails) !== Boolean(next.pendingDetails)) return next.pendingDetails !== true;
  if (Boolean(current.headerOnly) !== Boolean(next.headerOnly)) return next.headerOnly !== true;
  return isNewerHeightSnapshot(current.network.height, current.fetchedAt, next.network.height, next.fetchedAt);
}
