import type { ChainSnapshot, NetworkPreview, TransactionPoolSnapshot } from "../explorer-types";
import { isValidChainSnapshot, isValidNetworkPreview } from "./snapshot-validation";
import { SNAPSHOT_CACHE_TTL_MS, SNAPSHOT_RETRY_DELAYS_MS } from "./constants";

const snapshotCache = new Map<string, { data: ChainSnapshot; expiresAt: number }>();

const snapshotRequests = new Map<string, Promise<ChainSnapshot>>();

let networkPreviewRequest: Promise<NetworkPreview> | null = null;

let transactionPoolRequest: Promise<TransactionPoolSnapshot> | null = null;

export async function fetchSnapshot(params: URLSearchParams) {
  const key = params.toString();
  const cached = snapshotCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) snapshotCache.delete(key);
  const pending = snapshotRequests.get(key);
  if (pending) return pending;
  const request = fetch(`/api/chain?${key}`, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("Network data unavailable");
    const data = await response.json() as ChainSnapshot;
    if (!isValidChainSnapshot(data)) throw new Error("Invalid network snapshot");
    snapshotCache.set(key, { data, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS });
    return data;
  }).finally(() => snapshotRequests.delete(key));
  snapshotRequests.set(key, request);
  return request;
}

export async function fetchSnapshotWithRetry(params: URLSearchParams) {
  let lastError: unknown;
  for (const delay of SNAPSHOT_RETRY_DELAYS_MS) {
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
  networkPreviewRequest = fetch("/api/network", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("Network overview unavailable");
    const data = await response.json() as NetworkPreview;
    if (!isValidNetworkPreview(data)) throw new Error("Invalid network overview");
    return data;
  }).finally(() => { networkPreviewRequest = null; });
  return networkPreviewRequest;
}

export async function fetchTransactionPool() {
  if (transactionPoolRequest) return transactionPoolRequest;
  transactionPoolRequest = fetch("/api/transaction-pool", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("Transaction pool unavailable");
    const data = await response.json() as TransactionPoolSnapshot;
    if (data.available !== true || !Number.isInteger(data.count) || data.count < 0 || !Array.isArray(data.transactions)) {
      throw new Error("Invalid transaction pool response");
    }
    return data;
  }).finally(() => { transactionPoolRequest = null; });
  return transactionPoolRequest;
}
