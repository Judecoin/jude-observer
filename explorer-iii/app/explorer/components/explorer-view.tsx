import type * as React from "react";
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
  estimatedBlockWait,
  isBlockHeightLabel,
} from "../formatters";
import { TX_TYPE_LEGEND } from "../constants";
import { TxTypeBadge, PaginationControls, AwaitingContributionsPanel, DetailValue } from "./shared";

export function ExplorerView({ particles, serviceNodesOnly, statisticsOnly, openSection, search, query, setQuery, searchLoading, message, connection, liveNetwork, serviceNodes, transactionPool, openTransaction, blockPage, blockPageSize, setBlockPage, setBlockPageSize, prefetchSnapshot, blocks, openBlock, snapshot, blocksSelectionMatches, transactionPage, transactionPageSize, setTransactionPage, setTransactionPageSize, transactions, transactionsSelectionMatches, activeEnd, awaitingEnd, offlineEnd, statusTotal, activeServiceNodes, unlockingServiceNodes, awaitingServiceNodes, decommissionedServiceNodes, lockedDeregisteredServiceNodeTotal, currentServiceNodeTotal, stakingRatio, stakingRatioWidth, minedSupply, setLifecycleView, lifecycleView, setDeregisteredNodePage, deregisteredTotal, deregisteredIndexedThrough, deregisteredNodes, deregisteredNodePage, deregisteredNodeLastPage, deregisteredNodePageSize, setDeregisteredNodePageSize, serviceNodeHeight, openServiceNode, paginatedDeregisteredNodes, serviceNodeQuery, setServiceNodeQuery, setServiceNodePage, filteredServiceNodes, awaitingServiceNodeRows, paginatedServiceNodes, serviceNodePage, serviceNodeLastPage, serviceNodePageSize, setServiceNodePageSize, latestQuorum, quorumPage, quorums, quorumPageSize, quorumLoading, changeQuorumPage, changeQuorumPageSize, homepageServiceNodes, detailPending, closeDetail, detail, detailBackdropRef, detailRenderKey }: ReturnType<typeof useExplorer>) {

  return (
    <main>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="particle-field" aria-hidden="true">
        {particles.map((particle) => <i key={particle} style={{ "--i": particle } as React.CSSProperties} />)}
      </div>

      <nav className="nav shell">
        <a className="brand" href="/" aria-label="Judecoin Explorer home">
          <span className="brand-mark"><img src="/judecoin-logo-minimal-ring-transparent.png" alt="" /></span>
          <span><b>JUDECOIN</b></span>
        </a>
        <div className="nav-links">
          <a className={!serviceNodesOnly && !statisticsOnly ? "active" : undefined} href="/">{"Home"}</a>
          <a className={serviceNodesOnly ? "active" : undefined} href="/service-nodes">{"Service Nodes"}</a>
          <a className={statisticsOnly ? "active" : undefined} href="/statistics">{"Statistics"}</a>
          <button type="button" onClick={() => openSection("blocks")}>{"Blocks"}</button>
          <button type="button" onClick={() => openSection("transactions")}>{"Transactions"}</button>
          <button type="button" onClick={() => openSection("quorums")}>{"Quorums"}</button>
        </div>
      </nav>

      {!serviceNodesOnly && !statisticsOnly && <>
      <section className="hero shell" id="top">
        <h1>{"See the chain"}<br /><em>{"Not the people"}</em></h1>
        <p className="hero-copy">{"A privacy-first window into the Judecoin network. Inspect public blocks, transactions, Service Nodes, and consensus data, while the participants, addresses, and amounts of private transfers remain hidden."}</p>
        <form className="search" onSubmit={search}>
          <span className="search-icon">⌕</span>
          <input aria-label={"Search the blockchain"} placeholder={"Search by block height, block hash, transaction hash, or node key"} value={query} onChange={(event) => setQuery(event.target.value)} />
          <button disabled={searchLoading}>{searchLoading ? "SEARCHING" : "EXPLORE"} <span>→</span></button>
        </form>
        {message && <div className="search-message" role="status">{message}</div>}
        <div className="privacy-note"><span>◉</span><p><b>{"Privacy preserved."}</b> {"Private transfer data remains hidden. Public Service Node registration fields are shown only when they are part of the protocol's public state."}</p></div>
      </section>

      <section className="metrics shell" id="network" aria-busy={connection === "loading"}>
        <span className="sr-only" role="status" aria-live="polite">{connection === "live" ? "Live Judecoin mainnet values verified." : "Displaying zero or the last verified values while the mainnet refresh completes."}</span>
        <article><small>{"CHAIN HEIGHT"}</small><strong className="block-height notranslate" translate="no">{liveNetwork ? compact(liveNetwork.height) : "0"}</strong><span className={connection === "live" && liveNetwork?.synced ? "trend" : undefined}>{!liveNetwork ? "No verified snapshot · initial values" : connection !== "live" ? "Last verified mainnet snapshot" : liveNetwork.synced ? "Mainnet · synced" : "Mainnet · delayed"}</span></article>
        <article><small>{"NETWORK HASH RATE"}</small><strong className="notranslate" translate="no">{(liveNetwork?.hashrate ? liveNetwork.hashrate / 1e3 : 0).toFixed(2)} <i>kH/s</i></strong><span>{"Estimated from difficulty and target time"}</span></article>
        <article><small>{"NETWORK DIFFICULTY"}</small><strong className="notranslate" translate="no">{liveNetwork ? difficulty(liveNetwork.difficulty) : "0"}</strong><span>{"Reported by the protocol"}</span></article>
        <article><small>{"TARGET BLOCK TIME"}</small><strong className="notranslate" translate="no">{liveNetwork?.targetSeconds ?? 0} <i>{"sec"}</i></strong><span>{"Protocol target"}</span></article>
        <article><small>{"LATEST BLOCK AGE"}</small><strong className="notranslate" translate="no">{liveNetwork ? age(liveNetwork.latestBlockTimestamp) : "0"}</strong><span className={liveNetwork?.synced ? "trend" : undefined}>{"Time since latest block"}</span></article>
        <article><small>{"SERVICE NODES"}</small><strong className="notranslate" translate="no">{compact(serviceNodes?.active ?? 0)}</strong><span>{"Active on mainnet"}</span></article>
        <article className="block-size-card">
          <div className="block-size-heading"><small>{"BLOCK SIZE"}</small>{liveNetwork && liveNetwork.blockSizeLimit > 0 && <b className="block-size-ratio">{`${((liveNetwork.blockSizeMedian / liveNetwork.blockSizeLimit) * 100).toFixed(1)}%`}</b>}</div>
          <strong className="block-size-value notranslate" translate="no">{liveNetwork ? bytes(liveNetwork.blockSizeMedian) : "0 B"}</strong>
          {liveNetwork && <span className="block-size-limit">{`Limit ${bytes(liveNetwork.blockSizeLimit)}`}</span>}
          <span className="block-size-caption">{"Median / protocol limit"}</span>
        </article>
        <article><small>{"PROTOCOL VERSION"}</small><strong className="notranslate" translate="no">{liveNetwork?.protocol ?? "0"}</strong><span>{`Hard fork v${liveNetwork?.hardFork ?? 0}`}</span></article>
      </section>

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
          <div className="table-head"><span>{"AGE"}</span><span>{"TRANSACTION HASH"}</span><span>{"TX TYPE"}</span><span>{"FEE / PER KB"}</span><span>{"IN/OUT"}</span><span>{"TX SIZE"}</span></div>
          {transactionPool!.transactions.map((transaction) => (
            <div className="table-row transaction-row-link" key={transaction.hash} role="button" tabIndex={0} aria-label={`Open transaction ${transaction.hash}`} onClick={() => openTransaction(transaction.hash, transaction.txType)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openTransaction(transaction.hash, transaction.txType); } }}>
              <span>{transaction.receivedAt > 0 ? age(transaction.receivedAt) : "PENDING"}</span>
              <span className="tx-hash detail-link">{hashPreview(transaction.hash)}</span>
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
          <div><h2>{"Latest Blocks"}</h2></div>
          <PaginationControls page={blockPage} lastPage={liveNetwork ? Math.floor(liveNetwork.height / blockPageSize) : 0} pageSize={blockPageSize} onPageChange={setBlockPage} onPageSizeChange={(size) => { setBlockPageSize(size); setBlockPage(0); }} onPrefetchPage={(page) => prefetchSnapshot({ blockPage: page })} />
        </div>
        <div className="table-card blocks-table">
          <div className="table-head"><span>{"HEIGHT"}</span><span>{"AGE [h:m:s]"}</span><span>{"TYPE"}</span><span>{"BLOCK HASH"}</span><span>{"TXS"}</span><span>{"SIZE"}</span><span>{"DIFFICULTY"}</span><span>{"FEE (JUDE)"}</span><span>{"REWARD (JUDE)"}</span><span>{"IN/OUT"}</span></div>
          {blocks.map((block, index) => (
            <div className="table-row block-row-link" key={block.height} role="button" tabIndex={0} aria-label={`Open block ${block.height}`} onClick={() => openBlock(block.height)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openBlock(block.height); } }}>
              <span className="height detail-link"><i>{index === 0 ? "●" : "◆"}</i>{compact(block.height)}</span>
              <span>{block.age}</span><TxTypeBadge type="block-reward" compact iconOnly /><span className="block-hash detail-link">{hashPreview(block.hash)}</span><span>{block.txs}</span><span>{block.size}</span><span>{block.difficulty}</span><span>{block.fee == null ? "N/A" : atomicJude(block.fee)}</span><span>{block.reward == null ? "N/A" : atomicJude(block.reward)}</span><span>{inOut(block.inputs, block.outputs)}</span>
            </div>
          ))}
          {(!snapshot || !blocksSelectionMatches) && <div className="nodes-loading notranslate" translate="no">{"0 BLOCK RECORDS · No verified snapshot for this page yet"}</div>}
        </div>
      </section>

      <section className="stream shell" id="transactions">
        <div className="section-heading">
          <div><h2>{"Latest Transactions"}</h2></div>
          <div className="heading-actions"><PaginationControls page={transactionPage} lastPage={liveNetwork && snapshot ? Math.floor(liveNetwork.height / snapshot.pagination.transactionScanSize) : 0} pageSize={transactionPageSize} onPageChange={setTransactionPage} onPageSizeChange={(size) => { setTransactionPageSize(size); setTransactionPage(0); }} onPrefetchPage={(page) => prefetchSnapshot({ transactionPage: page })} /></div>
        </div>
        <div className="table-card tx-table">
          <div className="table-head"><span>{"BLOCK"}</span><span>{"AGE [h:m:s]"}</span><span>{"TYPE"}</span><span>{"TRANSACTION HASH"}</span><span>{"SIZE"}</span><span>{"CONFIRMATIONS"}</span><span>{"FEE (JUDE)"}</span><span>{"IN/OUT"}</span></div>
          {transactions.map((tx, index) => (
            <div className="table-row transaction-row-link" key={tx.hash} role="button" tabIndex={0} aria-label={`Open transaction ${tx.hash}`} onClick={() => openTransaction(tx.hash, tx.txType)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openTransaction(tx.hash, tx.txType); } }}>
              <span className="height"><i>{index === 0 ? "●" : "◆"}</i>{compact(tx.block)}</span><span>{tx.age}</span><TxTypeBadge type={tx.txType} compact iconOnly /><span className="tx-hash detail-link">{hashPreview(tx.hash)}</span><span>{tx.size}</span><span>{tx.confirmations}</span><span>{tx.fee == null ? "N/A" : atomicJude(tx.fee)}</span><span>{inOut(tx.inputs, tx.outputs)}</span>
            </div>
          ))}
          {(!snapshot || !transactionsSelectionMatches) && <div className="nodes-loading notranslate" translate="no">{"0 TRANSACTION RECORDS · No verified snapshot for this page yet"}</div>}
        </div>
      </section>
      </>}

      {statisticsOnly && <section className="statistics-page shell" id="statistics">
        <header className="statistics-hero">
          <div>
            <h1>{"Judecoin network,"}<br /><em>{"at a glance."}</em></h1>
            <p>{"Explore Judecoin blocks, transactions, Service Nodes, staking, and network activity in one place."}</p>
          </div>
          <div className="network-reactor" aria-label={`${serviceNodes?.active ?? 0} active service nodes`}>
            <i className="reactor-grid" /><i className="reactor-beam" /><i className="reactor-base" />
            <div className="reactor-cube"><i className="cube-front" /><i className="cube-back" /><i className="cube-left" /><i className="cube-right" /><i className="cube-top" /><i className="cube-bottom" /></div>
            <i className="reactor-ring ring-one" /><i className="reactor-ring ring-two" /><i className="reactor-ring ring-three" />
            {Array.from({ length: 8 }, (_, index) => <i className="reactor-particle" key={index} style={{ "--particle": index } as React.CSSProperties} />)}
            <div className="reactor-value"><strong className="notranslate" translate="no">{compact(serviceNodes?.active ?? 0)}</strong><span>ACTIVE SERVICE NODES</span></div>
          </div>
        </header>

        <div className="statistics-primary-grid">
          <article className="stat-command stat-height"><small>{"CHAIN HEIGHT"}</small><strong className="block-height notranslate" translate="no">{compact(liveNetwork?.height ?? 0)}</strong></article>
          <article className="stat-command"><small>{"NETWORK HASH RATE"}</small><strong className="notranslate" translate="no">{`${((liveNetwork?.hashrate ?? 0) / 1e3).toFixed(2)} kH/s`}</strong></article>
          <article className="stat-command"><small>{"NETWORK DIFFICULTY"}</small><strong className="notranslate" translate="no">{liveNetwork ? difficulty(liveNetwork.difficulty) : "0"}</strong></article>
          <article className="stat-command"><small>{"PENDING TRANSACTIONS"}</small><strong className="notranslate" translate="no">{compact(transactionPool?.available ? transactionPool.count : 0)}</strong></article>
        </div>

        <div className="statistics-dashboard">
          <section className="stats-panel node-health-panel">
            <header><div><h2>{"Service Node Status"}</h2></div></header>
            <div className="node-health-content">
              <div className="status-pie" style={{ background: serviceNodes ? `conic-gradient(#64ffd0 0 ${activeEnd}%, #b58aff ${activeEnd}% ${awaitingEnd}%, #f1b956 ${awaitingEnd}% ${offlineEnd}%, #ef677b ${offlineEnd}% 100%)` : "rgba(22,58,49,.55)" }}>
                <i className="pie-grid" /><i className="pie-sweep" />
                <div className="pie-core"><strong className="notranslate" translate="no">{compact(serviceNodes ? statusTotal : 0)}</strong><span>{"TOTAL SHOWN"}</span></div>
              </div>
              <div className="status-breakdown">
                <dl className="status-ledger">
                  <div><dt><i className="active-dot" />{"Active"}</dt><dd className="notranslate" translate="no">{compact(serviceNodes ? activeServiceNodes : 0)}</dd></div>
                  <div title="Unlocking nodes remain included in Active until they leave the current Service Node list"><dt><i className="unlock-dot" />{"Unlocking · included in Active"}</dt><dd className="notranslate" translate="no">{compact(serviceNodes ? unlockingServiceNodes : 0)}</dd></div>
                  <div><dt><i className="awaiting-dot" />{"Awaiting contributions"}</dt><dd className="notranslate" translate="no">{compact(serviceNodes ? awaitingServiceNodes : 0)}</dd></div>
                  <div><dt><i className="offline-dot" />{"Decommissioned"}</dt><dd className="notranslate" translate="no">{compact(serviceNodes ? decommissionedServiceNodes : 0)}</dd></div>
                  <div className="history-entry" title="Deregistered nodes whose stake remains locked on chain"><dt><i className="removed-dot" />{"Deregistered · Stake locked"}</dt><dd className="notranslate" translate="no">{compact(serviceNodes ? lockedDeregisteredServiceNodeTotal : 0)}</dd></div>
                </dl>
                {serviceNodes ? <p className="status-summary" translate="no"><b>{compact(currentServiceNodeTotal)}</b>{" current + "}<b>{compact(lockedDeregisteredServiceNodeTotal)}</b>{" deregistered with stake still locked. "}<b>{compact(unlockingServiceNodes)}</b>{" unlocking nodes remain included in Active."}</p> : <p className="status-summary">No verified snapshot yet · initial values are 0</p>}
              </div>
            </div>
          </section>

          <section className="stats-panel staking-panel">
            <header><div><h2>{"Service Node Staking"}</h2></div></header>
            <div className="stake-total"><span>{"TOTAL SERVICE NODE STAKE"}</span><strong className="notranslate" translate="no">{jude(serviceNodes?.totalContributed ?? 0)} <i>JUDE</i></strong></div>
            <div className={`stake-progress${stakingRatio == null ? " unavailable" : ""}`}><i style={{ width: `${stakingRatioWidth}%` }} /></div>
            <div className="stake-scale"><span>0%</span><b className="notranslate" translate="no">{stakingRatio == null ? "No verified ratio · initial value" : `${stakingRatio.toFixed(2)}% of total mined supply`}</b><span>100%</span></div>
            <div className="stake-mini-grid">
              <div><small>{"REQUIREMENT"}</small><strong className="notranslate" translate="no">{jude(serviceNodes?.stakingRequirement ?? 0)}</strong><span>{"JUDE / node"}</span></div>
              <div><small>{"TOTAL MINED SUPPLY"}</small><strong className="notranslate" translate="no">{minedSupply ? atomicJude(minedSupply) : "0"}</strong><span>{minedSupply == null ? "No verified supply · initial value" : "JUDE"}</span></div>
              <div><small>{"CURRENT SERVICE NODES"}</small><strong className="notranslate" translate="no">{compact(serviceNodes?.total ?? 0)}</strong><span>{"Registered on mainnet"}</span></div>
              <div><small>{"STAKING RATIO"}</small><strong className="notranslate" translate="no">{`${(stakingRatio ?? 0).toFixed(2)}%`}</strong><span>{stakingRatio == null ? "No verified ratio · initial value" : "Current stake / total mined"}</span></div>
            </div>
          </section>

          <section className="stats-panel chain-pulse-panel">
            <header><div><h2>{"Recent Block Activity"}</h2></div><span>{liveNetwork ? `${liveNetwork.targetSeconds} s target` : "Target unavailable"}</span></header>
            <div className="pulse-timeline" aria-label={"Recent interactive block activity"}>
              <i className="pulse-track" />
              {(snapshot?.blocks || []).slice(0, 5).reverse().map((block, index) => <button key={block.height} className="pulse-node" style={{ "--pulse": `${Math.max(18, Math.min(82, 22 + block.txs * 13))}%`, "--left": `${4 + index * 23}%` } as React.CSSProperties} onClick={() => openBlock(block.height)} aria-label={`Open block ${block.height}`}>
                <i />
                <span className="pulse-tooltip"><b>{"BLOCK"} {compact(block.height)}</b><em>{`${block.txs} transactions`}</em><em>{bytes(block.size)}</em><em>{`${age(block.timestamp)} ago`}</em><small>{"CLICK TO INSPECT →"}</small></span>
              </button>)}
            </div>
            <div className="pulse-footer"><span>{"OLDER"}</span><b className="notranslate" translate="no">{`LATEST · ${compact(snapshot?.blocks[0]?.height ?? 0)}`}</b></div>
          </section>

          <section className="stats-panel protocol-panel">
            <header><div><h2>{"Chain Parameters"}</h2></div></header>
            <dl>
              <div><dt>{"Hard Fork Version"}</dt><dd className="notranslate" translate="no">{`v${liveNetwork?.hardFork ?? 0}`}</dd></div>
              <div><dt>{"Protocol Version"}</dt><dd className="notranslate" translate="no">{liveNetwork?.protocol ?? "0"}</dd></div>
              <div><dt>{"Median Block Size"}</dt><dd className="notranslate" translate="no">{liveNetwork ? bytes(liveNetwork.blockSizeMedian) : "0 B"}</dd></div>
              <div><dt>{"Block Size Limit"}</dt><dd className="notranslate" translate="no">{liveNetwork ? bytes(liveNetwork.blockSizeLimit) : "0 B"}</dd></div>
            </dl>
          </section>
        </div>

        <section className="stats-panel lifecycle-panel">
          <header><div><h2>{"Service Node Lifecycle"}</h2></div></header>
          <div className="lifecycle-grid">
            <article><TxTypeBadge type="unlock" compact iconOnly /><div><small>{"UNLOCKING"}</small><button className="lifecycle-count notranslate" translate="no" onClick={() => setLifecycleView(lifecycleView === "unlocking" ? null : "unlocking")}>{compact(serviceNodes?.exiting ?? 0)}</button><span>{"Nodes scheduled to exit service"}</span><button className="lifecycle-action" onClick={() => setLifecycleView("unlocking")}>View unlocking nodes →</button></div></article>
            <article><TxTypeBadge type="decommission" compact iconOnly /><div><small>{"DECOMMISSIONED"}</small><button className="lifecycle-count notranslate" translate="no" disabled={!decommissionedServiceNodes} onClick={() => setLifecycleView(lifecycleView === "decommissioned" ? null : "decommissioned")}>{compact(serviceNodes?.decommissioned ?? 0)}</button><span>{"Funded nodes temporarily inactive"}</span>{decommissionedServiceNodes > 0 ? <button className="lifecycle-action" onClick={() => setLifecycleView("decommissioned")}>View decommissioned nodes →</button> : <em className="lifecycle-action empty">No decommissioned nodes</em>}</div></article>
            <article><TxTypeBadge type="deregistration" compact iconOnly /><div><small>{"DEREGISTRATION RECORDS"}</small><button className="lifecycle-count notranslate" translate="no" onClick={() => { setLifecycleView(lifecycleView === "deregistered" ? null : "deregistered"); setDeregisteredNodePage(0); }}>{compact(deregisteredTotal ?? 0)}</button><span>{`Indexed through block ${compact(deregisteredIndexedThrough ?? 0)}`}</span><button className="lifecycle-action" onClick={() => { setLifecycleView("deregistered"); setDeregisteredNodePage(0); }}>View deregistration records →</button></div></article>
          </div>
          {lifecycleView && <div className="lifecycle-details">
            <header><div><h3>{lifecycleView === "unlocking" ? "Nodes pending unlock" : lifecycleView === "decommissioned" ? "Temporarily decommissioned nodes" : "Deregistration records"}</h3></div><div className="lifecycle-header-actions">{lifecycleView === "deregistered" && deregisteredNodes.length > 20 && <PaginationControls page={deregisteredNodePage} lastPage={deregisteredNodeLastPage} pageSize={deregisteredNodePageSize} onPageChange={setDeregisteredNodePage} onPageSizeChange={(size) => { setDeregisteredNodePageSize(size); setDeregisteredNodePage(0); }} />}<button onClick={() => setLifecycleView(null)} aria-label={"Close lifecycle details"}>×</button></div></header>
            <div className={`table-card ${lifecycleView === "unlocking" ? "unlock-detail-table" : lifecycleView === "decommissioned" ? "decommission-detail-table" : "deregistered-table"}`}>
              {lifecycleView === "unlocking" ? <>
                <div className="table-head"><span>{"NODE PUBLIC KEY"}</span><span>{"STAKE"}</span><span>{"REGISTERED BLOCK"}</span><span>{"LAST REWARD"}</span><span>{"SCHEDULED UNLOCK BLOCK"}</span><span>{"EST. TIME LEFT"}</span></div>
                {(serviceNodes?.unlockingNodes || []).map((node) => {
                  const remainingBlocks = Math.max(0, node.unlockAt - serviceNodeHeight);
                  return <div className="table-row service-node-row-link" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}><span className="node-key detail-link">{hashPreview(node.publicKey)}</span><span>{jude(node.contributed)} JUDE</span><span className="block-height detail-link">{compact(node.registeredAt)}</span><span className="block-height detail-link">{compact(node.lastRewardAt)}</span><span className="block-height">{compact(node.unlockAt)}</span><span className="unlock-eta"><b>{liveNetwork ? estimatedBlockWait(remainingBlocks, liveNetwork.targetSeconds) : "N/A"}</b><small>{`${compact(remainingBlocks)} blocks`}</small></span></div>;
                })}
              </> : lifecycleView === "decommissioned" ? <>
                <div className="table-head"><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"DECOMMISSIONS"}</span><span>{"DOWNTIME CREDIT"}</span></div>
                {(serviceNodes?.decommissionedNodes || []).map((node) => <div className="table-row service-node-row-link" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}><span className="node-key detail-link">{hashPreview(node.publicKey)}</span><span>{node.contributors}/{node.maxContributors}</span><span>{compact(node.decommissionCount)}</span><span>{compact(node.downtimeCredit)} {"blocks"}</span></div>)}
                {serviceNodes && serviceNodes.decommissionedNodes.length === 0 && <div className="lifecycle-empty"><b>0</b><span>{"No service nodes are currently decommissioned."}</span><small>{"This panel will populate automatically when the chain reports a temporarily offline funded node."}</small></div>}
              </> : <>
                <div className="table-head"><span>{"NODE PUBLIC KEY"}</span><span>{"STAKE STATUS"}</span><span>{"REGISTERED BLOCK"}</span><span>{"STAKE UNLOCK HEIGHT"}</span></div>
                {paginatedDeregisteredNodes.map((node) => <div className="table-row service-node-row-link" key={`${node.publicKey}-${node.unlockedAt}`} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}><span className="node-key detail-link">{hashPreview(node.publicKey)}</span><span>{serviceNodeHeight > 0 ? serviceNodeHeight >= node.unlockedAt ? "RELEASED" : "LOCKED" : "N/A"}</span><span className="block-height detail-link">{compact(node.registeredAt)}</span><span className="block-height detail-link">{compact(node.unlockedAt)}</span></div>)}
              </>}
            </div>
            {lifecycleView === "unlocking" && liveNetwork && <p className="unlock-estimate-note">Estimated time is calculated using the current chain height and the {liveNetwork.targetSeconds}-second target block time. Actual unlock timing may vary as blocks are produced.</p>}
          </div>}
        </section>
      </section>}

      {serviceNodesOnly && <section className="staking service-nodes-page shell" id="staking">
        <div className="section-heading">
          <div><h2>{"Service Node Overview"}</h2></div>
        </div>
        <form className="service-node-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <span className="service-node-search-icon" aria-hidden="true">⌕</span>
          <input
            aria-label="Search Service Nodes by public key"
            placeholder="Search by node public key"
            value={serviceNodeQuery}
            onChange={(event) => { setServiceNodeQuery(event.target.value); setServiceNodePage(0); }}
            autoComplete="off"
            spellCheck={false}
          />
          {serviceNodeQuery && <button type="button" onClick={() => { setServiceNodeQuery(""); setServiceNodePage(0); }} aria-label="Clear Service Node search">Clear</button>}
          <span className="service-node-search-count notranslate" translate="no">{serviceNodeQuery.trim() ? `RESULTS: ${compact(filteredServiceNodes.length)}` : `TOTAL NODES: ${compact(serviceNodes?.total ?? 0)}`}</span>
        </form>
        <div className="staking-stats">
          <article><small>{"TOTAL SERVICE NODES"}</small><strong className="notranslate" translate="no">{compact(serviceNodes?.total ?? 0)}</strong><span>{"Registered on mainnet"}</span></article>
          <article><small>{"ACTIVE NODES"}</small><strong className="notranslate" translate="no">{compact(serviceNodes?.active ?? 0)}</strong><span className="trend">{"Currently active on mainnet"}</span></article>
          <article><small>{"STAKING REQUIREMENT"}</small><strong className="notranslate" translate="no">{jude(serviceNodes?.stakingRequirement ?? 0)} <i>JUDE</i></strong><span>{"Required for a fully funded node"}</span></article>
          <article><small>{"TOTAL STAKED"}</small><strong className="notranslate" translate="no">{jude(serviceNodes?.totalContributed ?? 0)} <i>JUDE</i></strong><span className="trend">{"Total contributed to Service Nodes"}</span></article>
          <article className="unlocking-stat"><small>{"UNLOCKING NODES"}</small><strong className="notranslate" translate="no">{compact(serviceNodes?.exiting ?? 0)}</strong><span>{"Scheduled to exit service"}</span></article>
          <article><small>{"DECOMMISSIONED NODES"}</small><strong className="notranslate" translate="no">{compact(serviceNodes?.decommissioned ?? 0)}</strong><span>{"Temporarily inactive"}</span></article>
        </div>
        {awaitingServiceNodeRows.length > 0 && <AwaitingContributionsPanel nodes={awaitingServiceNodeRows} onOpen={openServiceNode} />}
        {Boolean(serviceNodes?.decommissionedNodes.length) && (
          <section className="decommissioned-live" aria-label="Temporarily decommissioned service nodes">
            <div className="decommissioned-live-heading">
              <div>
                <h3>{"Temporarily Decommissioned"}</h3>
                <p>{"Currently out of service and not earning rewards. This panel disappears automatically when every node returns to service."}</p>
              </div>
              <strong className="notranslate" translate="no">{serviceNodes!.decommissionedNodes.length} {"DECOMMISSIONED"}</strong>
            </div>
            <div className="decommissioned-live-table">
              <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"DECOMMISSIONS"}</span><span>{"LAST UPTIME AGE [h:m:s]"}</span><span>{"DOWNTIME CREDIT"}</span></div>
              {serviceNodes!.decommissionedNodes.map((node) => (
                <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}>
                  <TxTypeBadge type="decommission" compact iconOnly />
                  <span className="node-key detail-link">{hashPreview(node.publicKey)}</span>
                  <span>{node.contributors}/{node.maxContributors}</span>
                  <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
                  <span>{compact(node.decommissionCount)}</span>
                  <span>{node.lastUptimeProof ? age(node.lastUptimeProof) : "0"}</span>
                  <span>{compact(node.downtimeCredit)} {"blocks"}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="table-card nodes-table">
          <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"STAKE (JUDE)"}</span><span>{"REGISTRATION HEIGHT"}</span><span title="Sorted by latest reward block height">{"LAST REWARD BLOCK ↓"}</span><span>{"VERSION"}</span></div>
          {paginatedServiceNodes.map((node) => (
            <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}>
              {node.unlocking
                ? <span className="node-unlocking"><TxTypeBadge type="unlock" compact iconOnly /></span>
                : <span className={node.active ? "node-active" : "node-inactive"}>{node.active ? "● ACTIVE" : node.funded ? "○ DECOMMISSIONED" : "○ AWAITING CONTRIBUTIONS"}</span>}
              <span className="node-key detail-link">{hashPreview(node.publicKey)}</span>
              <span>{node.contributors}/{node.maxContributors}</span>
              <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
              <span>{jude(node.contributed)}</span>
              <span className="block-height detail-link">{compact(node.registeredAt)}</span>
              <span className="block-height detail-link">{compact(node.lastRewardAt)}</span>
              <span>{node.version}</span>
            </div>
          ))}
          {!serviceNodes && <div className="nodes-loading notranslate" translate="no">{"0 SERVICE NODES"}</div>}
          {serviceNodes && filteredServiceNodes.length === 0 && <div className="nodes-loading">No Service Node public key matches this search.</div>}
        </div>
        <div className="service-node-bottom-pager">
          <PaginationControls
            page={serviceNodePage}
            lastPage={serviceNodeLastPage}
            pageSize={serviceNodePageSize}
            onPageChange={setServiceNodePage}
            onPageSizeChange={(size) => { setServiceNodePageSize(size); setServiceNodePage(0); }}
          />
        </div>
      </section>}

      {!serviceNodesOnly && !statisticsOnly && <>
      <section className="quorum-section shell" id="quorums">
        <div className="section-heading quorum-heading">
          <div><h2>{"Service Node Testing Quorums"}</h2></div>
        </div>
        <div className="quorum-console">
          <div className="quorum-radar" aria-hidden="true">
            <i className="quorum-sweep" />
            <i className="quorum-ring ring-a" /><i className="quorum-ring ring-b" /><i className="quorum-ring ring-c" />
            {(latestQuorum?.validators || []).slice(0, 10).map((key, index) => <i className="radar-node" key={key} style={{ "--n": index } as React.CSSProperties} />)}
            <div className="radar-core"><strong className="notranslate" translate="no">{latestQuorum?.validators.length ?? 0}</strong><span>{"VALIDATORS"}</span></div>
          </div>
          <div className="quorum-overview">
            <h3>{"Public testing quorums, clearly mapped."}</h3>
            <p>{"Each sampled height shows its Service Node testing quorum: validators and the nodes assigned for testing. Checkpoint, Blink, and Pulse quorums are not represented in this panel."}</p>
            <div className="quorum-metrics">
              <article><small>{"LATEST SAMPLE"}</small><strong className="block-height notranslate" translate="no">{latestQuorum ? compact(latestQuorum.height) : "0"}</strong></article>
              <article><small>{"VALIDATORS"}</small><strong className="notranslate" translate="no">{latestQuorum?.validators.length ?? 0}</strong></article>
              <article><small>{"NODES UNDER TEST"}</small><strong className="notranslate" translate="no">{latestQuorum?.workers.length ?? 0}</strong></article>
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
          {!quorums?.records.length && <div className="nodes-loading notranslate" translate="no">{"0 QUORUM RECORDS"}</div>}
        </div>
        <div className="quorum-bottom-pager">
          <PaginationControls page={quorumPage} lastPage={liveNetwork ? Math.min(10000, Math.floor(liveNetwork.height / quorumPageSize)) : 0} pageSize={quorumPageSize} loading={quorumLoading} onPageChange={(page) => void changeQuorumPage(page)} onPageSizeChange={changeQuorumPageSize} onPrefetchPage={(page) => prefetchSnapshot({ quorumPage: page })} disableNext={Boolean(quorums && !quorums.hasOlder)} />
        </div>
        {quorums?.truncated && <div className="nodes-loading">{"Older quorum history exists. Select a larger page size to reach earlier heights."}</div>}
      </section>

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
                <p>{"Currently offline, out of service, and not earning rewards. This panel is hidden automatically when all nodes return to service."}</p>
              </div>
              <strong className="notranslate" translate="no">{serviceNodes!.decommissionedNodes.length} {"DECOMMISSIONED"}</strong>
            </div>
            <div className="decommissioned-live-table">
              <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"DECOMMISSIONS"}</span><span>{"LAST UPTIME AGE [h:m:s]"}</span><span>{"DOWNTIME CREDIT"}</span></div>
              {serviceNodes!.decommissionedNodes.map((node) => (
                <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}>
                  <TxTypeBadge type="decommission" compact iconOnly />
                  <span className="node-key detail-link">{hashPreview(node.publicKey)}</span>
                  <span>{node.contributors}/{node.maxContributors}</span>
                  <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
                  <span>{compact(node.decommissionCount)}</span>
                  <span>{node.lastUptimeProof ? age(node.lastUptimeProof) : "0"}</span>
                  <span>{compact(node.downtimeCredit)} {"blocks"}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="table-card nodes-table">
          <div className="table-head"><span>{"STATUS"}</span><span>{"NODE PUBLIC KEY"}</span><span>{"CONTRIBUTORS"}</span><span>{"OPERATOR FEE (%)"}</span><span>{"STAKE (JUDE)"}</span><span>{"REGISTRATION HEIGHT"}</span><span title="Sorted by latest reward block height">{"LAST REWARD BLOCK ↓"}</span><span>{"VERSION"}</span></div>
          {homepageServiceNodes.map((node) => (
            <div className="table-row service-node-row-link notranslate" translate="no" key={node.publicKey} role="button" tabIndex={0} aria-label={`Open Service Node ${node.publicKey}`} onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openServiceNode(node.publicKey); } }}>
              {node.unlocking
                ? <span className="node-unlocking"><TxTypeBadge type="unlock" compact iconOnly /></span>
                : <span className={node.active ? "node-active" : "node-inactive"}>{node.active ? "● ACTIVE" : node.funded ? "○ DECOMMISSIONED" : "○ PENDING"}</span>}
              <span className="node-key detail-link">{hashPreview(node.publicKey)}</span>
              <span>{node.contributors}/{node.maxContributors}</span>
              <span>{node.operatorFee == null ? "NOT REPORTED" : node.operatorFee}</span>
              <span>{jude(node.contributed)}</span>
              <span className="block-height detail-link">{compact(node.registeredAt)}</span>
              <span className="block-height detail-link">{compact(node.lastRewardAt)}</span>
              <span>{node.version}</span>
            </div>
          ))}
          {!serviceNodes && <div className="nodes-loading notranslate" translate="no">{"0 SERVICE NODES"}</div>}
        </div>
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
        <div><h2>{"Transparency where it matters."}<br />{"Privacy where it counts."}</h2><p>{"Public consensus data remains inspectable, while private transfer participants, addresses, and amounts remain hidden. Service Node registration fields appear only when they are part of the protocol’s public state."}</p></div>
        <div className="privacy-grid">
          <article><b>◉</b><span><strong>{"Private addresses"}</strong><small>{"Private transfer participants are not indexed."}</small></span></article>
          <article><b>◌</b><span><strong>{"Amounts stay private"}</strong><small>{"Transfer values remain confidential."}</small></span></article>
          <article><b>◇</b><span><strong>{"Public consensus proof"}</strong><small>{"Blocks, transaction hashes, and public Service Node consensus data remain verifiable."}</small></span></article>
        </div>
      </section>

      <footer className="shell"><div className="brand"><span className="brand-mark"><img src="/judecoin-logo-minimal-ring-transparent.png" alt="" /></span><span><b>JUDECOIN</b></span></div><div className="footer-meta"><a href="https://github.com/judecoin" target="_blank" rel="noreferrer">{"Source Code"}</a><span>{"Judecoin Core"}: 3.2.0-release</span></div></footer>
      </>}

      {detailPending && <div className="detail-request-status" aria-live="polite" aria-atomic="true">
        <div className="detail-request-card">
          <span className={`detail-request-mark ${detailPending.kind}`} aria-hidden="true"><i /></span>
          <span className="detail-request-copy"><small>{"LIVE MAINNET QUERY"}</small><strong>{detailPending.title}</strong><em>{detailPending.message}</em></span>
          <button type="button" onClick={closeDetail} aria-label={"Cancel detail request"}>×</button>
        </div>
      </div>}
      {detail && <div ref={detailBackdropRef} className={detail.fullPage ? "detail-backdrop detail-page-backdrop" : "detail-backdrop"} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
        <div key={detailRenderKey} className={detail.fullPage ? `detail-modal detail-page detail-resolved${detail.kind ? ` ${detail.kind}-detail-page` : ""}` : "detail-modal detail-resolved"} role="dialog" aria-modal="true" aria-labelledby="detail-title">
          <header><div>{detail.fullPage && <button className="detail-back-button" aria-label={"Back"} onClick={closeDetail}>← {"Back"}</button>}<h2 id="detail-title">{detail.title}</h2></div>{!detail.fullPage && <button aria-label={"Close details"} onClick={closeDetail}>×</button>}</header>
          {detail.sections ? <div className="detail-sections">{detail.sections.map((section) => <section className="detail-section" key={section.title}><div className="detail-subheading"><h3>{section.title}</h3></div><dl>{section.rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd className={isBlockHeightLabel(row.label) ? "block-height" : undefined}><DetailValue value={row.value} /></dd></div>)}</dl></section>)}</div> : <div className="detail-grid">{detail.rows.map((row) => <div key={row.label}><small>{row.label}</small><DetailValue value={row.value} /></div>)}</div>}
          {detail.outputs && <section className="detail-outputs"><div className="detail-subheading"><h3>{detail.outputTitle || "Transaction Outputs"}</h3></div><div className="detail-output-table"><div className="detail-output-head"><span>#</span><span>{"OUTPUT KEY"}</span><span>{"AMOUNT"}</span><span>{"UNLOCK HEIGHT"}</span></div>{detail.outputs.map((output) => <div className="detail-output-row" key={`${output.index}-${output.key}`}><span>{output.index}</span><code>{output.key}</code><strong className={output.confidential ? "private-amount" : undefined}>{output.confidential ? "? JUDE" : `${atomicJude(output.amount || 0)} JUDE`}</strong><span className="block-height">{compact(output.unlockHeight)}</span></div>)}</div></section>}
          {detail.inputs && <section className="detail-inputs"><div className="detail-subheading"><h3>{"Inputs"}</h3><p>{`${detail.inputs.length} input(s) · amounts remain private`}</p></div><div className="detail-input-list">{detail.inputs.map((input) => <article key={`${input.index}-${input.keyImage}`}><header><span>{`INPUT ${input.index}`}</span><TxTypeBadge type={input.type === "coinbase" ? "block-reward" : "transfer"} compact iconOnly /></header><dl className="input-summary"><div><dt>{"KEY IMAGE"}</dt><dd><code>{input.keyImage || "Not applicable"}</code></dd></div><div><dt>{"AMOUNT"}</dt><dd className={input.amount ? undefined : "private-amount"}>{input.amount ? `${atomicJude(input.amount)} JUDE` : "? JUDE"}</dd></div><div><dt>{"RING SIZE"}</dt><dd>{input.ringSize || "N/A"}</dd></div></dl>{input.ringSize > 0 && <div className="ring-members"><div className="ring-head"><span>#</span><span>{"RING MEMBER / OUTPUT KEY"}</span><span>{"SOURCE TRANSACTION"}</span><span>{"BLOCK"}</span></div>{(input.ringMembers?.length ? input.ringMembers : (input.keyOffsets || []).map((offset) => ({ index: offset, outputKey: "", transactionHash: "", blockHeight: 0, unlocked: false }))).map((member, memberIndex) => <div className="ring-row" key={`${input.index}-${member.index}-${memberIndex}`}><span>{memberIndex}</span><code>{member.outputKey || `Output index ${compact(member.index)}`}</code><span>{member.transactionHash ? <button className="detail-link link" onClick={() => openTransaction(member.transactionHash)}>{hashPreview(member.transactionHash)}</button> : "Unavailable from node"}</span><span>{member.blockHeight ? <button className="detail-link block-height" onClick={() => openBlock(member.blockHeight)}>{compact(member.blockHeight)}</button> : "N/A"}</span></div>)}</div>}</article>)}</div></section>}
          {detail.raw && <details className="raw-details"><summary>{detail.kind === "service-node" ? "Show Raw Service Node Data" : detail.kind === "block" ? "Show Raw Block Data" : "Show Raw Transaction Data"}</summary><pre>{detail.raw}</pre></details>}
          <p>{detail.note || "Privacy fields are intentionally excluded. No private address, participant, balance, or amount is requested from the node."}</p>
        </div>
      </div>}
    </main>
  );
}
