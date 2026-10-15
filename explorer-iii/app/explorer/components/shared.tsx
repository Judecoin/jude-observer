import { compact, hashPreview, jude } from "../formatters";
import { PAGE_SIZE_OPTIONS, TX_TYPE_META } from "../constants";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AwaitingServiceNode } from "../../explorer-types";
import { UiIcon } from "./ui-icons";
import { TxTypeIcon } from "./tx-type-icon";

export function PaginationControls({ page, lastPage, pageSize, onPageChange, onPageSizeChange, onPrefetchPage, disableNext = false, loading = false }: {
  page: number;
  lastPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onPrefetchPage?: (page: number) => void;
  disableNext?: boolean;
  loading?: boolean;
}) {
  return <div className="pager" role="navigation" aria-label="Table pagination">
    <div className="page-navigation">
      <button type="button" aria-label="Previous page" disabled={loading || page === 0} onMouseEnter={() => onPrefetchPage?.(Math.max(0, page - 1))} onFocus={() => onPrefetchPage?.(Math.max(0, page - 1))} onClick={() => onPageChange(Math.max(0, page - 1))}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg><span>{"Prev"}</span></button>
      <span className="page-status" aria-label={`Page ${compact(page + 1)} of ${compact(lastPage + 1)}`} aria-live="polite"><span>{"Page"}</span><b>{compact(page + 1)}</b><span>{"of"}</span><span>{compact(lastPage + 1)}</span></span>
      <button type="button" aria-label="Next page" disabled={loading || disableNext || page >= lastPage} onMouseEnter={() => onPrefetchPage?.(Math.min(lastPage, page + 1))} onFocus={() => onPrefetchPage?.(Math.min(lastPage, page + 1))} onClick={() => onPageChange(Math.min(lastPage, page + 1))}><span>{"Next"}</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
    </div>
    <label className="page-size-control" title={"Rows per page"}>
      <span>{"Rows"}</span>
      <select aria-label={"Rows per page"} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
        {PAGE_SIZE_OPTIONS.map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
      <svg className="page-size-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </label>
  </div>;
}

export function TxTypeBadge({ type, compact = false, iconOnly = false }: { type: string; compact?: boolean; iconOnly?: boolean }) {
  const meta = TX_TYPE_META[type] || TX_TYPE_META["state-change"];
  const label = meta.label;
  return <span className={`tx-type-badge${compact ? " compact" : ""}${iconOnly ? " icon-only" : ""}${meta.icon ? "" : " unclassified"}`} title={label} aria-label={label}>{meta.icon ? <TxTypeIcon type={type} size={compact ? 22 : 28} /> : <span aria-hidden="true">?</span>}{!iconOnly && <b>{label}</b>}</span>;
}

export function IdentifierCell({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  return <span className={`identifier-cell ${className}`} title={value}>
    <span className="identifier-text">{hashPreview(value)}</span>
    <button type="button" className={`copy-identifier ${copyState}`} aria-label={copyState === "copied" ? `${label} copied` : `Copy ${label}`} title={copyState === "copied" ? "Copied" : copyState === "unavailable" ? `Clipboard unavailable. Open details to view the full ${label}.` : `Copy full ${label}`} onKeyDown={(event) => event.stopPropagation()} onClick={async (event) => {
      event.stopPropagation();
      if (resetTimer.current) clearTimeout(resetTimer.current);
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(value);
        setCopyState("copied");
      } catch {
        setCopyState("unavailable");
      }
      resetTimer.current = setTimeout(() => setCopyState("idle"), 2500);
    }}><UiIcon name={copyState === "copied" ? "check" : "copy"} size={14} /></button>
    <span className="sr-only" role="status">{copyState === "copied" ? `${label} copied to clipboard.` : copyState === "unavailable" ? `Clipboard unavailable. Open details to view the full ${label}.` : ""}</span>
  </span>;
}

export function DetailValue({ value }: { value: ReactNode }) {
  return typeof value === "string" || typeof value === "number" ? <code>{value}</code> : <>{value}</>;
}

export function AwaitingContributionsPanel({ nodes, onOpen, home = false }: {
  nodes: AwaitingServiceNode[];
  onOpen: (publicKey: string) => void;
  home?: boolean;
}) {
  return <section className={`awaiting-live${home ? " home-awaiting" : ""}`} aria-label="Service Nodes awaiting contributions">
    <div className="awaiting-live-heading">
      <div>
        <h3>{"Awaiting Contributions"}</h3>
        <p>{"Registered nodes awaiting full funding. Public availability excludes stake reserved to specific contributor addresses."}</p>
      </div>
      <strong className="notranslate" translate="no">{`${compact(nodes.length)} AWAITING`}</strong>
    </div>
    <div className="awaiting-live-table">
      <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"CONTRIBUTED (JUDE)"}</span><span>{"STILL REQUIRED (JUDE)"}</span><span>{"OPEN TO PUBLIC (JUDE)"}</span><span>{"RESERVED REMAINING (JUDE)"}</span><span>{"REGISTRATION HEIGHT"}</span><span>{"LAST REWARD BLOCK"}</span><span>{"UNLOCK STATUS"}</span></div>
      {nodes.map((node) => (
        <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => onOpen(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(node.publicKey); } }}>
          <span className="awaiting-node-status">{"○ AWAITING"}</span>
          <IdentifierCell className="node-key detail-link" value={node.publicKey} label="Service Node public key" />
          <span>{node.contributors}/{node.maxContributors}</span>
          <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
          <span>{jude(node.contributed)}</span>
          <span className="awaiting-required">{jude(node.contributionRequired)}</span>
          <span>{jude(node.contributionOpen)}</span>
          <span>{jude(node.reservedRemaining)}</span>
          <span className="block-height detail-link">{compact(node.registeredAt)}</span>
          <span className="block-height detail-link">{compact(node.lastRewardAt)}</span>
          <span className="no-unlock" title={node.unlockAt > 0 ? `Unlock requested for block ${compact(node.unlockAt)}` : "No unlock requested"}>{node.unlockAt > 0 ? compact(node.unlockAt) : "∞"}</span>
        </div>
      ))}
    </div>
  </section>;
}
