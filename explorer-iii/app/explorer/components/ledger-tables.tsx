import type { Block, Transaction } from "../../explorer-types";
import type { useLedgerRefresh } from "../hooks/use-ledger-refresh";
import { compact, atomicJude, inOut } from "../formatters";
import { IdentifierCell, TxTypeBadge } from "./shared";
import { PAGE_SIZE_OPTIONS } from "../constants";

export function LedgerPagination({ ledger, label, latestHref }: {
  ledger: ReturnType<typeof useLedgerRefresh>;
  label: "Blocks" | "Transactions";
  latestHref: string;
}) {
  const { data, loading, error, page, totalPages, pageSize, cursor, canPrevious, previous, next, latest, changePageSize } = ledger;
  return <div className="table-pagination"><div className="pager" role="navigation" aria-label={`${label} pagination`}>
    {cursor && <a className="ledger-latest-link" href={latestHref} aria-label={`Latest ${label.toLowerCase()}`} onClick={(event) => { event.preventDefault(); latest(); }}>{"Latest"}</a>}
    <div className="page-navigation">
      <button type="button" aria-label={`Previous ${label.toLowerCase()} page`} disabled={loading || !canPrevious} onClick={previous}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg><span>{"Prev"}</span></button>
      <span className="page-status" aria-label={totalPages == null ? `${label} pagination ${error ? "unavailable" : "awaiting data"}` : `${label} page ${compact(page + 1)} of ${compact(totalPages)}`} aria-live="polite">{totalPages == null ? <span>{error ? "Unavailable" : "Awaiting data"}</span> : <><span>Page</span><b>{compact(page + 1)}</b><span>of</span><span>{compact(totalPages)}</span></>}</span>
      <button type="button" aria-label={`Next ${label.toLowerCase()} page`} disabled={loading || !data?.hasMore} onClick={next}><span>{"Next"}</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
    </div>
    <label className="page-size-control" title="Rows per page"><span>Rows</span><select aria-label={`${label} rows per page`} value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))}>{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}</select><svg className="page-size-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></label>
  </div></div>;
}

export function BlockRecords({ blocks, openBlock, loadingMessage }: { blocks: Block[]; openBlock: (id: number | string) => void; loadingMessage?: string }) {
  return <div className="table-card blocks-table">
    <div className="table-head"><span>{"HEIGHT"}</span><span>{"AGE [h:m:s]"}</span><span>{"TYPE"}</span><span>{"BLOCK HASH"}</span><span>{"TXS"}</span><span>{"SIZE"}</span><span>{"DIFFICULTY"}</span><span>{"FEE (JUDE)"}</span><span>{"REWARD (JUDE)"}</span><span>{"IN/OUT"}</span></div>
    {blocks.map((block, index) => <div className="table-row block-row-link" key={block.height} role="button" tabIndex={0} aria-label={`Open block ${block.height}`} onClick={() => openBlock(block.height)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openBlock(block.height); } }}>
      <span className="height detail-link"><i>{index === 0 ? "●" : "◆"}</i>{compact(block.height)}</span>
      <span>{block.age}</span><TxTypeBadge type="block-reward" compact iconOnly /><IdentifierCell className="block-hash detail-link" value={block.hash} label="block hash" /><span>{block.txs}</span><span>{block.size}</span><span>{block.difficulty}</span><span>{block.fee == null ? "N/A" : atomicJude(block.fee)}</span><span>{block.reward == null ? "N/A" : atomicJude(block.reward)}</span><span>{inOut(block.inputs, block.outputs)}</span>
    </div>)}
    {loadingMessage && <div className="nodes-loading notranslate" translate="no" role="status">{loadingMessage}</div>}
  </div>;
}

export function TransactionRecords({ transactions, openTransaction, loadingMessage }: { transactions: Transaction[]; openTransaction: (hash: string, knownType?: string) => void; loadingMessage?: string }) {
  return <div className="table-card tx-table">
    <div className="table-head"><span>{"BLOCK"}</span><span>{"AGE [h:m:s]"}</span><span>{"TYPE"}</span><span>{"TRANSACTION HASH"}</span><span>{"SIZE"}</span><span>{"CONFIRMATIONS"}</span><span>{"FEE (JUDE)"}</span><span>{"IN/OUT"}</span></div>
    {transactions.map((tx, index) => <div className="table-row transaction-row-link" key={tx.hash} role="button" tabIndex={0} aria-label={`Open transaction ${tx.hash}`} onClick={() => openTransaction(tx.hash, tx.txType)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openTransaction(tx.hash, tx.txType); } }}>
      <span className="height"><i>{index === 0 ? "●" : "◆"}</i>{compact(tx.block)}</span><span>{tx.age}</span><TxTypeBadge type={tx.txType} compact iconOnly /><IdentifierCell className="tx-hash detail-link" value={tx.hash} label="transaction hash" /><span>{tx.size}</span><span>{tx.confirmations}</span><span>{tx.fee == null ? "N/A" : atomicJude(tx.fee)}</span><span>{inOut(tx.inputs, tx.outputs)}</span>
    </div>)}
    {loadingMessage && <div className="nodes-loading notranslate" translate="no" role="status">{loadingMessage}</div>}
  </div>;
}
