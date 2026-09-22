import type { EdgeCache, ExecutionContext } from "./runtime-types";
import { noStoreResponse } from "./responses";

type LiveCachePolicy = {
  path: string;
  freshMs: number;
  staleMs: number;
  ttlSeconds: number;
  createdHeader: string;
  minimumHeight?: number;
};

function storedLiveResponse(response: Response, policy: LiveCachePolicy) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=0, s-maxage=${policy.ttlSeconds}`);
  headers.set(policy.createdHeader, String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function refreshLiveCache(cache: EdgeCache, cacheKey: Request, policy: LiveCachePolicy, create: () => Promise<Response>) {
  const response = await create();
  if (!response.ok) return response;
  const stored = storedLiveResponse(response, policy);
  try {
    const [nextSnapshot, current] = await Promise.all([
      stored.clone().json().catch(() => null) as Promise<{ height?: number } | null>,
      cache.match(cacheKey).catch(() => undefined),
    ]);
    if (current && Number.isInteger(nextSnapshot?.height)) {
      const currentSnapshot = await current.clone().json().catch(() => null) as { height?: number } | null;
      if (Number.isInteger(currentSnapshot?.height)
        && Number(currentSnapshot?.height) > Number(nextSnapshot?.height)) {
        return noStoreResponse(current);
      }
    }
    await cache.put(cacheKey, stored.clone());
  } catch {
    // Cache failures must not block fresh data.
  }
  return noStoreResponse(stored);
}

export async function cachedLiveResponse(url: URL, policy: LiveCachePolicy, create: () => Promise<Response>, ctx: ExecutionContext) {
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache) return create();
  const cacheKey = new Request(`${url.origin}${policy.path}`, { method: "GET" });
  let cached: Response | undefined;
  try {
    cached = await cache.match(cacheKey);
  } catch {
    return create();
  }
  if (cached) {
    const createdAt = Number(cached.headers.get(policy.createdHeader) || 0);
    const age = Math.max(0, Date.now() - createdAt);
    let reachesMinimumHeight = true;
    if (Number.isInteger(policy.minimumHeight) && Number(policy.minimumHeight) >= 0) {
      try {
        const snapshot = await cached.clone().json() as { height?: number };
        reachesMinimumHeight = Number.isInteger(snapshot.height)
          && Number(snapshot.height) >= Number(policy.minimumHeight);
      } catch {
        reachesMinimumHeight = false;
      }
    }
    if (createdAt > 0 && age <= policy.freshMs && reachesMinimumHeight) return noStoreResponse(cached);
    if (createdAt > 0 && age <= policy.staleMs && reachesMinimumHeight) {
      ctx.waitUntil(refreshLiveCache(cache, cacheKey, policy, create).then(() => undefined));
      return noStoreResponse(cached);
    }
  }
  const refreshed = await refreshLiveCache(cache, cacheKey, policy, create);
  return refreshed.ok || !cached ? refreshed : noStoreResponse(cached);
}
