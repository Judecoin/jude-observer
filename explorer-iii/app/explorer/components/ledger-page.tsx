import type { FormEvent, RefObject } from "react";
import type { Block, BlocksPageSnapshot, Transaction, TransactionsPageSnapshot } from "../../explorer-types";
import type { useLedgerRefresh } from "../hooks/use-ledger-refresh";
import { age, bytes, compact, difficulty } from "../formatters";
import { BlockRecords, LedgerPagination, TransactionRecords } from "./ledger-tables";
import { UiIcon } from "./ui-icons";

type LedgerPageProps = {
  ledger: ReturnType<typeof useLedgerRefresh>;
  blocksOnly: boolean;
  liveHeight: number | null;
  displayNow?: number;
  query: string;
  setQuery: (query: string) => void;
  search: (event: FormEvent) => void;
  searchLoading: boolean;
  message: string;
  searchRef: RefObject<HTMLInputElement | null>;
  openBlock: (id: number | string) => void;
  openTransaction: (hash: string, type?: string) => void;
};

export function LedgerPage({ ledger, blocksOnly, liveHeight, displayNow, query, setQuery, search, searchLoading, message, searchRef, openBlock, openTransaction }: LedgerPageProps) {
  const { data, loading, error } = ledger;
  const blocks: Block[] = blocksOnly ? ((data as BlocksPageSnapshot | null)?.rows ?? []).map((row) => ({ ...row, age: age(row.timestamp, displayNow), size: bytes(row.size), difficulty: difficulty(row.difficulty) })) : [];
  const transactions: Transaction[] = !blocksOnly ? ((data as TransactionsPageSnapshot | null)?.rows ?? []).map((row) => ({ ...row, age: age(row.timestamp, displayNow), size: bytes(row.size), confirmations: Math.max(row.confirmations, (liveHeight ?? data!.height) - row.block + 1) })) : [];
  const title = blocksOnly ? "Blocks" : "Transactions";
  const empty = !loading && !error && data?.rows.length === 0
    ? data.hasMore ? "No transactions in this block range. Continue to older blocks." : "No more confirmed transactions in this history."
    : undefined;
  return <section className="ledger-page shell" aria-label={`${title} explorer`}>
    <header className="ledger-page-header">
      <div><h1>{title}</h1></div>
      <span className="ledger-live-height" aria-live="polite"><span>{"LIVE HEIGHT"}</span><b className="notranslate" translate="no">{liveHeight == null ? "—" : compact(liveHeight)}</b></span>
    </header>
    <form className="search ledger-search" role="search" onSubmit={search}>
      <span className="search-icon"><UiIcon name="search" size={20} /></span>
      <input ref={searchRef} type="search" aria-label={blocksOnly ? "Search by block height or block hash" : "Search by transaction hash"} placeholder={blocksOnly ? "Search by block height or block hash" : "Search by transaction hash"} value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" />
      <button type="submit" disabled={searchLoading}>{searchLoading ? "SEARCHING" : "SEARCH"}<span>→</span></button>
    </form>
    {message && <div className="search-message" role="status">{message}</div>}
    {error && <div className="ledger-error" role="alert"><span>{error}</span></div>}
    {blocksOnly
      ? <BlockRecords blocks={blocks} openBlock={openBlock} loadingMessage={loading ? "Fetching block records…" : undefined} />
      : <TransactionRecords transactions={transactions} openTransaction={openTransaction} loadingMessage={loading ? "Fetching transaction records…" : empty} />}
    {data?.pendingDetails && <p className="ledger-note" role="status">{ledger.refreshing ? "Updating verified block details…" : "Some optional block details are unavailable from the current node."}</p>}
    {data?.scanLimited && <p className="ledger-note">{"This page reached its block range limit. Continue to older blocks to find more transactions."}</p>}
    <LedgerPagination ledger={ledger} label={title} latestHref={blocksOnly ? "/blocks" : "/transactions"} />
  </section>;
}
