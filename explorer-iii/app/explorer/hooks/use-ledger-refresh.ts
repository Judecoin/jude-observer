import { useEffect, useState } from "react";
import type { BlocksPageSnapshot, TransactionsPageSnapshot } from "../../explorer-types";
import { PAGE_SIZE_OPTIONS } from "../constants";
import { fetchLedgerPage, type LedgerKind } from "../ledger-requests";

type LedgerSelection = { cursor: string | null; page: number; pageSize: number; trail: Array<string | null> };
export type LedgerPageSnapshot = BlocksPageSnapshot | TransactionsPageSnapshot;
type LedgerSeedRequest = { cursor: string | null; pageSize: number; page: number };
const DEFAULT_LEDGER_PAGE_SIZE = 50;
const HOME_LEDGER_PAGE_SIZE = 10;

function validPageSize(value: unknown, fallback = DEFAULT_LEDGER_PAGE_SIZE) {
  const size = Number(value);
  return PAGE_SIZE_OPTIONS.includes(size as typeof PAGE_SIZE_OPTIONS[number]) ? size : fallback;
}

function isLegacyTransactionCursor(kind: LedgerKind, cursor: string | null) {
  if (kind !== "transactions" || !cursor) return false;
  try {
    const decoded = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded?.version === 1 && decoded.kind === "transactions";
  } catch { return false; }
}

export function readLedgerSelection(kind: LedgerKind, search: string, storedPageSize: string | null = null, historySelection?: LedgerSelection): LedgerSelection {
  const params = new URLSearchParams(search);
  const cursor = params.get("cursor") || null;
  const pageSize = validPageSize(params.get("pageSize") ?? storedPageSize);
  // Legacy transaction cursors have no authoritative record position. Start
  // a fresh, counted snapshot instead of showing an unverifiable page total.
  if (isLegacyTransactionCursor(kind, cursor)) return { cursor: null, page: 0, pageSize, trail: [null] };
  const requestedPage = Math.max(0, Math.min(100_000_000, Number.parseInt(params.get("page") || "1", 10) - 1 || 0));
  if (historySelection && historySelection.pageSize === pageSize
    && historySelection.cursor === cursor && Array.isArray(historySelection.trail)) return historySelection;
  return { cursor, page: cursor ? requestedPage : 0, pageSize, trail: [cursor] };
}

function ledgerUrl(selection: LedgerSelection) {
  const url = new URL(window.location.href);
  url.hash = "";
  if (selection.cursor) url.searchParams.set("cursor", selection.cursor);
  else url.searchParams.delete("cursor");
  if (selection.page > 0) url.searchParams.set("page", String(selection.page + 1));
  else url.searchParams.delete("page");
  url.searchParams.set("pageSize", String(selection.pageSize));
  return `${url.pathname}${url.search}`;
}

export function useLedgerRefresh(kind: LedgerKind | null, { scope = "page", initialData = null, initialRequest = null }: {
  scope?: "home" | "page";
  initialData?: LedgerPageSnapshot | null;
  initialRequest?: LedgerSeedRequest | null;
} = {}) {
  const defaultPageSize = scope === "home" ? HOME_LEDGER_PAGE_SIZE : DEFAULT_LEDGER_PAGE_SIZE;
  const seedCursor = scope === "page" ? initialRequest?.cursor ?? null : null;
  const seedPageSize = scope === "page" ? initialRequest?.pageSize ?? defaultPageSize : defaultPageSize;
  const seed = kind && initialData?.live && initialData.pageSize === seedPageSize
    && Array.isArray(initialData.rows) && initialData.rows.length <= seedPageSize
    && Number.isSafeInteger(initialData.position) && Number(initialData.position) >= 0
    && Number(initialData.position) % seedPageSize === 0
    && (seedCursor !== null || initialData.position === 0)
    && Number.isSafeInteger(initialData.totalRecords) && Number(initialData.totalRecords) >= 0
    && (initialData.rows.length === seedPageSize || !initialData.hasMore)
    ? initialData : null;
  const [selection, setSelection] = useState<LedgerSelection>(() => seed
    ? { cursor: seedCursor, page: Math.floor(Number(seed.position) / seed.pageSize), pageSize: seed.pageSize, trail: [seedCursor] }
    : { cursor: null, page: 0, pageSize: defaultPageSize, trail: [null] });
  const [ready, setReady] = useState(scope === "home" || seed !== null);
  const selectionKey = `${scope}:${kind}:${selection.pageSize}:${selection.cursor ?? "latest"}`;
  const [result, setResult] = useState<{ key: string; data: LedgerPageSnapshot; overview: boolean } | null>(() => seed
    ? { key: selectionKey, data: seed, overview: false } : null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!kind) return;
    if (scope === "home") {
      // Homepage ledgers are independent widgets. Their state must never be
      // restored from or written into another table's URL/history selection.
      return;
    }
    const restore = () => {
      let stored: string | null = null;
      try { if (!seed) stored = window.localStorage.getItem(`jude-explorer-${kind}-page-size:v1`); } catch { /* Optional preference. */ }
      const saved = window.history.state?.ledger;
      const restored = readLedgerSelection(kind, window.location.search, seed ? String(seed.pageSize) : stored, saved?.kind === kind ? saved.selection : undefined);
      if (isLegacyTransactionCursor(kind, new URLSearchParams(window.location.search).get("cursor"))) {
        const hash = window.location.hash;
        window.history.replaceState({ ...window.history.state, ledger: { kind, selection: restored } }, "", `${ledgerUrl(restored)}${hash}`);
      }
      setSelection(restored);
      setReady(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Bootstrap initializes this mounted ledger; browser navigation supplies later selections.
  }, [kind, scope]);

  useEffect(() => {
    if (!kind || !ready) return;
    let active = true;
    let timer = 0;
    let inFlight = false;
    let controller: AbortController | null = null;
    const controllers = new Set<AbortController>();
    const load = async () => {
      if (!active || inFlight) return;
      if (document.hidden) { timer = window.setTimeout(load, 30_000); return; }
      inFlight = true;
      const requestController = new AbortController();
      controller = requestController;
      controllers.add(requestController);
      setLoadingKey(selectionKey);
      let failed = false;
      let incomplete = false;
      let overviewRequest: Promise<void> | null = null;
      try {
        const params = new URLSearchParams({ pageSize: String(selection.pageSize) });
        if (selection.cursor) params.set("cursor", selection.cursor);
        if (kind === "blocks") {
          const overviewParams = new URLSearchParams(params);
          overviewParams.set("overview", "1");
          overviewRequest = fetchLedgerPage(kind, overviewParams, requestController.signal, scope).then((data) => {
            if (!active) return;
            setResult((current) => current?.key === selectionKey && (
              current.data.anchorHeight > data.anchorHeight
              || (current.data.anchorHeight === data.anchorHeight && current.data.anchorHash === data.anchorHash && !current.overview)
            ) ? current : { key: selectionKey, data, overview: true });
          }).catch(() => { /* Full data can succeed independently. */ });
        }
        const data = await fetchLedgerPage(kind, params, requestController.signal, scope);
        if (!active) return;
        if (kind === "transactions" && (data.totalRecords === null || data.position === null)) {
          throw new Error("Verified transaction totals are temporarily unavailable. Retrying…");
        }
        incomplete = data.pendingDetails === true;
        setResult((current) => current?.key === selectionKey && (current.data.anchorHeight > data.anchorHeight
          || (current.data.anchorHeight === data.anchorHeight && current.data.anchorHash === data.anchorHash
            && !current.data.pendingDetails && data.pendingDetails))
          ? current : { key: selectionKey, data, overview: false });
        setError("");
      } catch (failure) {
        failed = true;
        if (active) setError(failure instanceof Error ? failure.message : "Mainnet data unavailable. Retrying…");
      } finally {
        inFlight = false;
        controller = null;
        if (!failed) requestController.abort();
        if (failed && overviewRequest) void overviewRequest.finally(() => controllers.delete(requestController));
        else controllers.delete(requestController);
        if (active) {
          setLoadingKey(null);
          // Every page refreshes automatically. Historical reads keep their
          // exact cursor, so new blocks never move the selected records.
          timer = window.setTimeout(load, failed || incomplete ? 5_000 : 10_000);
        }
      }
    };
    const resume = () => {
      if (!document.hidden && !inFlight) {
        window.clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", resume);
    void load();
    return () => {
      active = false;
      controller?.abort();
      for (const pendingController of controllers) pendingController.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [kind, scope, ready, selection.cursor, selection.pageSize, selectionKey]);

  const navigate = (next: LedgerSelection) => {
    if (!kind) return;
    if (scope === "page") {
      window.history.replaceState({ ...window.history.state, ledger: { kind, selection } }, "");
      window.history.pushState({ ...window.history.state, ledger: { kind, selection: next } }, "", ledgerUrl(next));
      try { window.localStorage.setItem(`jude-explorer-${kind}-page-size:v1`, String(next.pageSize)); } catch { /* Optional preference. */ }
    }
    setSelection(next);
    setError("");
  };
  const data = result?.key === selectionKey ? result.data : null;
  const loading = !ready || (!data && (loadingKey === selectionKey || !error));
  const verifiedPosition = data && Number.isSafeInteger(data.position) && Number(data.position) >= 0
    ? Number(data.position)
    : kind === "blocks" && data?.rows.length && "height" in data.rows[0]
      ? data.anchorHeight - data.rows[0].height : null;
  const verifiedTotal = data && Number.isSafeInteger(data.totalRecords) && Number(data.totalRecords) >= 0
    ? Number(data.totalRecords) : kind === "blocks" && data ? data.anchorHeight + 1 : null;
  const page = verifiedPosition !== null ? Math.floor(verifiedPosition / selection.pageSize) : selection.page;
  // Legacy cursors have no verified record position. Preserve navigation, but
  // never turn a URL's ordinal into an invented total-page claim.
  const totalPages = verifiedPosition !== null && verifiedTotal !== null
    ? Math.max(1, Math.ceil(verifiedTotal / selection.pageSize)) : null;
  const next = () => {
    if (loading || !data?.nextCursor) return;
    navigate({ ...selection, cursor: data.nextCursor, page: page + 1, trail: [...selection.trail, data.nextCursor] });
  };
  const previous = () => {
    if (loading || selection.trail.length <= 1) return;
    const trail = selection.trail.slice(0, -1);
    navigate({ ...selection, cursor: trail.at(-1) ?? null, page: Math.max(0, page - 1), trail });
  };
  const latest = () => {
    if (selection.cursor) navigate({ cursor: null, page: 0, pageSize: selection.pageSize, trail: [null] });
  };
  const changePageSize = (pageSize: number) => navigate({ cursor: null, page: 0, pageSize: validPageSize(pageSize, defaultPageSize), trail: [null] });
  return { kind, data, loading, refreshing: loadingKey === selectionKey, error, page, totalPages, pageSize: selection.pageSize, cursor: selection.cursor, canPrevious: selection.trail.length > 1, next, previous, latest, changePageSize };
}
