import { useState } from "react";
import type { ChainSnapshot, ServiceNodesSnapshot } from "../../explorer-types";
import { age, compact } from "../formatters";
import { forkDuration, forkUtc, upgradeVersionStatus } from "../fork-model";
import { IdentifierCell } from "./shared";

type ForkMonitorProps = {
  embedded?: boolean;
  summaryOnly?: boolean;
  network: ChainSnapshot["network"] | null;
  serviceNodes: ServiceNodesSnapshot | null;
  observedAt?: string | null;
  observationHeight: number;
  connection: "loading" | "live" | "offline";
  displayNow: number;
  openBlock: (height: number) => void;
  openServiceNode: (publicKey: string) => void;
};

export function ForkMonitor({ embedded = false, summaryOnly = false, network, serviceNodes, observedAt, observationHeight, connection, displayNow, openBlock, openServiceNode }: ForkMonitorProps) {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const fork = network?.fork;
  const readiness = serviceNodes?.upgradeReadiness;
  const archive = serviceNodes?.forkArchive;
  const activationHeight = fork?.activationHeight ?? 882_300;
  const activated = fork?.phase === "activated";
  const heightReached = network != null && network.height >= activationHeight;
  const observedTime = observedAt ? Date.parse(observedAt) : NaN;
  const fresh = connection === "live" && Number.isFinite(observedTime) && displayNow >= observedTime - 60_000 && displayNow - observedTime <= 90_000;
  const blockAge = network && network.latestBlockTimestamp > 0 ? Math.max(0, displayNow / 1000 - network.latestBlockTimestamp) : null;
  const progressing = network != null && connection === "live" && blockAge !== null && blockAge <= Math.max(900, network.targetSeconds * 5);
  const remaining = network ? Math.max(0, activationHeight - network.height) : null;
  const eta = !heightReached && progressing && network?.targetVerified && remaining !== null ? remaining * network.targetSeconds : null;
  const percent = readiness?.percentage ?? null;
  const olderWidth = readiness && readiness.eligibleTotal > 0 ? readiness.pending / readiness.eligibleTotal * 100 : 0;
  const unknownWidth = readiness && readiness.eligibleTotal > 0 ? readiness.unknown / readiness.eligibleTotal * 100 : 0;
  const pendingNodes = (serviceNodes?.nodes ?? []).filter((node) => upgradeVersionStatus(node.version) !== "upgraded");
  const rows = filter === "pending" ? pendingNodes : serviceNodes?.nodes ?? [];
  const preFork = archive?.preFork;
  const title = activated ? "Pure PoS activated" : heightReached ? "Verifying protocol activation" : "Pure PoS Upgrade";
  const status = !network ? "Awaiting chain data" : activated ? "Activated on chain" : heightReached ? "Awaiting confirmation" : "Activation scheduled";

  const exportRecord = () => {
    const record = {
      event: "Judecoin Pure PoS upgrade", activationHeight,
      networkObservation: fork ?? null,
      serviceNodeObservation: readiness ? { observedAt, height: observationHeight, readiness } : null,
      preForkRecord: archive ?? null,
      methodology: "Upgrade participation uses reported software versions across current registered Service Nodes, including inactive and awaiting-contribution nodes. Unknown versions remain in the denominator. This is not a protocol vote tally or a probability of successful activation.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "judecoin-pos-upgrade-882300.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className={`fork-monitor${embedded ? " is-embedded" : " shell"}${activated ? " is-activated" : ""}`} id="network-upgrade" aria-labelledby="fork-title">
    <div className="fork-surface">
      <header className="fork-heading">
        <h2 id="fork-title">{title}</h2>
        <div className="fork-state" role="status"><i aria-hidden="true" />{status}{connection !== "live" && network && <span>{" · Last observation"}</span>}</div>
      </header>

      {heightReached && <div className="fork-result-band">
        <div><span className="fork-eyebrow">{"ON-CHAIN RESULT"}</span><strong>{activated ? `Protocol v${fork!.currentProtocol} observed` : "Activation evidence pending"}</strong><p>{activated && fork?.activationBlock ? `Activation block · ${forkUtc(fork.activationBlock.timestamp)}` : "Waiting for the activation block and protocol to be verified."}</p></div>
        <div><span className="fork-eyebrow">{"LAST PRE-FORK UPGRADE OBSERVATION"}</span><strong>{preFork?.readiness.percentage != null ? `${preFork.readiness.percentage.toFixed(2)}% · ${compact(preFork.readiness.upgraded)} / ${compact(preFork.readiness.eligibleTotal)} nodes` : "No pre-fork record available"}</strong><p>{preFork ? `${archive?.exactClosingSnapshot ? "Last pre-fork block observation" : "Last pre-fork observation"} #${compact(preFork.height)} · ${forkUtc(preFork.observedAt)}` : "Historical participation requires a saved observation before activation."}</p></div>
      </div>}

      <div className="fork-dashboard">
        <div className="fork-activation">
          <div className="fork-number-heading"><span>{"ACTIVATION BLOCK"}</span><button type="button" className="fork-height" disabled={!heightReached} onClick={() => openBlock(activationHeight)} title={heightReached ? "Inspect the activation block" : "Block has not been produced yet"}>{compact(activationHeight)}{heightReached && <span aria-hidden="true">{" ↗"}</span>}</button></div>
          <dl className="fork-chain-facts">
            <div><dt>{activated ? "Blocks since activation" : "Blocks remaining"}</dt><dd>{network ? compact(activated ? Math.max(0, network.height - activationHeight) : remaining!) : "—"}</dd></div>
            <div><dt>{"Live protocol"}</dt><dd>{network ? `v${network.hardFork}` : "—"}<span>{fork?.targetProtocol && !activated ? ` → v${fork.targetProtocol}` : ""}</span></dd></div>
            <div><dt>{activated ? "Latest block age" : "Estimated time left"}</dt><dd className={activated && !progressing ? "fork-warning" : undefined} title={activated && network?.latestBlockTimestamp ? forkUtc(network.latestBlockTimestamp) : "Time remaining is an estimate; activation follows block height."}>{activated ? blockAge !== null && Number.isFinite(blockAge) ? age(network!.latestBlockTimestamp, displayNow) : "Unavailable" : heightReached ? "Height reached" : forkDuration(eta)}</dd></div>
          </dl>
        </div>

        <div className="fork-participation">
          <div className="fork-adoption-heading"><div><span>{activated ? "CURRENT NODE UPGRADE RATE" : "NODE UPGRADE RATE"}</span><small>{readiness ? `v${readiness.targetVersion}+` : "Awaiting node data"}</small></div><strong className="notranslate" translate="no">{percent === null ? "—" : percent.toFixed(2)}{percent !== null && <span>%</span>}</strong></div>
          <div className="fork-adoption-track" role="img" aria-label={readiness ? `${readiness.upgraded} upgraded, ${readiness.pending} older version, ${readiness.unknown} unknown, out of ${readiness.eligibleTotal} registered Service Nodes` : "Upgrade participation unavailable"}>
            <i className="fork-track-upgraded" style={{ width: `${percent ?? 0}%` }} /><i className="fork-track-pending" style={{ width: `${olderWidth}%` }} /><i className="fork-track-unknown" style={{ width: `${unknownWidth}%` }} />
          </div>
          <dl className={`fork-counts${readiness?.unknown ? " has-unknown" : ""}`}>
            <div><dt><i className="fork-dot upgraded" />{"Upgraded"}</dt><dd>{readiness ? compact(readiness.upgraded) : "—"}<span>{readiness ? ` / ${compact(readiness.eligibleTotal)}` : ""}</span></dd></div>
            <div><dt><i className="fork-dot pending" />{"Older version"}</dt><dd>{readiness ? compact(readiness.pending) : "—"}</dd></div>
            {Boolean(readiness?.unknown) && <div><dt><i className="fork-dot unknown" />{"Unknown version"}</dt><dd>{compact(readiness!.unknown)}</dd></div>}
          </dl>
        </div>
      </div>

      {summaryOnly ? <a className="fork-details-link" href="/statistics#network-upgrade"><span>{"Upgrade details & records"}</span><span>{"View statistics →"}</span></a> : <details className="fork-details">
        <summary><span>{"Node versions"}</span><span className="fork-summary-count">{readiness ? `${compact(readiness.eligibleTotal)} registered nodes` : "Awaiting observation"}<span aria-hidden="true">{" +"}</span></span></summary>
        <div className="fork-details-content">
          {readiness && <div className="fork-version-list" aria-label="Node software version distribution">{[...readiness.versions, ...(readiness.unknown ? [{ version: "Unknown", count: readiness.unknown }] : [])].map((entry) => <span key={entry.version}><code>{entry.version === "Unknown" ? "Unknown version" : `v${entry.version}`}</code><b>{compact(entry.count)}</b></span>)}</div>}
          <div className="fork-list-toolbar"><div className="fork-filters" role="group" aria-label="Filter node upgrade list"><button type="button" aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>{"Needs attention"}{serviceNodes && ` (${pendingNodes.length})`}</button><button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{"All nodes"}</button></div><button type="button" className="fork-export" disabled={!fork && !readiness} onClick={exportRecord}>{"Export record ↓"}</button></div>
          <div className="fork-node-table">
            <div className="fork-node-head" aria-hidden="true"><span>{"NODE PUBLIC KEY"}</span><span>{"VERSION"}</span><span>{"UPGRADE STATUS"}</span><span /></div>
            <div className="fork-node-list" role="region" aria-label="Node upgrade records">
              {rows.map((node) => <div key={node.publicKey} role="button" tabIndex={0} className="fork-node-record notranslate" translate="no" onClick={() => openServiceNode(node.publicKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openServiceNode(node.publicKey); } }} aria-label={`Open Service Node ${node.publicKey}`}><IdentifierCell className="fork-node-key" value={node.publicKey} label="Service Node public key" /><span className="fork-node-version">{upgradeVersionStatus(node.version) === "unknown" ? "Unknown" : `v${node.version}`}</span><b className={`fork-node-state ${upgradeVersionStatus(node.version)}`}><i aria-hidden="true" />{upgradeVersionStatus(node.version) === "upgraded" ? "Upgraded" : upgradeVersionStatus(node.version) === "pending" ? "Older version" : "Unreported"}</b><span className="fork-node-open" aria-hidden="true">↗</span></div>)}
              {serviceNodes && rows.length === 0 && <p className="fork-list-empty">{filter === "pending" && serviceNodes.total > 0 ? "All reported nodes meet the target software version." : "No registered nodes in this observation."}</p>}
              {!serviceNodes && <p className="fork-list-empty">{"Node versions will appear after a verified observation."}</p>}
            </div>
          </div>
          <details className="fork-methodology">
            <summary>{"How this is measured"}</summary>
            <p>{"Reported v4.0.0 or later / all current registered Service Nodes, including inactive and awaiting-contribution nodes. Unknown versions remain in the denominator. This measures software upgrades, not protocol votes."}</p>
            {!heightReached && <p>{"Activation follows block height. Time remaining is an estimate."}</p>}
            {preFork && !heightReached && <p className="fork-record-note">{`Pre-fork observation saved at #${compact(preFork.height)} · ${forkUtc(preFork.observedAt)}`}</p>}
          </details>
        </div>
      </details>}
      <footer className={`fork-footnote${fresh ? "" : " is-stale"}`}><span>{readiness && !fresh && "Last verified · "}{`NODE DATA${observationHeight > 0 ? ` · #${compact(observationHeight)}` : ""} · `}{forkUtc(observedAt)}</span></footer>
    </div>
  </section>;
}
