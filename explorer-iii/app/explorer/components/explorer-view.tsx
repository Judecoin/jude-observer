import { useEffect, useRef, type CSSProperties } from "react";
import Link from "next/link";
import { NavigationLabel } from "./navigation-label";
import type { useExplorer } from "../use-explorer";
import {
  compact,
  difficulty,
  age,
  bytes,
  hashPreview,
  atomicJude,
  inOut,
  jude,
  serviceNodeUnlockEstimate,
  isBlockHeightLabel,
} from "../formatters";
import { TX_TYPE_LEGEND, JUDE_RELEASE_VERSION, EXPLORER_RELEASE_VERSION } from "../constants";
import { TxTypeBadge, PaginationControls, AwaitingContributionsPanel, DetailValue, IdentifierCell } from "./shared";
import { UiIcon } from "./ui-icons";
import { NetworkOverview } from "./network-visuals";
import { StatNetworkVisual } from "./stat-network-visual";
import { ForkMonitor } from "./fork-monitor";
import { LedgerPage } from "./ledger-page";
import { BlockRecords, LedgerPagination, TransactionRecords } from "./ledger-tables";

export function ExplorerView({ serviceNodeStatus, serviceNodeObservedAt, serviceNodesOnly, statisticsOnly, blocksOnly, transactionsOnly, ledger, homepageBlockLedger, homepageTransactionLedger, homepageBlocks, homepageTransactions, homepageServiceNodePage, homepageServiceNodePageSize, homepageServiceNodeLastPage, setHomepageServiceNodePage, setHomepageServiceNodePageSize, search, query, setQuery, searchLoading, message, connection, liveNetwork, serviceNodes, transactionPool, openTransaction, blockPage, prefetchSnapshot, openBlock, snapshot, activeEnd, awaitingEnd, offlineEnd, statusTotal, activeServiceNodes, unlockingServiceNodes, awaitingServiceNodes, decommissionedServiceNodes, lockedDeregisteredServiceNodeTotal, currentServiceNodeTotal, stakingRatio, stakingRatioWidth, minedSupply, setLifecycleView, lifecycleView, setDeregisteredNodePage, deregisteredTotal, deregisteredIndexedThrough, deregisteredNodes, deregisteredNodePage, deregisteredNodeLastPage, deregisteredNodePageSize, setDeregisteredNodePageSize, serviceNodeHeight, openServiceNode, paginatedDeregisteredNodes, serviceNodeQuery, setServiceNodeQuery, setServiceNodePage, filteredServiceNodes, awaitingServiceNodeRows, paginatedServiceNodes, serviceNodePage, serviceNodeLastPage, serviceNodePageSize, setServiceNodePageSize, latestQuorum, quorumPage, quorums, quorumPageSize, quorumLoading, changeQuorumPage, changeQuorumPageSize, homepageServiceNodes, detailPending, closeDetail, detail, detailBackdropRef, detailRenderKey, displayNow }: ReturnType<typeof useExplorer>) {
  const homeOnly = !serviceNodesOnly && !statisticsOnly && !blocksOnly && !transactionsOnly;
  const ProductTitle = homeOnly ? "h1" : "span";
  const hasOutputUnlock = Boolean(detail?.outputs?.some((output) => Number.isFinite(output.unlockHeight) && output.unlockHeight > 0));
  const particles = Array.from({ length: 24 }, (_, index) => index);
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const searchFocusRequested = useRef(false);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && globalSearchRef.current) {
        event.preventDefault();
        searchFocusRequested.current = Boolean(detail);
        closeDetail();
        if (!detail) globalSearchRef.current.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [closeDetail, detail]);

  useEffect(() => {
    if (!detail && searchFocusRequested.current) {
      searchFocusRequested.current = false;
      globalSearchRef.current?.focus();
    }
  }, [detail]);

  return (
    <main>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="particle-field" aria-hidden="true">
        {particles.map((particle) => <i key={particle} style={{ "--i": particle } as CSSProperties} />)}
      </div>

      <nav className="nav shell" aria-label="Primary navigation">
        <Link prefetch={true} className="brand" href="/" aria-label="Judecoin Explorer home" onClick={closeDetail}>
          <span className="brand-mark"><img src="/judecoin-logo-minimal-ring-transparent.png" alt="" /></span>
          <ProductTitle className="nav-product-title" aria-label="Judecoin Blockchain Explorer"><b>{"Judecoin"}</b>{" "}<span>{"Blockchain Explorer"}</span></ProductTitle>
        </Link>
        <div className="nav-links">
          <Link prefetch={true} className={homeOnly ? "active" : undefined} href="/" aria-label="Home" aria-current={homeOnly ? "page" : undefined} onClick={closeDetail}><NavigationLabel>{"Home"}</NavigationLabel></Link>
          <Link prefetch={true} className={serviceNodesOnly ? "active" : undefined} href="/service-nodes" aria-label="Service Nodes" aria-current={serviceNodesOnly ? "page" : undefined} onClick={closeDetail}><NavigationLabel>{"Service Nodes"}</NavigationLabel></Link>
          <Link prefetch={true} className={statisticsOnly ? "active" : undefined} href="/statistics" aria-label="Statistics" aria-current={statisticsOnly ? "page" : undefined} onClick={closeDetail}><NavigationLabel>{"Statistics"}</NavigationLabel></Link>
          <Link prefetch={true} className={blocksOnly ? "active" : undefined} href="/blocks" aria-label="Blocks" aria-current={blocksOnly ? "page" : undefined} onClick={closeDetail}><NavigationLabel>{"Blocks"}</NavigationLabel></Link>
          <Link prefetch={true} className={transactionsOnly ? "active" : undefined} href="/transactions" aria-label="Transactions" aria-current={transactionsOnly ? "page" : undefined} onClick={closeDetail}><NavigationLabel>{"Transactions"}</NavigationLabel></Link>
        </div>
      </nav>

      <div className="workspace-content" inert={detail ? true : undefined}>
      {homeOnly && <>
      <section className="hero shell" id="top">
        <h2 className="hero-statement"><span>{"Validation"}</span>{" "}<em>{"without surveillance."}</em></h2>
        <p className="hero-manifesto">{"Build it. Verify it. Own it."}</p>
        <p className="hero-copy">{"Privacy is infrastructure. Private value. Public verification. Explore the Judecoin mainnet."}</p>
        <form className="search" role="search" onSubmit={search}>
          <span className="search-icon"><UiIcon name="search" size={20} /></span>
          <input ref={globalSearchRef} type="search" aria-label={"Search the blockchain"} placeholder={"Search by block height, block hash, transaction hash, or node key"} value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" />
          <button type="submit" disabled={searchLoading}>{searchLoading ? "SEARCHING" : "SEARCH"} <span>→</span></button>
        </form>
        {message && <div className="search-message" role="status">{message}</div>}
      </section>

      <NetworkOverview network={liveNetwork} serviceNodes={serviceNodes} snapshot={snapshot} latestQuorum={latestQuorum} connection={connection} displayNow={displayNow} blockPage={blockPage} openBlock={openBlock} openServiceNode={openServiceNode} />

      <ForkMonitor summaryOnly network={liveNetwork} serviceNodes={serviceNodes} observedAt={serviceNodeObservedAt} observationHeight={serviceNodeHeight} connection={connection} displayNow={displayNow} openBlock={openBlock} openServiceNode={openServiceNode} />

      <section className="tx-type-legend shell" aria-label="Transaction type legend">
        <div className="tx-type-legend-title"><span>{"Transaction Type Legend"}</span></div>
        <div className="tx-type-legend-items">{TX_TYPE_LEGEND.map((type) => <TxTypeBadge type={type} key={type} />)}</div>
      </section>

      {Boolean(transactionPool?.available && transactionPool.count) && <section className="stream shell pool-section first-data-section" id="transaction-pool">
        <div className="section-heading pool-heading">
          <div><h2>{"Transaction Pool"}</h2></div>
          <div className="pool-summary"><i />{`${transactionPool!.count} pending`} · {bytes(transactionPool!.totalBytes)}</div>
        </div>
        <div className="table-card pool-table">
          <div className="table-head"><span>{"POOL AGE [h:m:s]"}</span><span>{"TRANSACTION HASH"}</span><span>{"TYPE"}</span><span title="Total fee in JUDE / fee rate in JUDE per 1,000 bytes">{"FEE (JUDE) / RATE (JUDE/kB)"}</span><span>{"IN/OUT"}</span><span>{"SIZE"}</span></div>
          {transactionPool!.transactions.map((transaction) => (
            <div className="table-row transaction-row-link" key={transaction.hash} role="button" tabIndex={0} aria-label={`Open transaction ${transaction.hash}`} onClick={() => openTransaction(transaction.hash, transaction.txType)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openTransaction(transaction.hash, transaction.txType); } }}>
              <span>{transaction.receivedAt > 0 ? age(transaction.receivedAt, displayNow) : "PENDING"}</span>
              <IdentifierCell className="tx-hash detail-link" value={transaction.hash} label="transaction hash" />
              <TxTypeBadge type={transaction.txType} compact iconOnly />
              <span>{`${atomicJude(transaction.fee)} / ${transaction.size > 0 ? atomicJude(transaction.fee / (transaction.size / 1000)) : "N/A"}`}</span>
              <span>{inOut(transaction.inputs, transaction.outputs)}</span>
              <span>{bytes(transaction.size)}</span>
            </div>
          ))}
        </div>
      </section>}

      <section className={`stream shell ${transactionPool?.available && transactionPool.count ? "" : "first-data-section"}`}>
        <div className="section-heading" id="blocks">
          <div><h2>{"Latest Blocks"}</h2></div><Link prefetch={true} className="section-link" href="/blocks">{"VIEW ALL BLOCKS →"}</Link>
        </div>
        <BlockRecords blocks={homepageBlocks} openBlock={openBlock} loadingMessage={!homepageBlockLedger.data ? homepageBlockLedger.error || "Fetching block records…" : undefined} />
        <LedgerPagination ledger={homepageBlockLedger} label="Blocks" latestHref="/#blocks" />
      </section>

      <section className="stream shell" id="transactions">
        <div className="section-heading">
          <div><h2>{"Latest Transactions"}</h2></div><Link prefetch={true} className="section-link" href="/transactions">{"VIEW ALL TRANSACTIONS →"}</Link>
        </div>
        <TransactionRecords transactions={homepageTransactions} openTransaction={openTransaction} loadingMessage={!homepageTransactionLedger.data ? homepageTransactionLedger.error || "Fetching transaction records…" : homepageTransactionLedger.data.rows.length === 0 ? homepageTransactionLedger.data.hasMore ? "No transactions in this block range. Continue to older blocks." : "No more confirmed transactions in this history." : undefined} />
        <LedgerPagination ledger={homepageTransactionLedger} label="Transactions" latestHref="/#transactions" />
      </section>
      </>}

      {(blocksOnly || transactionsOnly) && <LedgerPage ledger={ledger} displayNow={displayNow} blocksOnly={blocksOnly} liveHeight={liveNetwork || ledger.data ? Math.max(liveNetwork?.height ?? 0, ledger.data?.height ?? 0) : null} query={query} setQuery={setQuery} search={search} searchLoading={searchLoading} message={message} searchRef={globalSearchRef} openBlock={openBlock} openTransaction={openTransaction} />}

      {statisticsOnly && <section className="statistics-page shell" id="statistics">
        <header className="statistics-hero">
          <div>
            <h1>{"Network "}<em>{"Statistics"}</em></h1>
            <p>{"Chain activity, Service Node status, staking, and protocol parameters."}</p>
          </div>
          <StatNetworkVisual activeCount={serviceNodes?.active ?? null} connection={connection} />
        </header>

        <div className="statistics-primary-grid">
          <article className="stat-command stat-height"><small>{"CHAIN HEIGHT"}</small><strong className="block-height notranslate" translate="no">{liveNetwork ? compact(liveNetwork.height) : "—"}</strong></article>
          <article className="stat-command"><small>{liveNetwork?.fork?.phase === "activated" ? "CONSENSUS" : "NETWORK HASH RATE"}</small><strong className="notranslate" translate="no">{liveNetwork?.fork?.phase === "activated" ? "Pure PoS" : liveNetwork ? `${(liveNetwork.hashrate / 1e3).toFixed(2)} kH/s` : "—"}</strong></article>
          <article className="stat-command"><small>{"NETWORK DIFFICULTY"}</small><strong className="notranslate" translate="no">{liveNetwork ? difficulty(liveNetwork.difficulty) : "—"}</strong></article>
          <article className="stat-command"><small>{"PENDING TRANSACTIONS"}</small><strong className="notranslate" translate="no">{transactionPool?.available ? compact(transactionPool.count) : "—"}</strong></article>
        </div>

        <ForkMonitor embedded network={liveNetwork} serviceNodes={serviceNodes} observedAt={serviceNodeObservedAt} observationHeight={serviceNodeHeight} connection={connection} displayNow={displayNow} openBlock={openBlock} openServiceNode={openServiceNode} />

        <div className="statistics-dashboard">
          <section className="stats-panel node-health-panel">
            <header><div><h2>{"Service Node Status"}</h2></div></header>
            <div className="node-health-content">
              <div className="status-pie" style={{ background: serviceNodes ? `conic-gradient(#64ffd0 0 ${activeEnd}%, #b58aff ${activeEnd}% ${awaitingEnd}%, #f1b956 ${awaitingEnd}% ${offlineEnd}%, #ef677b ${offlineEnd}% 100%)` : "rgba(22,58,49,.55)" }}>
                <i className="pie-grid" /><i className="pie-sweep" />
                <div className="pie-core"><strong className="notranslate" translate="no">{serviceNodes ? compact(statusTotal) : "—"}</strong><span>{"TOTAL SHOWN"}</span></div>
              </div>
              <div className="status-breakdown">
                <dl className="status-ledger">
                  <div><dt><i className="active-dot" />{"Active"}</dt><dd className="notranslate" translate="no">{serviceNodes ? compact(activeServiceNodes) : "—"}</dd></div>
                  <div title="Unlocking nodes remain included in Active until they leave the current Service Node list"><dt><i className="unlock-dot" />{"Unlocking · included in Active"}</dt><dd className="notranslate" translate="no">{serviceNodes ? compact(unlockingServiceNodes) : "—"}</dd></div>
                  <div><dt><i className="awaiting-dot" />{"Awaiting contributions"}</dt><dd className="notranslate" translate="no">{serviceNodes ? compact(awaitingServiceNodes) : "—"}</dd></div>
                  <div><dt><i className="offline-dot" />{"Decommissioned"}</dt><dd className="notranslate" translate="no">{serviceNodes ? compact(decommissionedServiceNodes) : "—"}</dd></div>
                  <div className="history-entry" title="Deregistered nodes whose stake remains locked on chain"><dt><i className="removed-dot" />{"Deregistered · Stake locked"}</dt><dd className="notranslate" translate="no">{serviceNodes ? compact(lockedDeregisteredServiceNodeTotal) : "—"}</dd></div>
                </dl>
                {serviceNodes ? <p className="status-summary" translate="no"><b>{compact(currentServiceNodeTotal)}</b>{" current + "}<b>{compact(lockedDeregisteredServiceNodeTotal)}</b>{" deregistered with stake still locked. "}<b>{compact(unlockingServiceNodes)}</b>{" unlocking nodes remain included in Active."}</p> : <p className="status-summary">Awaiting a verified snapshot</p>}
              </div>
            </div>
          </section>

          <section className="stats-panel staking-panel">
            <header><div><h2>{"Service Node Staking"}</h2></div></header>
            <div className="stake-total"><span>{"TOTAL SERVICE NODE STAKE"}</span><strong className="notranslate" translate="no">{serviceNodes ? jude(serviceNodes.totalContributed) : "—"} <i>JUDE</i></strong></div>
            <div className={`stake-progress${stakingRatio == null ? " unavailable" : ""}`}><i style={{ width: `${stakingRatioWidth}%` }} /></div>
            <div className="stake-scale"><span>0%</span><b className="notranslate" translate="no">{stakingRatio == null ? "Awaiting a verified ratio" : `${stakingRatio.toFixed(2)}% of total mined supply`}</b><span>100%</span></div>
            <div className="stake-mini-grid">
              <div><small>{"REQUIREMENT"}</small><strong className="notranslate" translate="no">{serviceNodes ? jude(serviceNodes.stakingRequirement) : "—"}</strong><span>{"JUDE / node"}</span></div>
              <div><small>{"TOTAL MINED SUPPLY"}</small><strong className="notranslate" translate="no">{minedSupply == null ? "—" : atomicJude(minedSupply)}</strong><span>{minedSupply == null ? "Awaiting verified supply" : "JUDE"}</span></div>
              <div><small>{"CURRENT SERVICE NODES"}</small><strong className="notranslate" translate="no">{serviceNodes ? compact(serviceNodes.total) : "—"}</strong></div>
              <div><small>{"STAKING RATIO"}</small><strong className="notranslate" translate="no">{stakingRatio == null ? "—" : `${stakingRatio.toFixed(2)}%`}</strong><span>{stakingRatio == null ? "Awaiting a verified ratio" : "Current stake / total mined"}</span></div>
            </div>
          </section>

          <section className="stats-panel chain-pulse-panel">
            <header><div><h2>{"Recent Block Activity"}</h2></div><span>{liveNetwork?.targetVerified === true ? `${liveNetwork.targetSeconds} s target` : "Target unavailable"}</span></header>
            <div className="pulse-timeline" aria-label={"Recent interactive block activity"}>
              <i className="pulse-track" />
              {(snapshot?.blocks || []).slice(0, 5).reverse().map((block, index) => <button key={block.height} className="pulse-node" style={{ "--pulse": `${Math.max(18, Math.min(82, 22 + block.txs * 13))}%`, "--left": `${4 + index * 23}%` } as CSSProperties} onClick={() => openBlock(block.height)} aria-label={`Open block ${block.height}`}>
                <i />
                <span className="pulse-tooltip"><b>{"BLOCK"} {compact(block.height)}</b><em>{`${block.txs} transactions`}</em><em>{bytes(block.size)}</em><em>{`${age(block.timestamp, displayNow)} ago`}</em><small>{"CLICK TO INSPECT →"}</small></span>
              </button>)}
            </div>
            <div className="pulse-footer"><span>{"OLDER"}</span><b className="notranslate" translate="no">{`LATEST · ${compact(snapshot?.blocks[0]?.height ?? 0)}`}</b></div>
          </section>

          <section className="stats-panel protocol-panel">
            <header><div><h2>{"Chain Parameters"}</h2></div></header>
            <dl>
              <div><dt>{"Hard Fork Version"}</dt><dd className="notranslate" translate="no">{liveNetwork ? `v${liveNetwork.hardFork}` : "—"}</dd></div>
              <div><dt>{"Jude Version"}</dt><dd className="notranslate" translate="no">{JUDE_RELEASE_VERSION}</dd></div>
              <div><dt>{"Median Block Weight"}</dt><dd className="notranslate" translate="no">{liveNetwork ? bytes(liveNetwork.blockSizeMedian) : "—"}</dd></div>
              <div><dt>{"Block Weight Limit"}</dt><dd className="notranslate" translate="no">{liveNetwork ? bytes(liveNetwork.blockSizeLimit) : "—"}</dd></div>
            </dl>
          </section>
        </div>

        <section className="stats-panel lifecycle-panel">
          <header><div><h2>{"Service Node Lifecycle"}</h2></div></header>
          <div className="lifecycle-grid">
            <article><TxTypeBadge type="unlock" compact iconOnly /><div><small>{"UNLOCKING"}</small><button className="lifecycle-count notranslate" translate="no" onClick={() => setLifecycleView(lifecycleView === "unlocking" ? null : "unlocking")}>{serviceNodes ? compact(serviceNodes.exiting) : "—"}</button><button className="lifecycle-action" onClick={() => setLifecycleView("unlocking")}>View nodes →</button></div></article>
            <article><TxTypeBadge type="decommission" compact iconOnly /><div><small>{"DECOMMISSIONED"}</small><button className="lifecycle-count notranslate" translate="no" disabled={!decommissionedServiceNodes} onClick={() => setLifecycleView(lifecycleView === "decommissioned" ? null : "decommissioned")}>{serviceNodes ? compact(serviceNodes.decommissioned) : "—"}</button>{decommissionedServiceNodes > 0 ? <button className="lifecycle-action" onClick={() => setLifecycleView("decommissioned")}>View nodes →</button> : null}</div></article>
            <article><TxTypeBadge type="deregistration" compact iconOnly /><div><small>{"DEREGISTRATION RECORDS"}</small><button className="lifecycle-count notranslate" translate="no" onClick={() => { setLifecycleView(lifecycleView === "deregistered" ? null : "deregistered"); setDeregisteredNodePage(0); }}>{compact(deregisteredTotal ?? 0)}</button><span>{`Indexed through block ${compact(deregisteredIndexedThrough ?? 0)}`}</span><button className="lifecycle-action" onClick={() => { setLifecycleView("deregistered"); setDeregisteredNodePage(0); }}>View records →</button></div></article>
          </div>
          {lifecycleView && <div className="lifecycle-details">
            <header><div><h3>{lifecycleView === "unlocking" ? "Nodes pending unlock" : lifecycleView === "decommissioned" ? "Temporarily decommissioned nodes" : "Deregistration records"}</h3></div><div className="lifecycle-header-actions"><button onClick={() => setLifecycleView(null)} aria-label={"Close lifecycle details"}>×</button></div></header>
            <div className={`table-card ${lifecycleView === "unlocking" ? "unlock-detail-table" : lifecycleView === "decommissioned" ? "decommission-detail-table" : "deregistered-table"}`}>
              {lifecycleView === "unlocking" ? <>
                <div className="table-head"><span>{"NODE PUBLIC KEY"}</span><span>{"STAKE"}</span><span>{"REGISTERED BLOCK"}</span><span>{"LAST REWARD BLOCK"}</span><span>{"SCHEDULED UNLOCK BLOCK"}</span><span>{"EST. TIME LEFT"}</span></div>
                {(serviceNodes?.unlockingNodes || []).map((node) => {
                  const currentHeight = Math.max(serviceNodeHeight, liveNetwork?.height ?? 0);
                  const remainingBlocks = Math.max(0, node.unlockAt - currentHeight);
                  const estimate = serviceNodeUnlockEstimate(node.unlockAt, liveNetwork, currentHeight);
                  return <div className="table-row service-node-row-link" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}><IdentifierCell className="node-key detail-link" value={node.publicKey} label="Service Node public key" /><span>{jude(node.contributed)} JUDE</span><span className="block-height detail-link">{compact(node.registeredAt)}</span><span className="block-height detail-link">{compact(node.lastRewardAt)}</span><span className="block-height">{compact(node.unlockAt)}</span><span className="unlock-eta"><b>{estimate?.wait ?? "No current estimate"}</b><small>{`${compact(remainingBlocks)} blocks`}</small>{estimate?.date && <small className="unlock-est-date">{estimate.date}</small>}</span></div>;
                })}
              </> : lifecycleView === "decommissioned" ? <>
                <div className="table-head"><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"DECOMMISSIONS"}</span><span>{"DOWNTIME CREDIT (BLOCKS)"}</span></div>
                {(serviceNodes?.decommissionedNodes || []).map((node) => <div className="table-row service-node-row-link" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}><IdentifierCell className="node-key detail-link" value={node.publicKey} label="Service Node public key" /><span>{node.contributors}/{node.maxContributors}</span><span>{compact(node.decommissionCount)}</span><span>{compact(node.downtimeCredit)} {"blocks"}</span></div>)}
                {serviceNodes && serviceNodes.decommissionedNodes.length === 0 && <div className="lifecycle-empty"><b>0</b><span>{"No service nodes are currently decommissioned."}</span></div>}
              </> : <>
                <div className="table-head"><span>{"NODE PUBLIC KEY"}</span><span>{"STAKE STATUS"}</span><span>{"REGISTERED BLOCK"}</span><span>{"STAKE UNLOCK HEIGHT"}</span><span>{"EST. TIME LEFT"}</span><span>{"EST. UNLOCK (UTC)"}</span></div>
                {paginatedDeregisteredNodes.map((node) => {
                  const currentHeight = Math.max(serviceNodeHeight, liveNetwork?.height ?? 0);
                  const reached = currentHeight > 0 && currentHeight >= node.unlockedAt;
                  const verifiedSchedule = node.unlockHeightVerified === true;
                  const estimate = verifiedSchedule ? serviceNodeUnlockEstimate(node.unlockedAt, liveNetwork, currentHeight) : null;
                  return <div className="table-row service-node-row-link" key={`${node.publicKey}-${node.unlockedAt}`} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}><IdentifierCell className="node-key detail-link" value={node.publicKey} label="Service Node public key" /><span>{reached ? "UNLOCK HEIGHT REACHED" : verifiedSchedule ? "LOCKED" : "HISTORICAL SCHEDULE"}</span><span className="block-height detail-link">{compact(node.registeredAt)}</span><span className="block-height detail-link">{compact(node.unlockedAt)}</span><span className="unlock-eta"><b>{reached ? "Unlock height reached" : estimate?.wait ?? "No current estimate"}</b>{estimate && <small>{`${compact(estimate.remainingBlocks)} blocks`}</small>}</span><span className="unlock-date">{estimate?.date ?? (reached ? "Height reached" : "No current estimate")}</span></div>;
                })}
              </>}
            </div>
            {lifecycleView === "deregistered" && deregisteredNodes.length > 20 && <div className="table-pagination"><PaginationControls page={deregisteredNodePage} lastPage={deregisteredNodeLastPage} pageSize={deregisteredNodePageSize} onPageChange={setDeregisteredNodePage} onPageSizeChange={(size) => { setDeregisteredNodePageSize(size); setDeregisteredNodePage(0); }} /></div>}
            {(lifecycleView === "unlocking" || lifecycleView === "deregistered") && liveNetwork?.targetVerified && <p className="unlock-estimate-note">Estimates use verified unlock heights and the {liveNetwork.targetSeconds}-second target block time reported by the chain. Actual timing varies with block production. Historical schedules without a current verified lock have no expiry estimate.</p>}
          </div>}
        </section>
      </section>}

      {serviceNodesOnly && <section className="staking service-nodes-page shell" id="staking">
        <div className="section-heading">
          <div><h2>{"Service Node Overview"}</h2></div>
        </div>
        <form className="service-node-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <span className="service-node-search-icon"><UiIcon name="search" size={20} /></span>
          <input
            type="search"
            aria-label="Search Service Nodes by public key"
            placeholder="Search by node public key"
            value={serviceNodeQuery}
            onChange={(event) => { setServiceNodeQuery(event.target.value); setServiceNodePage(0); }}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
          />
          {serviceNodeQuery && <button type="button" onClick={() => { setServiceNodeQuery(""); setServiceNodePage(0); }} aria-label="Clear Service Node search">Clear</button>}
          <span className="service-node-search-count notranslate" translate="no">{serviceNodeQuery.trim() ? `RESULTS: ${compact(filteredServiceNodes.length)}` : `TOTAL NODES: ${serviceNodes ? compact(serviceNodes.total) : "—"}`}</span>
        </form>
        <div className="staking-stats">
          <article><small>{"TOTAL SERVICE NODES"}</small><strong className="notranslate" translate="no">{serviceNodes ? compact(serviceNodes.total) : "—"}</strong></article>
          <article><small>{"ACTIVE NODES"}</small><strong className="notranslate" translate="no">{serviceNodes ? compact(serviceNodes.active) : "—"}</strong></article>
          <article><small>{"STAKING REQUIREMENT"}</small><strong className="notranslate" translate="no">{serviceNodes ? jude(serviceNodes.stakingRequirement) : "—"} <i>JUDE</i></strong></article>
          <article><small>{"TOTAL STAKED"}</small><strong className="notranslate" translate="no">{serviceNodes ? jude(serviceNodes.totalContributed) : "—"} <i>JUDE</i></strong></article>
          <article className="unlocking-stat"><small>{"UNLOCKING NODES"}</small><strong className="notranslate" translate="no">{serviceNodes ? compact(serviceNodes.exiting) : "—"}</strong></article>
          <article><small>{"DECOMMISSIONED NODES"}</small><strong className="notranslate" translate="no">{serviceNodes ? compact(serviceNodes.decommissioned) : "—"}</strong></article>
        </div>
        {awaitingServiceNodeRows.length > 0 && <AwaitingContributionsPanel nodes={awaitingServiceNodeRows} onOpen={openServiceNode} />}
        {Boolean(serviceNodes?.decommissionedNodes.length) && (
          <section className="decommissioned-live" aria-label="Temporarily decommissioned service nodes">
            <div className="decommissioned-live-heading">
              <div>
                <h3>{"Temporarily Decommissioned"}</h3>
                <p>{"Funded nodes currently marked as decommissioned by the chain."}</p>
              </div>
              <strong className="notranslate" translate="no">{serviceNodes!.decommissionedNodes.length} {"DECOMMISSIONED"}</strong>
            </div>
            <div className="decommissioned-live-table">
              <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"DECOMMISSIONS"}</span><span>{"LAST UPTIME AGE [h:m:s]"}</span><span>{"DOWNTIME CREDIT (BLOCKS)"}</span></div>
              {serviceNodes!.decommissionedNodes.map((node) => (
                <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}>
                  <TxTypeBadge type="decommission" compact iconOnly />
                  <IdentifierCell className="node-key detail-link" value={node.publicKey} label="Service Node public key" />
                  <span>{node.contributors}/{node.maxContributors}</span>
                  <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
                  <span>{compact(node.decommissionCount)}</span>
                  <span>{node.lastUptimeProof ? age(node.lastUptimeProof, displayNow) : "Not reported"}</span>
                  <span>{compact(node.downtimeCredit)} {"blocks"}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="table-card nodes-table">
          <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"STAKE (JUDE)"}</span><span>{"REGISTRATION HEIGHT"}</span><span title="Sorted by latest reward block height">{"LAST REWARD BLOCK ↓"}</span><span>{"NODE VERSION"}</span></div>
          {paginatedServiceNodes.map((node) => (
            <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}>
              {node.unlocking
                ? <span className="node-unlocking"><TxTypeBadge type="unlock" compact iconOnly /></span>
                : <span className={node.active ? "node-active" : "node-inactive"}>{node.active ? "● ACTIVE" : node.funded ? "○ DECOMMISSIONED" : "○ AWAITING CONTRIBUTIONS"}</span>}
              <IdentifierCell className="node-key detail-link" value={node.publicKey} label="Service Node public key" />
              <span>{node.contributors}/{node.maxContributors}</span>
              <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
              <span>{jude(node.contributed)}</span>
              <span className="block-height detail-link">{compact(node.registeredAt)}</span>
              <span className="block-height detail-link">{compact(node.lastRewardAt)}</span>
              <span>{node.version}</span>
            </div>
          ))}
          {!serviceNodes && <div className="nodes-loading notranslate" translate="no">{serviceNodeStatus === "offline" ? "Service Node data is temporarily unavailable. Retrying automatically." : "Awaiting service node data"}</div>}
          {serviceNodes && filteredServiceNodes.length === 0 && <div className="nodes-loading">No Service Node public key matches this search.</div>}
        </div>
        <div className="table-pagination">
          <PaginationControls
            page={serviceNodePage}
            lastPage={serviceNodeLastPage}
            pageSize={serviceNodePageSize}
            onPageChange={setServiceNodePage}
            onPageSizeChange={(size) => { setServiceNodePageSize(size); setServiceNodePage(0); }}
          />
        </div>
      </section>}

      {homeOnly && <>
      <section className="staking home-service-nodes shell" id="home-service-nodes">
        <div className="section-heading">
          <div><h2>{"Latest Service Nodes"}</h2></div>
          <a className="section-link" href="/service-nodes">{"VIEW ALL SERVICE NODES →"}</a>
        </div>
        {awaitingServiceNodeRows.length > 0 && <AwaitingContributionsPanel nodes={awaitingServiceNodeRows} onOpen={openServiceNode} home />}
        {Boolean(serviceNodes?.decommissionedNodes.length) && (
          <section className="decommissioned-live home-decommissioned" aria-label="Temporarily decommissioned service nodes">
            <div className="decommissioned-live-heading">
              <div>
                <h3>{"Temporarily Decommissioned"}</h3>
                <p>{"Funded nodes currently marked as decommissioned by the chain."}</p>
              </div>
              <strong className="notranslate" translate="no">{serviceNodes!.decommissionedNodes.length} {"DECOMMISSIONED"}</strong>
            </div>
            <div className="decommissioned-live-table">
              <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"DECOMMISSIONS"}</span><span>{"LAST UPTIME AGE [h:m:s]"}</span><span>{"DOWNTIME CREDIT (BLOCKS)"}</span></div>
              {serviceNodes!.decommissionedNodes.map((node) => (
                <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}>
                  <TxTypeBadge type="decommission" compact iconOnly />
                  <IdentifierCell className="node-key detail-link" value={node.publicKey} label="Service Node public key" />
                  <span>{node.contributors}/{node.maxContributors}</span>
                  <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
                  <span>{compact(node.decommissionCount)}</span>
                  <span>{node.lastUptimeProof ? age(node.lastUptimeProof, displayNow) : "Not reported"}</span>
                  <span>{compact(node.downtimeCredit)} {"blocks"}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="table-card nodes-table">
          <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"STAKE (JUDE)"}</span><span>{"REGISTRATION HEIGHT"}</span><span title="Sorted by latest reward block height">{"LAST REWARD BLOCK ↓"}</span><span>{"NODE VERSION"}</span></div>
          {homepageServiceNodes.map((node) => (
            <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}>
              {node.unlocking
                ? <span className="node-unlocking"><TxTypeBadge type="unlock" compact iconOnly /></span>
                : <span className={node.active ? "node-active" : "node-inactive"}>{node.active ? "● ACTIVE" : node.funded ? "○ DECOMMISSIONED" : "○ AWAITING CONTRIBUTIONS"}</span>}
              <IdentifierCell className="node-key detail-link" value={node.publicKey} label="Service Node public key" />
              <span>{node.contributors}/{node.maxContributors}</span>
              <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
              <span>{jude(node.contributed)}</span>
              <span className="block-height detail-link">{compact(node.registeredAt)}</span>
              <span className="block-height detail-link">{compact(node.lastRewardAt)}</span>
              <span>{node.version}</span>
            </div>
          ))}
          {!serviceNodes && <div className="nodes-loading notranslate" translate="no">{serviceNodeStatus === "offline" ? "Service Node data is temporarily unavailable. Retrying automatically." : "Awaiting service node data"}</div>}
        </div>
        <div className="table-pagination">
          <PaginationControls page={homepageServiceNodePage} lastPage={homepageServiceNodeLastPage} pageSize={homepageServiceNodePageSize} loading={!serviceNodes} onPageChange={setHomepageServiceNodePage} onPageSizeChange={(size) => { setHomepageServiceNodePageSize(size); setHomepageServiceNodePage(0); }} />
        </div>
      </section>

      <section className="quorum-section shell" id="quorums">
        <div className="section-heading quorum-heading">
          <div><h2>{"Service Node Testing Quorums"}</h2></div>
        </div>
        <div className={`quorum-console quorum-summary-console${latestQuorum ? " has-sample" : " awaiting-sample"}`}>
          <div className="quorum-overview">
            <div className="quorum-summary-copy">
              
              <p>{"Validators and nodes assigned for testing at each sampled height. Checkpoint, Blink, and Pulse quorums are not shown."}</p>
            </div>
            <div className="quorum-metrics">
              <article><small>{"SAMPLE BLOCK"}</small><strong className="block-height notranslate" translate="no">{latestQuorum ? compact(latestQuorum.height) : "—"}</strong></article>
              <article><small>{"VALIDATORS"}</small><strong className="notranslate" translate="no">{latestQuorum ? latestQuorum.validators.length : "—"}</strong></article>
              <article><small>{"NODES UNDER TEST"}</small><strong className="notranslate" translate="no">{latestQuorum ? latestQuorum.workers.length : "—"}</strong></article>
            </div>
          </div>
        </div>
        <div className="quorum-ledger">
          <div className="quorum-ledger-head"><span>{quorumPage === 0 ? "RECENT TESTING QUORUMS" : "HISTORICAL TESTING QUORUMS"}</span></div>
          {(quorums?.records || []).map((record, index) => (
            <details className="quorum-record" key={record.height}>
              <summary>
                <span className="quorum-index">{String(quorumPage * quorumPageSize + index + 1).padStart(2, "0")}</span>
                <span className="block-height quorum-height">{compact(record.height)}</span>
                <span><b>{record.validators.length}</b> {"validators"}</span><span><b>{record.workers.length}</b> {"nodes under test"}</span><i className="quorum-toggle"><span className="expand-label">{"EXPAND MATRIX →"}</span><span className="collapse-label">{"COLLAPSE MATRIX ↑"}</span></i>
              </summary>
              <div className="committee-matrix">
                <div><header><span>{"VALIDATOR QUORUM"}</span><b>{record.validators.length}</b></header><div className="key-matrix">{record.validators.map((key, keyIndex) => <button key={key} className="detail-link quorum-key" onClick={() => openServiceNode(key)}><i>V{String(keyIndex + 1).padStart(2, "0")}</i>{hashPreview(key)}</button>)}</div></div>
                <div><header><span>{"NODES UNDER TEST"}</span><b>{record.workers.length}</b></header><div className="key-matrix worker-matrix">{record.workers.map((key, keyIndex) => <button key={key} className="detail-link quorum-key" onClick={() => openServiceNode(key)}><i>N{String(keyIndex + 1).padStart(2, "0")}</i>{hashPreview(key)}</button>)}</div></div>
              </div>
            </details>
          ))}
          {!quorums?.records.length && <div className="nodes-loading notranslate" translate="no">{quorums ? "0 QUORUM RECORDS" : "Awaiting quorum records"}</div>}
        </div>
        <div className="table-pagination">
          <PaginationControls page={quorumPage} lastPage={liveNetwork ? Math.min(10000, Math.floor(liveNetwork.height / quorumPageSize)) : 0} pageSize={quorumPageSize} loading={quorumLoading} onPageChange={(page) => void changeQuorumPage(page)} onPageSizeChange={changeQuorumPageSize} onPrefetchPage={(page) => prefetchSnapshot({ quorumPage: page })} disableNext={Boolean(quorums && !quorums.hasOlder)} />
        </div>
        {quorums?.truncated && <div className="nodes-loading">{"Older quorum history exists. Select a larger page size to reach earlier heights."}</div>}
      </section>

      <section className="privacy-panel shell">
        <div className="privacy-hologram" aria-label={"Animated Judecoin privacy shield"}>
          <div className="holo-stage">
            <i className="holo-grid" />
            <i className="holo-beam" />
            <i className="holo-orbit holo-orbit-a" />
            <i className="holo-orbit holo-orbit-b" />
            <i className="holo-orbit holo-orbit-c" />
            <i className="holo-node holo-node-a" />
            <i className="holo-node holo-node-b" />
            <i className="holo-node holo-node-c" />
            <div className="holo-core">
              <span className="holo-scan" />
              <img src="/judecoin-j-logo.png" alt="Judecoin" />
            </div>
          </div>
        </div>
        <div><h2>{"Built for privacy."}<br />{"Open to verification."}</h2></div>
        <div className="privacy-grid">
          <article><b aria-hidden="true">◉</b><span><strong>{"Private payments"}</strong><small>{"Explore transfers without exposing the participants."}</small></span></article>
          <article><b aria-hidden="true">◌</b><span><strong>{"Confidential amounts"}</strong><small>{"Follow activity without revealing transfer values."}</small></span></article>
          <article><b aria-hidden="true">◇</b><span><strong>{"Verifiable consensus"}</strong><small>{"Explore blocks and the nodes securing Judecoin."}</small></span></article>
        </div>
      </section>


      </>}

      <footer className="shell explorer-footer"><a className="brand" href="https://judeblock.io/" aria-label="Judecoin Blockchain Explorer home" onClick={closeDetail}><span className="brand-mark"><img src="/judecoin-logo-minimal-ring-transparent.png" alt="" /></span><span><b>{"Judecoin"}</b>{" "}<small>{"Blockchain Explorer"}</small></span></a><div className="footer-meta"><a className="footer-github" href="https://github.com/judecoin" target="_blank" rel="noreferrer" aria-label="Judecoin on GitHub" title="Judecoin on GitHub"><svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a><span className="footer-version"><span>{"Core release"}</span>{" "}<b>{JUDE_RELEASE_VERSION}</b></span><span className="footer-version"><span>{"Network protocol"}</span><b>{liveNetwork ? `v${liveNetwork.hardFork}` : "—"}</b></span><span className="footer-version"><span>{"Explorer"}</span><b>{EXPLORER_RELEASE_VERSION}</b></span></div></footer>

      </div>

      {detailPending && <div className="detail-request-status" aria-live="polite" aria-atomic="true">
        <div className="detail-request-card">
          <span className={`detail-request-mark ${detailPending.kind}`} aria-hidden="true"><i /></span>
          <span className="detail-request-copy"><small>{"LIVE MAINNET QUERY"}</small><strong>{detailPending.title}</strong><em>{detailPending.message}</em></span>
          <button type="button" onClick={closeDetail} aria-label={"Cancel detail request"}>×</button>
        </div>
      </div>}
      {detail && <div ref={detailBackdropRef} className={detail.fullPage ? "detail-backdrop detail-page-backdrop" : "detail-backdrop"} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
        <div key={detailRenderKey} className={detail.fullPage ? `detail-modal detail-page detail-resolved${detail.kind ? ` ${detail.kind}-detail-page` : ""}` : "detail-modal detail-resolved"} role="dialog" aria-modal={detail.fullPage ? undefined : true} aria-labelledby="detail-title">
          <header><div>{detail.fullPage && <button className="detail-back-button" aria-label={"Back"} onClick={closeDetail}>← {"Back"}</button>}<h2 id="detail-title">{detail.title}</h2></div>{!detail.fullPage && <button aria-label={"Close details"} onClick={closeDetail}>×</button>}</header>
          {detail.sections ? <div className="detail-sections">{detail.sections.map((section) => <section className="detail-section" key={section.title}><div className="detail-subheading"><h3>{section.title}</h3></div><dl>{section.rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd className={isBlockHeightLabel(row.label) ? "block-height" : undefined}><DetailValue value={row.value} /></dd></div>)}</dl></section>)}</div> : <div className="detail-grid">{detail.rows.map((row) => <div key={row.label}><small>{row.label}</small><DetailValue value={row.value} /></div>)}</div>}
          {detail.outputs && detail.outputs.length > 0 && <section className="detail-outputs"><div className="detail-subheading"><h3>{detail.outputTitle || "Transaction Outputs"}</h3></div><div className={`detail-output-table${hasOutputUnlock ? "" : " no-output-unlock"}`}><div className="detail-output-head"><span>#</span><span>{"OUTPUT KEY"}</span><span>{"AMOUNT"}</span>{hasOutputUnlock && <span>{"UNLOCK TIME / HEIGHT"}</span>}</div>{detail.outputs.map((output) => <div className="detail-output-row" key={`${output.index}-${output.key}`}><span>{output.index}</span><code>{output.key}</code><strong className={output.confidential ? "private-amount" : undefined}>{output.confidential ? "Confidential" : output.amount == null ? "Not reported" : `${atomicJude(output.amount)} JUDE`}</strong>{hasOutputUnlock && <span className="block-height">{output.unlockHeight > 0 ? compact(output.unlockHeight) : "—"}</span>}</div>)}</div></section>}
          {detail.inputs && detail.inputs.length > 0 && <section className="detail-inputs"><div className="detail-subheading"><h3>{`Inputs (${detail.inputs.length})`}</h3></div><div className="detail-input-list">{detail.inputs.map((input) => <article key={`${input.index}-${input.keyImage}`}><header><span>{`INPUT ${input.index}`}</span><TxTypeBadge type={input.type === "coinbase" ? "block-reward" : "transfer"} compact iconOnly /></header><dl className="input-summary">{input.keyImage && <div><dt>{"KEY IMAGE"}</dt><dd><code>{input.keyImage}</code></dd></div>}{input.type !== "coinbase" && <div><dt>{"AMOUNT"}</dt><dd className={input.amount ? undefined : "private-amount"}>{input.amount ? `${atomicJude(input.amount)} JUDE` : "Confidential"}</dd></div>}{input.ringSize > 0 && <div><dt>{"RING SIZE"}</dt><dd>{input.ringSize}</dd></div>}</dl>{input.ringSize > 0 && <div className="ring-members"><div className="ring-head"><span>#</span><span>{"RING MEMBER / OUTPUT KEY"}</span><span>{"SOURCE TX HASH"}</span><span>{"BLOCK HEIGHT"}</span></div>{(input.ringMembers?.length ? input.ringMembers : (input.keyOffsets || []).map((offset) => ({ index: offset, outputKey: "", transactionHash: "", blockHeight: 0, unlocked: false }))).map((member, memberIndex) => <div className="ring-row" key={`${input.index}-${member.index}-${memberIndex}`}><span>{memberIndex}</span><code>{member.outputKey || `Output index ${compact(member.index)}`}</code><span>{member.transactionHash ? <button className="detail-link link" onClick={() => openTransaction(member.transactionHash)}>{hashPreview(member.transactionHash)}</button> : "Unavailable from node"}</span><span>{member.blockHeight ? <button className="detail-link block-height" onClick={() => openBlock(member.blockHeight)}>{compact(member.blockHeight)}</button> : "N/A"}</span></div>)}</div>}</article>)}</div></section>}
          {detail.raw && <details className="raw-details"><summary>{detail.kind === "service-node" ? "Show Raw Service Node Data" : detail.kind === "block" ? "Show Raw Block Data" : "Show Raw Transaction Data"}</summary><pre>{detail.raw}</pre></details>}
          <p>{detail.note || "Only public chain data is displayed."}</p>
        </div>
      </div>}
    </main>
  );
}
