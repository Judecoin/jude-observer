import type { ChainSnapshot, NetworkPreview, ServiceNodesLiveSnapshot, QuorumSnapshot } from "../explorer-types";
import {
  CLIENT_SNAPSHOT_MAX_CHARS,
  CLIENT_SNAPSHOT_MAX_AGE_MS,
  CLIENT_SNAPSHOT_FUTURE_SKEW_MS,
  CLIENT_CHAIN_SNAPSHOT_KEY,
  CLIENT_NETWORK_SNAPSHOT_KEY,
  CLIENT_SERVICE_NODES_SNAPSHOT_KEY,
  CLIENT_QUORUM_SNAPSHOT_KEY,
} from "./constants";
import {
  isNonNegativeInteger,
  isValidChainSnapshot,
  sameChainSelection,
  isNewerHeightSnapshot,
  isValidNetworkPreview,
  isValidServiceNodesSnapshot,
  isValidQuorumSnapshot,
} from "./snapshot-validation";

export const provisionalClientSnapshots = new WeakSet<object>();

export function isProvisionalSnapshot(value: unknown): boolean {
  return typeof value === "object" && value !== null && provisionalClientSnapshots.has(value);
}

let lastVerifiedChainSnapshot: ChainSnapshot | null = null;

export let lastVerifiedNetworkPreview: NetworkPreview | null = null;

export let lastVerifiedServiceNodesSnapshot: ServiceNodesLiveSnapshot | null = null;

export let lastVerifiedQuorumSnapshot: QuorumSnapshot | null = null;

export function readClientSnapshot<T>(key: string, validate: (value: unknown) => value is T): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw || raw.length > CLIENT_SNAPSHOT_MAX_CHARS) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!validate(parsed)) return null;
    const cached = parsed as { fetchedAt?: string; height?: number; network?: { height?: number } };
    const timestamp = Date.parse(cached.fetchedAt || "");
    const ageMs = Date.now() - timestamp;
    const height = cached.height ?? cached.network?.height;
    if (!Number.isFinite(timestamp) || ageMs > CLIENT_SNAPSHOT_MAX_AGE_MS
      || ageMs < -CLIENT_SNAPSHOT_FUTURE_SKEW_MS
      || !isNonNegativeInteger(height) || height > 100_000_000) return null;
    provisionalClientSnapshots.add(parsed as object);
    return parsed;
  } catch {
    return null;
  }
}

function writeClientSnapshot(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= CLIENT_SNAPSHOT_MAX_CHARS) window.localStorage.setItem(key, serialized);
  } catch {
    // Browser storage is optional.
  }
}

export function rememberChainSnapshot(snapshot: ChainSnapshot) {
  if (isProvisionalSnapshot(snapshot)) return snapshot;
  if (!isValidChainSnapshot(snapshot)) return lastVerifiedChainSnapshot;
  if (!lastVerifiedChainSnapshot || !sameChainSelection(lastVerifiedChainSnapshot, snapshot) || isNewerHeightSnapshot(
    lastVerifiedChainSnapshot.network.height, lastVerifiedChainSnapshot.fetchedAt,
    snapshot.network.height, snapshot.fetchedAt,
  )) {
    lastVerifiedChainSnapshot = snapshot;
    writeClientSnapshot(CLIENT_CHAIN_SNAPSHOT_KEY, snapshot);
  }
  return lastVerifiedChainSnapshot;
}

export function rememberNetworkPreview(snapshot: NetworkPreview) {
  if (isProvisionalSnapshot(snapshot)) return snapshot;
  if (!isValidNetworkPreview(snapshot)) return lastVerifiedNetworkPreview;
  if (!lastVerifiedNetworkPreview || isNewerHeightSnapshot(
    lastVerifiedNetworkPreview.network.height, lastVerifiedNetworkPreview.fetchedAt,
    snapshot.network.height, snapshot.fetchedAt,
  )) {
    lastVerifiedNetworkPreview = snapshot;
    writeClientSnapshot(CLIENT_NETWORK_SNAPSHOT_KEY, snapshot);
  }
  return lastVerifiedNetworkPreview;
}

export function rememberServiceNodesSnapshot(snapshot: ServiceNodesLiveSnapshot) {
  if (isProvisionalSnapshot(snapshot)) return snapshot;
  if (!isValidServiceNodesSnapshot(snapshot)) return lastVerifiedServiceNodesSnapshot;
  if (!lastVerifiedServiceNodesSnapshot || isNewerHeightSnapshot(
    lastVerifiedServiceNodesSnapshot.height, lastVerifiedServiceNodesSnapshot.fetchedAt,
    snapshot.height, snapshot.fetchedAt,
  )) {
    lastVerifiedServiceNodesSnapshot = snapshot;
    writeClientSnapshot(CLIENT_SERVICE_NODES_SNAPSHOT_KEY, snapshot);
  }
  return lastVerifiedServiceNodesSnapshot;
}

export function rememberQuorumSnapshot(snapshot: QuorumSnapshot) {
  if (isProvisionalSnapshot(snapshot)) return snapshot;
  if (!isValidQuorumSnapshot(snapshot)) return lastVerifiedQuorumSnapshot;
  if (!lastVerifiedQuorumSnapshot
    || lastVerifiedQuorumSnapshot.page !== snapshot.page
    || lastVerifiedQuorumSnapshot.pageSize !== snapshot.pageSize
    || isNewerHeightSnapshot(
      lastVerifiedQuorumSnapshot.height, lastVerifiedQuorumSnapshot.fetchedAt,
      snapshot.height, snapshot.fetchedAt,
    )) {
    lastVerifiedQuorumSnapshot = snapshot;
    writeClientSnapshot(CLIENT_QUORUM_SNAPSHOT_KEY, snapshot);
  }
  return lastVerifiedQuorumSnapshot;
}
