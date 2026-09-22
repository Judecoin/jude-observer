import { noStoreJson } from "./responses";
import { serviceNodesLiveSnapshot } from "./service-nodes";
import { networkPreviewSnapshot } from "./network";
import { transactionPoolSnapshot } from "./transaction-pool";
import { requestedQuorumPage, requestedQuorumTip, latestQuorumSnapshot, quorumPageSnapshot } from "./quorums";
import { explorerPageSize } from "./pagination";
import { cachedRpcFetch } from "./rpc";
import type { RpcInfo } from "./rpc-types";
import type { ExecutionContext } from "./runtime-types";
import { cachedLiveResponse } from "./live-cache";
import {
  SERVICE_NODES_CACHE_FRESH_MS,
  SERVICE_NODES_CACHE_STALE_MS,
  SERVICE_NODES_CACHE_TTL_SECONDS,
  SERVICE_NODES_CACHE_CREATED_HEADER,
  NETWORK_CACHE_FRESH_MS,
  NETWORK_CACHE_STALE_MS,
  NETWORK_CACHE_TTL_SECONDS,
  NETWORK_CACHE_CREATED_HEADER,
  TRANSACTION_POOL_CACHE_FRESH_MS,
  TRANSACTION_POOL_CACHE_STALE_MS,
  TRANSACTION_POOL_CACHE_TTL_SECONDS,
  TRANSACTION_POOL_CACHE_CREATED_HEADER,
  QUORUM_CACHE_FRESH_MS,
  QUORUM_CACHE_STALE_MS,
  QUORUM_CACHE_TTL_SECONDS,
  QUORUM_CACHE_CREATED_HEADER,
} from "./constants";

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
      const infoResponse = await cachedRpcFetch<RpcInfo>("/get_info");
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

export async function cachedServiceNodesLiveResponse(url: URL, ctx: ExecutionContext) {

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

export async function cachedNetworkLiveResponse(url: URL, ctx: ExecutionContext) {
  return cachedLiveResponse(url, {
    path: "/api/network",
    freshMs: NETWORK_CACHE_FRESH_MS,
    staleMs: NETWORK_CACHE_STALE_MS,
    ttlSeconds: NETWORK_CACHE_TTL_SECONDS,
    createdHeader: NETWORK_CACHE_CREATED_HEADER,
  }, createNetworkLiveResponse, ctx);
}

export async function cachedTransactionPoolLiveResponse(url: URL, ctx: ExecutionContext) {
  return cachedLiveResponse(url, {
    path: "/api/transaction-pool",
    freshMs: TRANSACTION_POOL_CACHE_FRESH_MS,
    staleMs: TRANSACTION_POOL_CACHE_STALE_MS,
    ttlSeconds: TRANSACTION_POOL_CACHE_TTL_SECONDS,
    createdHeader: TRANSACTION_POOL_CACHE_CREATED_HEADER,
  }, createTransactionPoolLiveResponse, ctx);
}

export async function cachedQuorumLiveResponse(url: URL, ctx: ExecutionContext) {
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
