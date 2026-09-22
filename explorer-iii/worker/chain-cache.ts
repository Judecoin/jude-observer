import {
  CHAIN_CACHE_TTL_SECONDS,
  CHAIN_CACHE_CREATED_HEADER,
  CHAIN_CACHE_FRESH_MS,
  CHAIN_CACHE_STALE_MS,
} from "./constants";
import { explorerPageSize } from "./pagination";
import type { EdgeCache, ExecutionContext } from "./runtime-types";
import { createChainResponse } from "./chain";
import { noStoreResponse } from "./responses";

function storedChainResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=0, s-maxage=${CHAIN_CACHE_TTL_SECONDS}`);
  headers.set(CHAIN_CACHE_CREATED_HEADER, String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function chainCacheKey(request: Request, url: URL) {
  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  for (const name of ["blockPage", "transactionPage", "quorumPage"]) {
    const value = Math.min(10000, Math.max(0, Number.parseInt(url.searchParams.get(name) || "0", 10) || 0));
    cacheUrl.searchParams.set(name, String(value));
  }
  for (const name of ["blockPageSize", "transactionPageSize", "quorumPageSize"]) {
    cacheUrl.searchParams.set(name, String(explorerPageSize(url.searchParams.get(name))));
  }
  return new Request(cacheUrl, { method: "GET" });
}

const pendingChainRefreshes = new WeakMap<EdgeCache, Map<string, Promise<Response>>>();

async function writeChainCache(cache: EdgeCache, cacheKey: Request, url: URL) {
  const response = await createChainResponse(url);
  if (!response.ok) return response;
  const stored = storedChainResponse(response);
  try {
    const [next, current] = await Promise.all([
      stored.clone().json() as Promise<{ network?: { height?: number } }>,
      cache.match(cacheKey),
    ]);
    if (current) {
      const previous = await current.clone().json() as { network?: { height?: number } };
      if (Number.isInteger(previous.network?.height)
        && Number(previous.network?.height) > Number(next.network?.height)) {
        return noStoreResponse(current);
      }
    }
    await cache.put(cacheKey, stored.clone());
  } catch {
    // Cache failures must not block fresh data.
  }
  return noStoreResponse(stored);
}

async function refreshChainCache(cache: EdgeCache, cacheKey: Request, url: URL) {
  let pendingForCache = pendingChainRefreshes.get(cache);
  if (!pendingForCache) {
    pendingForCache = new Map();
    pendingChainRefreshes.set(cache, pendingForCache);
  }
  const requestedTip = Number.parseInt(url.searchParams.get("tip") || "", 10);

  const pendingKey = `${cacheKey.url}|${Number.isInteger(requestedTip) && requestedTip >= 0 ? requestedTip : "any"}`;
  let pending = pendingForCache.get(pendingKey);
  if (!pending) {
    pending = writeChainCache(cache, cacheKey, url).finally(() => pendingForCache.delete(pendingKey));
    pendingForCache.set(pendingKey, pending);
  }
  return (await pending).clone();
}

export async function cachedChainResponse(request: Request, url: URL, ctx: ExecutionContext) {
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache) return createChainResponse(url);

  const cacheKey = chainCacheKey(request, url);
  let cached: Response | undefined;
  try {
    cached = await cache.match(cacheKey);
  } catch {
    return createChainResponse(url);
  }

  if (cached) {
    const createdAt = Number(cached.headers.get(CHAIN_CACHE_CREATED_HEADER) || 0);
    const age = Math.max(0, Date.now() - createdAt);
    const requestedTip = Number.parseInt(url.searchParams.get("tip") || "", 10);
    let reachesMinimumHeight = true;
    if (Number.isInteger(requestedTip) && requestedTip >= 0) {
      const snapshot = await cached.clone().json().catch(() => null) as { network?: { height?: number } } | null;
      reachesMinimumHeight = Number.isInteger(snapshot?.network?.height)
        && Number(snapshot?.network?.height) >= requestedTip;
    }
    if (createdAt > 0 && age <= CHAIN_CACHE_FRESH_MS && reachesMinimumHeight) return noStoreResponse(cached);
    if (createdAt > 0 && age <= CHAIN_CACHE_STALE_MS && reachesMinimumHeight) {
      ctx.waitUntil(refreshChainCache(cache, cacheKey, url).then(() => undefined));
      return noStoreResponse(cached);
    }
  }
  const refreshed = await refreshChainCache(cache, cacheKey, url);
  return refreshed.ok || !cached ? refreshed : noStoreResponse(cached);
}
