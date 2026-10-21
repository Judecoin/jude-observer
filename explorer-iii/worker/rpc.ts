import type { RpcStatus, RpcResult, RpcMethods, RpcEnvelope } from "./rpc-types";
import { JUDECOIN_EMISSION_API, JUDECOIN_RPC_NODES, RPC_CACHE_MAX_ENTRIES, RPC_CACHE_TTL_MS, RPC_FAILOVER_DELAY_MS } from "./constants";

export async function rpcFetchNode<T extends RpcStatus = RpcStatus>(node: string, path: string, init?: RequestInit, timeoutOverrideMs?: number): Promise<RpcResult<T>> {
  const controller = new AbortController();
  const body = typeof init?.body === "string" ? init.body : "";

  const timeoutMs = timeoutOverrideMs
    ?? (path === "/json_rpc" && body.includes('"method":"get_service_nodes"') ? 35_000 : 15_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(`${node}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(init?.headers || {}) },
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const data = await response.json() as T;
    if (data?.error) throw new Error(data.error.message || "RPC error");
    const expectedStatus = node === JUDECOIN_EMISSION_API ? "success" : "OK";
    if (data?.status && data.status !== expectedStatus) throw new Error(`RPC status: ${data.status}`);
    if (data?.result?.status && data.result.status !== "OK") throw new Error(`RPC status: ${data.result.status}`);
    return { node, data };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export const rpcNodePreference: { current: string | null } = { current: null };

export async function rpcFetch<T extends RpcStatus = RpcStatus>(path: string, init?: RequestInit): Promise<RpcResult<T>> {
  const nodes = rpcNodePreference.current
    ? [rpcNodePreference.current, ...JUDECOIN_RPC_NODES.filter((node) => node !== rpcNodePreference.current)]
    : [...JUDECOIN_RPC_NODES];
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    controller.signal.throwIfAborted();
    return await new Promise<RpcResult<T>>((resolve, reject) => {
      let nextNode = 0;
      let inFlight = 0;
      let settled = false;
      let lastError: unknown;
      const startNext = () => {
        if (settled || nextNode >= nodes.length) return;
        clearTimeout(hedgeTimer);
        const node = nodes[nextNode++];
        inFlight += 1;
        if (nextNode < nodes.length) hedgeTimer = setTimeout(startNext, RPC_FAILOVER_DELAY_MS);
        void rpcFetchNode<T>(node, path, { ...init, signal: controller.signal }).then((result) => {
          if (settled) return;
          settled = true;
          rpcNodePreference.current = node;
          resolve(result);
        }).catch((error) => {
          inFlight -= 1;
          lastError = error;
          if (settled) return;
          if (controller.signal.aborted || (nextNode >= nodes.length && inFlight === 0)) {
            settled = true;
            reject(lastError instanceof Error ? lastError : new Error("No synchronized Judecoin data source is reachable"));
          } else if (nextNode < nodes.length) {
            startNext();
          }
        });
      };
      startNext();
    });
  } finally {
    clearTimeout(hedgeTimer);
    parentSignal?.removeEventListener("abort", abortFromParent);
    controller.abort();
  }
}

export async function jsonRpc<M extends keyof RpcMethods>(method: M, params: Record<string, unknown> = {}) {
  return rpcFetch<RpcEnvelope<RpcMethods[M]>>("/json_rpc", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "explorer-read-only", method, params }),
  });
}

type RpcCacheEntry = { value?: RpcResult; expiresAt: number; pending?: Promise<RpcResult> };

export const rpcResponseCache = new Map<string, RpcCacheEntry>();

export async function cachedRpcResult<T>(key: string, load: () => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
  const now = Date.now();
  for (const [cachedKey, entry] of rpcResponseCache) {
    if (!entry.pending && entry.expiresAt <= now) rpcResponseCache.delete(cachedKey);
  }
  const cached = rpcResponseCache.get(key);
  if (cached?.value && cached.expiresAt > now) return cached.value as RpcResult<T>;
  if (cached?.pending) return cached.pending as Promise<RpcResult<T>>;
  while (rpcResponseCache.size >= RPC_CACHE_MAX_ENTRIES) {
    const oldestKey = [...rpcResponseCache].find(([, entry]) => !entry.pending)?.[0];
    // Evicting an in-flight entry loses single-flight protection and lets
    // repeated callers launch the same expensive RPC again under pressure.
    if (oldestKey == null) throw new Error("RPC request capacity reached; retry shortly");
    rpcResponseCache.delete(oldestKey);
  }
  const pending: Promise<RpcResult<T>> = Promise.resolve().then(load).then((value) => {
    if (rpcResponseCache.get(key)?.pending !== pending) return value;
    rpcResponseCache.set(key, { value, expiresAt: Date.now() + RPC_CACHE_TTL_MS });
    return value;
  }).catch((error) => {
    if (rpcResponseCache.get(key)?.pending === pending) rpcResponseCache.delete(key);
    throw error;
  });
  rpcResponseCache.set(key, { expiresAt: 0, pending });
  return pending;
}

function requestCacheKey(scope: string, path: string, init?: RequestInit) {
  return `${scope}:${path}:${String(init?.method || "GET")}:${String(init?.body || "")}`;
}

export function cachedRpcFetch<T extends RpcStatus = RpcStatus>(path: string, init?: RequestInit) {
  return cachedRpcResult(requestCacheKey("any", path, init), () => rpcFetch<T>(path, init));
}

export function cachedRpcFetchNode<T extends RpcStatus = RpcStatus>(node: string, path: string, init?: RequestInit, timeoutOverrideMs?: number) {
  return cachedRpcResult(requestCacheKey(node, path, init), () => rpcFetchNode<T>(node, path, init, timeoutOverrideMs));
}

export function cachedJsonRpc<M extends keyof RpcMethods>(method: M, params: Record<string, unknown> = {}) {
  const init = {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "explorer-read-only", method, params }),
  };
  return cachedRpcFetch<RpcEnvelope<RpcMethods[M]>>("/json_rpc", init);
}
