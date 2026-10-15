import type { ChainSnapshot, Detail, DetailPending, DetailKind } from "../../explorer-types";
import type { Dispatch, SetStateAction, FormEvent } from "react";
import { useState, useRef, useEffect, useMemo } from "react";
import { feeJude, compact, bytes, difficulty, atomicJude, inOut, utcTimestamp } from "../formatters";
import { IdentifierCell, TxTypeBadge } from "../components/shared";
import { createServiceNodeDetail, type ServiceNodeDetailRecord } from "../service-node-detail";
import { lookupPublicIdentifier, validatePublicSearchTerm } from "../detail-search";

async function readPublicDetail(endpoint: string, signal: AbortSignal, searchResponse?: Response, errorMessage = "Lookup failed") {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = searchResponse ?? await fetch(endpoint, { cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 404 ? "No matching public record was found." : `${errorMessage}. Mainnet data is temporarily unavailable; please try again.`);
    return data;
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new Error("The lookup timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", cancel);
  }
}

export function useDetails({ liveNetwork, serviceNodeHeight, query, setMessage, setSearchLoading, searchScope }: {
  searchScope?: "block" | "transaction";
  liveNetwork: ChainSnapshot["network"] | null;
  serviceNodeHeight: number;
  query: string;
  setMessage: Dispatch<SetStateAction<string>>;
  setSearchLoading: Dispatch<SetStateAction<boolean>>;
}) {

  const [detail, setDetail] = useState<Detail | null>(null);
  const [serviceNodeRecord, setServiceNodeRecord] = useState<ServiceNodeDetailRecord | null>(null);
  const [detailPending, setDetailPending] = useState<DetailPending | null>(null);
  const [detailRenderKey, setDetailRenderKey] = useState(0);
  const detailRequestId = useRef(0);
  const searchRequestId = useRef(0);
  const searchAbortController = useRef<AbortController | null>(null);
  const detailAbortController = useRef<AbortController | null>(null);
  const detailBackdropRef = useRef<HTMLDivElement | null>(null);

  function cancelSearch() {
    searchAbortController.current?.abort();
    searchAbortController.current = null;
    searchRequestId.current += 1;
    setSearchLoading(false);
  }

  function beginDetailRequest(title: string, kind: DetailKind, message: string) {
    cancelSearch();
    detailAbortController.current?.abort();
    const controller = new AbortController();
    detailAbortController.current = controller;
    const requestId = ++detailRequestId.current;
    setDetailPending({ title, kind, message });
    return { requestId, signal: controller.signal };
  }

  function resolveDetailRequest(requestId: number, nextDetail: Detail) {
    if (requestId !== detailRequestId.current) return;
    detailAbortController.current = null;
    setDetail(nextDetail);
    setDetailPending(null);
    setDetailRenderKey((value) => value + 1);
  }

  useEffect(() => {
    if (!detailRenderKey) return;
    const frame = window.requestAnimationFrame(() => {
      detailBackdropRef.current?.scrollTo({ top: 0, behavior: "auto" });
      detailBackdropRef.current?.querySelector<HTMLButtonElement>(".detail-back-button, [aria-label='Close details']")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailRenderKey]);

  async function openBlock(id: number | string, updateHistory = true, searchResponse?: Response) {
    const request = beginDetailRequest("Block Details", "block", "Reading the selected block from the Judecoin mainnet.");
    if (updateHistory) window.history.pushState(window.history.state, "", `#block-${String(id)}`);
    try {
      const data = await readPublicDetail(`/api/block?id=${encodeURIComponent(String(id))}`, request.signal, searchResponse, "Block lookup failed");
      resolveDetailRequest(request.requestId, { title: "Block Details", kind: "block", fullPage: true, rows: [], sections: [
        { kicker: "BLOCK IDENTITY", title: "Header", rows: [
          ...(Number.isInteger(data.height) && data.height >= 0 ? [{ label: "BLOCK HEIGHT", value: compact(data.height) }] : []),
          { label: "BLOCK HASH", value: data.hash },
          { label: "TIMESTAMP", value: utcTimestamp(data.timestamp) },
          { label: "CHAIN STATUS", value: data.orphan ? "Orphaned" : "Main chain" },
        ] },
        { kicker: "PUBLIC CONSENSUS DATA", title: "Consensus", rows: [
          { label: "TRANSACTIONS", value: compact(data.transactions) },
          { label: "BLOCK SIZE", value: bytes(data.size) },
          { label: "DIFFICULTY", value: difficulty(data.difficulty) },
          { label: "BLOCK VERSION (MAJOR / MINOR)", value: `${data.majorVersion}.${data.minorVersion}` },
          { label: "CONFIRMATIONS", value: compact(data.confirmations) },
          { label: "TOTAL BLOCK REWARD", value: `${atomicJude(data.reward)} JUDE` },
        ] },
        { kicker: "BLOCK REWARD RECORD", title: "Block Reward Transaction", rows: [
          { label: "BLOCK REWARD TRANSACTION HASH", value: data.minerTransaction.hash },
          ...(typeof data.minerTransaction.publicKey === "string" && data.minerTransaction.publicKey.trim() ? [{ label: "TRANSACTION PUBLIC KEY", value: data.minerTransaction.publicKey }] : []),
          { label: "TRANSACTION VERSION / TYPE", value: <span className="version-type-value"><code>{String(data.minerTransaction.version)}</code><i aria-hidden="true">/</i><TxTypeBadge type="block-reward" compact iconOnly /></span> },
          { label: "TRANSACTION SIZE", value: bytes(data.minerTransaction.size) },
          ...(data.minerTransaction.ringCtType > 0 ? [{ label: "RINGCT", value: `Yes / type ${data.minerTransaction.ringCtType}` }] : []),
          ...(data.minerTransaction.unlockHeight > 0 ? [{ label: "UNLOCK HEIGHT", value: compact(data.minerTransaction.unlockHeight) }] : []),
          ...(typeof data.minerTransaction.serviceNodeWinner === "string" && data.minerTransaction.serviceNodeWinner.trim() ? [{ label: "SERVICE NODE WINNER", value: data.minerTransaction.serviceNodeWinner }] : []),
        ] },
        { kicker: "CONFIRMED ACTIVITY", title: "Block Transactions", rows: Array.isArray(data.transactionHashes)
          ? data.transactionHashes.length ? data.transactionHashes.map((hash: string, index: number) => ({ label: `TRANSACTION ${compact(index + 1)}`, value: <span className="block-transaction-value"><button type="button" onClick={() => void openTransaction(hash)}>{hash}</button><IdentifierCell value={hash} label="transaction hash" /></span> }))
            : [{ label: "REGULAR TRANSACTIONS", value: "0 — No regular transactions in this block." }]
          : [{ label: "REGULAR TRANSACTIONS", value: "Transaction list unavailable. Please try again." }] },
        ...(typeof data.minerTransaction.extra === "string" && data.minerTransaction.extra.trim() ? [{ kicker: "PROTOCOL PAYLOAD", title: "Extra", rows: [{ label: "EXTRA", value: data.minerTransaction.extra }] }] : []),
      ], outputs: data.minerTransaction.outputs || [], outputTitle: "Block Reward Transaction Outputs", raw: JSON.stringify(data.minerTransaction.raw, null, 2), note: "Block rewards, output keys, and indices are public consensus data. Private wallet addresses and confidential transfer amounts are not requested." });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      resolveDetailRequest(request.requestId, { title: "Block Details", kind: "block", fullPage: true, rows: [{ label: "ERROR", value: error instanceof Error ? error.message : "Lookup failed" }] });
    }
  }

  function closeDetail() {
    cancelSearch();
    detailAbortController.current?.abort();
    detailAbortController.current = null;
    detailRequestId.current += 1;
    setDetailPending(null);
    setDetail(null);
    if (window.location.hash.startsWith("#block-")) window.history.replaceState(window.history.state, "", "#blocks");
    else if (window.location.hash.startsWith("#tx-")) window.history.replaceState(window.history.state, "", "#transactions");
    else if (window.location.hash.startsWith("#node-")) window.history.replaceState(window.history.state, "", "#staking");
  }

  async function openTransaction(hash: string, knownType?: string, updateHistory = true, searchResponse?: Response) {
    const request = beginDetailRequest("Transaction Details", "transaction", "Reading public transaction metadata from the Judecoin mainnet.");
    if (updateHistory) window.history.pushState(window.history.state, "", `#tx-${hash}`);
    try {
      const data = await readPublicDetail(`/api/transaction?hash=${encodeURIComponent(hash)}`, request.signal, searchResponse, "Transaction lookup failed");
      const confirmations = Number.isFinite(data.confirmations) ? data.confirmations : liveNetwork && data.blockHeight ? Math.max(0, liveNetwork.height - data.blockHeight + 1) : 0;
      const feePerKb = data.size > 0 ? data.fee / (data.size / 1000) : 0;

      const transactionType = data.txType || knownType || (data.transactionType === 0 ? "transfer" : "state-change");
      resolveDetailRequest(request.requestId, { title: "Transaction Details", kind: "transaction", fullPage: true, rows: [], sections: [
        { kicker: "IDENTIFIERS", title: "Transaction Identity", rows: [
          { label: "TRANSACTION HASH", value: data.hash },
          ...(typeof data.publicKey === "string" && data.publicKey.trim() ? [{ label: "TRANSACTION PUBLIC KEY", value: data.publicKey }] : []),
          ...(typeof data.paymentId === "string" && data.paymentId.trim() ? [{ label: "PAYMENT ID (ENCRYPTED)", value: data.paymentId }] : []),
        ] },
        { kicker: "PUBLIC ON-CHAIN DATA", title: "Metadata", rows: [
          { label: "BLOCK HEIGHT", value: !data.inPool && Number.isInteger(data.blockHeight) && data.blockHeight >= 0 ? compact(data.blockHeight) : "Pending" },
          { label: "TIMESTAMP", value: data.timestamp ? utcTimestamp(data.timestamp) : "Pending" },
          { label: "TRANSACTION VERSION / TYPE", value: <span className="version-type-value"><code>{String(data.version)}</code><i aria-hidden="true">/</i><TxTypeBadge type={transactionType} compact iconOnly /></span> },
          { label: "TRANSACTION SIZE", value: bytes(data.size) },
          { label: "FEE", value: `${feeJude(data.fee)} JUDE` },
          { label: "FEE RATE (JUDE/kB)", value: `${feeJude(feePerKb)} JUDE` },
          { label: "CONFIRMATIONS", value: compact(confirmations) },
          ...(data.ringCtType > 0 ? [{ label: "RINGCT", value: `Yes / type ${data.ringCtType}` }] : []),
          ...(data.inputs?.length || data.outputs?.length ? [{ label: "INPUTS / OUTPUTS", value: inOut(data.inputs?.length ?? 0, data.outputs?.length ?? 0) }] : []),
          ...(data.unlockTime > 0 ? [{ label: "UNLOCK TIME / HEIGHT", value: compact(data.unlockTime) }] : []),
          { label: "STATUS", value: data.inPool ? "Transaction Pool" : "Confirmed" },
          ...(data.doubleSpendSeen === true ? [{ label: "DOUBLE-SPEND FLAG", value: "Detected" }] : []),
        ] },
        ...(typeof data.extra === "string" && data.extra.trim() ? [{ kicker: "PROTOCOL PAYLOAD", title: "Extra", rows: [{ label: "EXTRA", value: data.extra }] }] : []),
      ], inputs: data.inputs || [], outputs: data.outputs || [], outputTitle: "Transaction Outputs", raw: JSON.stringify(data.raw, null, 2), note: "All values shown are public, read-only chain metadata. Confidential amounts and participant wallet addresses remain hidden by the Judecoin protocol." });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      resolveDetailRequest(request.requestId, { title: "Transaction Details", kind: "transaction", fullPage: true, rows: [{ label: "ERROR", value: error instanceof Error ? error.message : "Lookup failed" }] });
    }
  }

  async function openServiceNode(key: string, updateHistory = true, searchResponse?: Response) {
    const request = beginDetailRequest("Service Node Details", "service-node", "Reading the selected Service Node record from the Judecoin mainnet.");
    if (updateHistory) window.history.pushState(window.history.state, "", `#node-${key}`);
    try {
      const data = await readPublicDetail(`/api/service-node?key=${encodeURIComponent(key)}`, request.signal, searchResponse, "Service-node lookup failed");
      if (request.requestId !== detailRequestId.current) return;
      setServiceNodeRecord(data);
      resolveDetailRequest(request.requestId, createServiceNodeDetail(data, liveNetwork, serviceNodeHeight));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      resolveDetailRequest(request.requestId, { title: "Service Node Details", kind: "service-node", fullPage: true, rows: [{ label: "ERROR", value: error instanceof Error ? error.message : "Lookup failed" }] });
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    cancelSearch();
    const term = query.trim();
    if (typeof searchScope !== "undefined") {
      const identifier = validatePublicSearchTerm(searchScope, term);
      if (!identifier) {
        setMessage(searchScope === "block" ? "Enter a block height or a complete 64-character block hash." : "Enter a complete 64-character transaction hash.");
        return;
      }
      setMessage("");
      if (searchScope === "block") await openBlock(identifier);
      else await openTransaction(identifier);
      return;
    }
    if (!term) {
      setMessage("Enter a block height, block hash, transaction hash, or Service Node public key.");
      return;
    }
    if (/^\d+$/.test(term)) { setMessage(""); void openBlock(Number(term)); return; }
    if (!/^[a-fA-F0-9]{64}$/.test(term)) {
      setMessage("Enter a complete block height or a 64-character public identifier.");
      return;
    }
    const identifier = term.toLowerCase();
    searchAbortController.current?.abort();
    const controller = new AbortController();
    searchAbortController.current = controller;
    const requestId = ++searchRequestId.current;
    setSearchLoading(true);
    setMessage("Searching the public chain…");
    try {
      const match = await lookupPublicIdentifier(identifier, controller.signal);
      if (requestId !== searchRequestId.current || controller.signal.aborted) return;
      if (match) {
        setMessage("");
        if (match.kind === "block") await openBlock(identifier, true, match.response);
        else if (match.kind === "transaction") await openTransaction(identifier, undefined, true, match.response);
        else await openServiceNode(identifier, true, match.response);
        return;
      }
      setMessage("No block, transaction, or Service Node matched that identifier.");
    } catch {
      if (requestId === searchRequestId.current && !controller.signal.aborted) setMessage("Search is temporarily unavailable. Please try again.");
    } finally {
      if (requestId === searchRequestId.current) {
        searchAbortController.current = null;
        setSearchLoading(false);
      }
    }
  }

  useEffect(() => {
    const openHashTarget = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#block-")) void openBlock(hash.slice(7), false);
      else if (hash.startsWith("#tx-")) void openTransaction(hash.slice(4), undefined, false);
      else if (hash.startsWith("#node-")) void openServiceNode(hash.slice(6), false);
      else {
        cancelSearch();
        detailAbortController.current?.abort();
        detailAbortController.current = null;
        detailRequestId.current += 1;
        setDetailPending(null);
        setDetail(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeDetail(); };
    openHashTarget();
    window.addEventListener("popstate", openHashTarget);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      searchRequestId.current += 1;
      detailRequestId.current += 1;
      searchAbortController.current?.abort();
      detailAbortController.current?.abort();
      window.removeEventListener("popstate", openHashTarget);
      window.removeEventListener("keydown", handleKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Subscribe once; detail reads use their arguments and stable refs, not render state.
  }, []);
  const displayedDetail = useMemo(() => detail?.kind === "service-node" && detail.sections && serviceNodeRecord
    ? createServiceNodeDetail(serviceNodeRecord, liveNetwork, serviceNodeHeight)
    : detail, [detail, serviceNodeRecord, liveNetwork, serviceNodeHeight]);
  return { detail: displayedDetail, detailPending, detailRenderKey, detailBackdropRef, openBlock, openTransaction, openServiceNode, closeDetail, search };
}
