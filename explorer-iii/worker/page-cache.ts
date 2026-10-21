import { EXPLORER_RELEASE_VERSION } from "../app/explorer/constants";
import type { EdgeCache, ExecutionContext } from "./runtime-types";

const PAGE_TTL_SECONDS = 20;
const PAGE_CACHE_READ_MS = 250;
const PAGE_REFRESH_MS = 5_000;
const CREATED_HEADER = "x-judecoin-page-created-at";
const refreshes = new Map<string, Promise<Response>>();

function pageKey(request: Request): Request | null {
  const url = new URL(request.url);
  if (request.method !== "GET" || request.headers.has("rsc") || url.searchParams.has("_rsc")
    || /text\/x-component/i.test(request.headers.get("accept") ?? "")) return null;
  url.pathname = `/__explorer-pages/${EXPLORER_RELEASE_VERSION}${url.pathname}`;
  url.searchParams.sort();
  return new Request(url, { method: "GET" });
}

function publicPage(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.delete(CREATED_HEADER);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function cachedExplorerPage(request: Request, ctx: ExecutionContext,
  render: () => Promise<{ response: Response; cacheable: boolean }>): Promise<Response> {
  const key = pageKey(request);
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!key || !cache) return (await render()).response;

  const refresh = () => {
    let pending = refreshes.get(key.url);
    if (!pending) {
      pending = render().then(({ response, cacheable }) => {
        if (cacheable && response.status === 200 && response.headers.get("content-type")?.includes("text/html")
          && !response.headers.has("set-cookie")) {
          const headers = new Headers(response.headers);
          headers.set("cache-control", `public, max-age=${PAGE_TTL_SECONDS}`);
          headers.set(CREATED_HEADER, String(Date.now()));
          const copy = response.clone();
          ctx.waitUntil((async () => cache.put(key, new Response(copy.body, { status: copy.status, headers })))().catch(() => undefined));
        }
        return response;
      }).finally(() => { if (refreshes.get(key.url) === pending) refreshes.delete(key.url); });
      if (refreshes.size < 64) refreshes.set(key.url, pending);
    }
    return pending.then((response) => response.clone());
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let cached: Response | undefined;
  try {
    cached = await Promise.race([
      (async () => cache.match(key))().catch(() => undefined),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), PAGE_CACHE_READ_MS); }),
    ]);
  } finally { clearTimeout(timer); }
  const created = Number(cached?.headers.get(CREATED_HEADER));
  const age = Date.now() - created;
  if (cached?.ok && created > 0 && age >= 0 && age < PAGE_TTL_SECONDS * 1000) {
    if (age >= PAGE_REFRESH_MS) ctx.waitUntil(refresh().then(() => undefined).catch(() => undefined));
    return publicPage(cached);
  }
  return publicPage(await refresh());
}
