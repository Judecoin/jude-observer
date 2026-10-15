import type { ChainSnapshot, NetworkPreview, TransactionPoolSnapshot } from "../explorer-types";
import { isValidChainSnapshot, isValidNetworkPreview } from "./snapshot-validation";
import { SNAPSHOT_CACHE_TTL_MS, SNAPSHOT_CACHE_MAX_ENTRIES, SNAPSHOT_RETRY_DELAYS_MS, LIVE_REQUEST_TIMEOUT_MS, CHAIN_REQUEST_TIMEOUT_MS } from "./constants";

const snapshotCache = new Map<string, { data: ChainSnapshot; expiresAt: number }>();

const snapshotRequests = new Map<string, Promise<ChainSnapshot>>();

let networkPreviewRequest: Promise<NetworkPreview> | null = null;

let transactionPoolRequest: Promise<TransactionPoolSnapshot> | null = null;

export async function fetchExplorerJson<T>(endpoint: string, errorMessage: string, timeoutMs = LIVE_REQUEST_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(errorMessage);
    // Keep the deadline active until the body is read, not just its headers.
    return await response.json() as T;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

export async function fetchSnapshot(params: URLSearchParams) {
  const key = params.toString();
  const now = Date.now();
  for (const [cachedKey, cachedValue] of snapshotCache) {
    if (cachedValue.expiresAt <= now) snapshotCache.delete(cachedKey);
  }
  const cached = snapshotCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) snapshotCache.delete(key);
  const pending = snapshotRequests.get(key);
  if (pending) return pending;
  const request = fetchExplorerJson<ChainSnapshot>(`/api/chain?${key}`, "Network data unavailable", params.get("overview") === "1" ? LIVE_REQUEST_TIMEOUT_MS : CHAIN_REQUEST_TIMEOUT_MS).then((data) => {
    if (!isValidChainSnapshot(data)) throw new Error("Invalid network snapshot");
    while (snapshotCache.size >= SNAPSHOT_CACHE_MAX_ENTRIES) {
      const oldestKey = snapshotCache.keys().next().value;
      if (oldestKey == null) break;
      snapshotCache.delete(oldestKey);
    }
    snapshotCache.set(key, { data, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS });
    return data;
  }).finally(() => snapshotRequests.delete(key));
  snapshotRequests.set(key, request);
  return request;
}

export async function fetchSnapshotWithRetry(params: URLSearchParams, maxAttempts: number = SNAPSHOT_RETRY_DELAYS_MS.length) {
  let lastError: unknown;
  for (const delay of SNAPSHOT_RETRY_DELAYS_MS.slice(0, maxAttempts)) {
    if (delay) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
    try {
      return await fetchSnapshot(params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Network data unavailable");
}

export async function fetchNetworkPreview() {
  if (networkPreviewRequest) return networkPreviewRequest;
  networkPreviewRequest = fetchExplorerJson<NetworkPreview>("/api/network", "Network overview unavailable").then((data) => {
    if (!isValidNetworkPreview(data)) throw new Error("Invalid network overview");
    return data;
  }).finally(() => { networkPreviewRequest = null; });
  return networkPreviewRequest;
}

export async function fetchTransactionPool() {
  if (transactionPoolRequest) return transactionPoolRequest;
  transactionPoolRequest = fetchExplorerJson<TransactionPoolSnapshot>("/api/transaction-pool", "Transaction pool unavailable").then((data) => {
    if (data.available !== true || !Number.isInteger(data.count) || data.count < 0 || !Array.isArray(data.transactions)) {
      throw new Error("Invalid transaction pool response");
    }
    return data;
  }).finally(() => { transactionPoolRequest = null; });
  return transactionPoolRequest;
}
