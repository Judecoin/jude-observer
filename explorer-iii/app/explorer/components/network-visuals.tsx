import { useId, type CSSProperties, type KeyboardEvent } from "react";
import type { ChainSnapshot, ServiceNodesSnapshot } from "../../explorer-types";
import { age, bytes, compact, difficulty } from "../formatters";
import { JUDE_RELEASE_VERSION } from "../constants";
import { getBlockIntervals, getIntervalPlot, quorumMemberPositions } from "../network-visual-model";

export type NetworkOverviewProps = {
  network: ChainSnapshot["network"] | null;
  serviceNodes: ServiceNodesSnapshot | null;
  snapshot: ChainSnapshot | null;
  latestQuorum: ChainSnapshot["quorums"]["records"][number] | null;
  connection: "loading" | "live" | "offline";
  displayNow?: number;
  blockPage: number;
  openBlock: (height: number) => void;
  openServiceNode: (key: string) => void;
};

function activateWithKeyboard(event: KeyboardEvent<SVGGElement>, activate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

export function NetworkOverview({ network, serviceNodes, snapshot, latestQuorum, connection, displayNow, blockPage, openBlock, openServiceNode }: NetworkOverviewProps) {
  const orbitId = useId().replace(/:/g, "");
  const selectedSnapshot = snapshot?.pagination.blockPage === blockPage ? snapshot : null;
  const intervals = getBlockIntervals(selectedSnapshot?.blocks ?? []);
  const targetSeconds = network?.targetVerified === true && network.targetSeconds > 0 ? network.targetSeconds : null;
  const plot = getIntervalPlot(intervals, targetSeconds);
  const validatorMembers = quorumMemberPositions(latestQuorum?.validators ?? [], "validator");
  const workerMembers = quorumMemberPositions(latestQuorum?.workers ?? [], "worker");
  const activeRatio = serviceNodes && serviceNodes.total > 0 ? (serviceNodes.active / serviceNodes.total) * 100 : null;
  const verifiedStatus = !network ? "Awaiting snapshot" : connection === "live" ? "Live snapshot" : connection === "loading" ? "Updating snapshot" : "Last snapshot";

  return (
    <section className={`network-overview shell connection-${connection}`} id="network" aria-label="Judecoin network overview" aria-busy={connection === "loading"}>
      <span className="sr-only" role="status" aria-live="polite">{verifiedStatus}</span>
      <div className="network-bento">
        <article className="overview-chain">
          <div className="chain-height-line">
            <div className="chain-height-primary"><small>{"CHAIN HEIGHT"}</small><strong className="block-height notranslate" translate="no">{network ? compact(network.height) : "—"}</strong></div>
            <div className="chain-height-meta">
              <div><small>{"LATEST BLOCK AGE"}</small><strong className="notranslate" translate="no">{network && network.latestBlockTimestamp > 0 ? age(network.latestBlockTimestamp, displayNow) : "—"}</strong></div>
              <div><small>{"TARGET BLOCK TIME"}</small><strong className="notranslate" translate="no">{targetSeconds === null ? "—" : <>{compact(targetSeconds)} <i>{"sec"}</i></>}</strong></div>
            </div>
          </div>
          <div className="chain-interval-section">
            <div className="interval-chart-heading"><h2>{blockPage > 0 ? "Selected block page" : "Recent block intervals"}</h2></div>
            {plot.bars.length > 0 ? <>
              <div className="interval-chart" role="group" aria-label={`${blockPage > 0 ? "Historical" : "Recent"} consecutive block intervals in seconds. Select a bar to open its block.`}>
                <div className="interval-grid" aria-hidden="true"><i /><i /><i /></div>
                {plot.targetY !== null && <div className="interval-target" style={{ top: `${plot.targetY}%` }} aria-hidden="true" />}
                <div className="interval-bars">
                  {plot.bars.map((bar) => <button className={`interval-bar-button${bar.elapsedSeconds > (plot.targetSeconds ?? Infinity) ? " above-target" : ""}`} type="button" key={bar.height} style={{ "--interval-height": `${bar.barHeight}%` } as CSSProperties} onClick={() => openBlock(bar.height)} aria-label={`Open block ${bar.height}. Interval from block ${bar.previousHeight}: ${bar.elapsedSeconds} seconds.`} title={`Block ${compact(bar.height)} · ${compact(bar.elapsedSeconds)} seconds since block ${compact(bar.previousHeight)}`}><span className="interval-bar" aria-hidden="true" /><span className="interval-bar-tooltip" aria-hidden="true"><b>{`#${compact(bar.height)}`}</b>{`${compact(bar.elapsedSeconds)} s`}</span></button>)}
                </div>
              </div>
              <div className="interval-chart-scale notranslate" translate="no"><span>{`#${compact(plot.bars[0].previousHeight)}`}</span><span>{`#${compact(plot.bars[plot.bars.length - 1].height)}`}</span></div>
            </> : <div className="interval-empty"><span aria-hidden="true">{"—"}</span><p>{selectedSnapshot ? "This page has no consecutive timestamp pairs." : "Block intervals appear after this page is verified."}</p></div>}
          </div>
        </article>

        <article className="overview-quorum">
          <header className="overview-card-heading"><h2>{"Service Node Testing Quorum"}</h2><span className="quorum-sample-height notranslate" translate="no">{latestQuorum ? `Block ${compact(latestQuorum.height)}` : "Awaiting sample"}</span></header>
          <div className="quorum-orbit-wrap">
            <svg className={`quorum-orbit-visual${latestQuorum ? " has-sample" : " empty"}`} viewBox="0 0 440 270" role="group" aria-label={latestQuorum ? `Service Node Testing quorum at block ${latestQuorum.height}: ${validatorMembers.length} validators and ${workerMembers.length} nodes under test. Elliptical positions show membership only.` : "No verified Service Node Testing quorum sample."}>
              <defs>
                <radialGradient id={`${orbitId}-aura`}><stop offset="0%" stopColor="#72ffd2" stopOpacity=".16" /><stop offset="45%" stopColor="#4ee7b4" stopOpacity=".075" /><stop offset="100%" stopColor="#4ee7b4" stopOpacity="0" /></radialGradient>
                <radialGradient id={`${orbitId}-ground`}><stop offset="0%" stopColor="#54ffd0" stopOpacity=".19" /><stop offset="100%" stopColor="#54ffd0" stopOpacity="0" /></radialGradient>
                <radialGradient id={`${orbitId}-glass`} cx="35%" cy="20%" r="80%"><stop offset="0%" stopColor="#a3ffe4" stopOpacity=".21" /><stop offset="55%" stopColor="#0b3c2f" stopOpacity=".86" /><stop offset="100%" stopColor="#061a16" stopOpacity=".98" /></radialGradient>
                <linearGradient id={`${orbitId}-front`} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#8cffe0" stopOpacity=".14" /><stop offset="42%" stopColor="#b9fff1" stopOpacity=".8" /><stop offset="68%" stopColor="#75ffe0" stopOpacity=".56" /><stop offset="100%" stopColor="#54b9e4" stopOpacity=".14" /></linearGradient>
                <linearGradient id={`${orbitId}-edge`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d9fff5" stopOpacity=".7" /><stop offset="45%" stopColor="#78e6c8" stopOpacity=".16" /><stop offset="100%" stopColor="#89ffe0" stopOpacity=".4" /></linearGradient>
              </defs>
              <ellipse className="orbit-aura" cx="220" cy="135" rx="205" ry="124" fill={`url(#${orbitId}-aura)`} aria-hidden="true" />
              <ellipse className="orbit-ground" cx="220" cy="247" rx="126" ry="17" fill={`url(#${orbitId}-ground)`} aria-hidden="true" />
              <g className="orbit-construction" aria-hidden="true">
                <ellipse className="orbit-meridian" cx="220" cy="135" rx="39" ry="115" transform="rotate(57 220 135)" />
                <ellipse className="orbit-meridian" cx="220" cy="135" rx="39" ry="115" transform="rotate(-57 220 135)" />
                <path className="orbit-guide-back orbit-guide-back-outer" d="M 42 135 A 178 98 0 0 1 398 135" />
                <path className="orbit-guide-back orbit-guide-back-inner" d="M 109 135 A 111 60 0 0 1 331 135" />
              </g>
              <ellipse className="orbit-guide orbit-guide-outer" cx="220" cy="135" rx="178" ry="98" />
              <ellipse className="orbit-guide orbit-guide-inner" cx="220" cy="135" rx="111" ry="60" />
              <path className="orbit-guide-front orbit-guide-front-outer" d="M 42 135 A 178 98 0 0 0 398 135" style={{ stroke: `url(#${orbitId}-front)` }} aria-hidden="true" />
              <path className="orbit-guide-front orbit-guide-front-inner" d="M 109 135 A 111 60 0 0 0 331 135" style={{ stroke: `url(#${orbitId}-front)` }} aria-hidden="true" />
              <g aria-hidden="true" pointerEvents="none">
                <path className="orbit-accent orbit-accent-outer" d="M 220 37 A 178 98 0 0 1 220 233 A 178 98 0 0 1 220 37 Z" pathLength="100" />
                <path className="orbit-accent orbit-accent-inner" d="M 220 75 A 111 60 0 0 1 220 195 A 111 60 0 0 1 220 75 Z" pathLength="100" />
                <path className="orbit-flow-glint orbit-flow-glint-outer" d="M 220 37 A 178 98 0 0 1 220 233 A 178 98 0 0 1 220 37 Z" pathLength="100" />
                <path className="orbit-flow-glint orbit-flow-glint-inner" d="M 220 75 A 111 60 0 0 1 220 195 A 111 60 0 0 1 220 75 Z" pathLength="100" />
              </g>
              <circle className="orbit-core-halo" cx="220" cy="135" r="33" />
              <ellipse className="orbit-core-glass" cx="220" cy="135" rx="54" ry="36" fill={`url(#${orbitId}-glass)`} style={{ stroke: `url(#${orbitId}-edge)` }} aria-hidden="true" />
              <path className="orbit-core-highlight" d="M 179 120 C 194 104 222 100 248 111" aria-hidden="true" />
              <image href="/judecoin-j-logo.png" x="175" y="91" width="90" height="90" aria-hidden="true" />
              {[...validatorMembers, ...workerMembers].map((member) => <g className={`orbit-member ${member.role}`} key={`${member.role}:${member.index}:${member.publicKey}`} style={{ "--orbit-x": `${member.x}px`, "--orbit-y": `${member.y}px`, "--orbit-start": `${member.index * 100 / (member.role === "validator" ? validatorMembers.length : workerMembers.length)}%`, "--orbit-end": `${member.index * 100 / (member.role === "validator" ? validatorMembers.length : workerMembers.length) + (member.role === "validator" ? -100 : 100)}%` } as CSSProperties} role="button" tabIndex={0} aria-label={`Open ${member.role === "validator" ? "validator" : "node under test"} ${member.index + 1}: ${member.publicKey}`} onClick={() => openServiceNode(member.publicKey)} onKeyDown={(event) => activateWithKeyboard(event, () => openServiceNode(member.publicKey))}>
                <title>{`${member.role === "validator" ? "Validator" : "Node under test"} ${member.index + 1} · ${member.publicKey}`}</title>
                <circle className="orbit-member-hit" cx="0" cy="0" r="22" fill="transparent" />
                <circle className="orbit-member-halo" cx="0" cy="0" r={member.role === "validator" ? 11 : 9} />
                <circle className="orbit-member-dot" cx="0" cy="0" r={member.role === "validator" ? 5 : 3.5} />
              </g>)}
            </svg>
            {!latestQuorum && <div className="quorum-orbit-empty">{"No verified membership sample"}</div>}
          </div>
          <div className="quorum-legend"><span><i className="validator-dot" aria-hidden="true" />{latestQuorum ? <b className="notranslate" translate="no">{validatorMembers.length}</b> : "—"}{" validators"}</span><span><i className="worker-dot" aria-hidden="true" />{latestQuorum ? <b className="notranslate" translate="no">{workerMembers.length}</b> : "—"}{" nodes under test"}</span></div>
          <footer className="quorum-node-health"><div><small>{"ACTIVE SERVICE NODES"}</small><strong className="notranslate" translate="no">{serviceNodes ? compact(serviceNodes.active) : "—"}{serviceNodes && <span>{` / ${compact(serviceNodes.total)}`}</span>}</strong></div><div className="quorum-active-ratio"><span className="notranslate" translate="no">{activeRatio === null ? "No verified ratio" : `${activeRatio.toFixed(1)}% active`}</span><div className="quorum-health-track" aria-hidden="true"><i style={{ width: `${activeRatio ?? 0}%` }} /></div></div></footer>
        </article>
      </div>

      <div className="metrics network-metrics">
        <article className="metric-hashrate"><small>{network?.fork?.phase === "activated" ? "CONSENSUS" : "NETWORK HASH RATE"}</small><strong className="notranslate" translate="no">{network?.fork?.phase === "activated" ? "Pure PoS" : <>{network ? (network.hashrate / 1e3).toFixed(2) : "—"} <i>{"kH/s"}</i></>}</strong><span>{network?.fork?.phase === "activated" ? `Active protocol v${network.hardFork}` : network?.targetVerified === false ? "Estimate · target unverified" : "Difficulty / target time estimate"}</span></article>
        <article className="metric-difficulty"><small>{"NETWORK DIFFICULTY"}</small><strong className="notranslate" translate="no">{network ? difficulty(network.difficulty) : "—"}</strong></article>
        <article className="block-size-card"><div className="block-size-heading"><small>{"MEDIAN BLOCK WEIGHT"}</small></div><strong className="block-size-value notranslate" translate="no">{network ? bytes(network.blockSizeMedian) : "—"}</strong>{network && <span className="block-size-limit">{`Limit ${bytes(network.blockSizeLimit)}`}</span>}</article>
        <article className="metric-protocol"><small>{"JUDE VERSION"}</small><strong className="notranslate" translate="no">{JUDE_RELEASE_VERSION}</strong><span>{network ? `Network protocol v${network.hardFork}` : "Awaiting protocol data"}</span></article>
      </div>
    </section>
  );
}
