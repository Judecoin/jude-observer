import { compact, hashPreview, jude } from "../formatters";
import { PAGE_SIZE_OPTIONS, TX_TYPE_META } from "../constants";
import type { ReactNode } from "react";
import type { AwaitingServiceNode } from "../../explorer-types";

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
  return <div className="pager">
    <div className="page-navigation">
      <button disabled={loading || page === 0} onMouseEnter={() => onPrefetchPage?.(Math.max(0, page - 1))} onFocus={() => onPrefetchPage?.(Math.max(0, page - 1))} onClick={() => onPageChange(Math.max(0, page - 1))}>← {"Prev"}</button>
      <span>{`Page ${compact(page + 1)} of ${compact(lastPage + 1)}`}</span>
      <button disabled={loading || disableNext || page >= lastPage} onMouseEnter={() => onPrefetchPage?.(Math.min(lastPage, page + 1))} onFocus={() => onPrefetchPage?.(Math.min(lastPage, page + 1))} onClick={() => onPageChange(Math.min(lastPage, page + 1))}>{"Next"} →</button>
    </div>
    <label className="page-size-control" title={"Rows per page"}>
      <span className="sr-only">{"Rows per page"}</span>
      <select aria-label={"Rows per page"} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
        {PAGE_SIZE_OPTIONS.map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
    </label>
  </div>;
}

export function TxTypeBadge({ type, compact = false, iconOnly = false }: { type: string; compact?: boolean; iconOnly?: boolean }) {
  const meta = TX_TYPE_META[type] || TX_TYPE_META["state-change"];
  const label = meta.label;
  return <span className={`tx-type-badge${compact ? " compact" : ""}${iconOnly ? " icon-only" : ""}${meta.icon ? "" : " unclassified"}`} title={label} aria-label={label}>{meta.icon ? <img src={meta.icon} alt="" aria-hidden="true" /> : <span aria-hidden="true">?</span>}{!iconOnly && <b>{label}</b>}</span>;
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
        <p>{"Registered Service Nodes that are not fully funded. Open to public excludes stake already reserved to specific contributor addresses."}</p>
      </div>
      <strong className="notranslate" translate="no">{`${compact(nodes.length)} AWAITING`}</strong>
    </div>
    <div className="awaiting-live-table">
      <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"CONTRIBUTED (JUDE)"}</span><span>{"STILL REQUIRED (JUDE)"}</span><span>{"OPEN TO PUBLIC (JUDE)"}</span><span>{"RESERVED REMAINING (JUDE)"}</span><span>{"REGISTRATION HEIGHT"}</span><span>{"LAST REWARD BLOCK"}</span><span>{"UNLOCK STATUS"}</span></div>
      {nodes.map((node) => (
        <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => onOpen(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(node.publicKey); } }}>
          <span className="awaiting-node-status">{"○ AWAITING"}</span>
          <span className="node-key detail-link">{hashPreview(node.publicKey)}</span>
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
