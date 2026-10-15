export type IdentifierMatch = {
  kind: "block" | "transaction" | "service-node";
  response: Response;
};

export function validatePublicSearchTerm(scope: "block" | "transaction", input: string): string | null {
  const term = input.trim();
  if (scope === "block" && /^\d{1,10}$/.test(term)) return term;
  return /^[a-fA-F0-9]{64}$/.test(term) ? term.toLowerCase() : null;
}

// A hash can identify any of these public records. A slow negative lookup must
// not hold up a successful lookup from another endpoint.
export async function lookupPublicIdentifier(identifier: string, signal?: AbortSignal): Promise<IdentifierMatch | null> {
  const endpoints = [
    { kind: "block" as const, path: `/api/block?id=${encodeURIComponent(identifier)}` },
    { kind: "transaction" as const, path: `/api/transaction?hash=${encodeURIComponent(identifier)}` },
    { kind: "service-node" as const, path: `/api/service-node?key=${encodeURIComponent(identifier)}` },
  ];
  const controllers = endpoints.map(() => new AbortController());
  const cancelAll = () => controllers.forEach((controller) => controller.abort());
  if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
  signal?.addEventListener("abort", cancelAll, { once: true });
  const deadline = setTimeout(cancelAll, 45_000);
  let winner = -1;
  try {
    const match = await Promise.any(endpoints.map(async (endpoint, index) => {
      const response = await fetch(endpoint.path, { signal: controllers[index].signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(response.status === 404 ? "Not found" : "Search unavailable");
      }
      const body = await response.text();
      return { ...endpoint, response: new Response(body, { status: response.status, headers: response.headers }), index };
    }));
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    winner = match.index;
    return { kind: match.kind, response: match.response };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    if (error instanceof AggregateError && error.errors.every((reason: unknown) => reason instanceof Error && reason.message === "Not found")) return null;
    throw new Error("Search is temporarily unavailable. Please try again.");
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", cancelAll);
    controllers.forEach((controller, index) => { if (index !== winner) controller.abort(); });
  }
}
