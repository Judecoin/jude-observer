import { useId } from "react";
import { compact } from "../formatters";

export function StatNetworkVisual({ activeCount, connection }: { activeCount: number | null; connection: "loading" | "live" | "offline" }) {
  const visualId = useId().replace(/:/g, "");
  const status = activeCount === null ? "Awaiting verified snapshot" : connection === "live" ? "Reported by mainnet" : "Last verified snapshot";

  return <div className={`network-reactor stats-orbital connection-${connection}${activeCount === null ? " awaiting-snapshot" : " has-snapshot"}`} title={status} aria-label={activeCount === null ? "Awaiting a verified active Service Node count" : `${activeCount} active service nodes`}>
    <svg className="stats-orbit-svg" viewBox="0 0 480 320" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={`${visualId}-aura`}><stop stopColor="#64ffd0" stopOpacity=".16" /><stop offset=".6" stopColor="#64ffd0" stopOpacity=".04" /><stop offset="1" stopColor="#64ffd0" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${visualId}-glass`} cx=".35" cy=".15" r=".9"><stop stopColor="#b3ffe9" stopOpacity=".2" /><stop offset=".4" stopColor="#0d4034" stopOpacity=".8" /><stop offset="1" stopColor="#071d17" stopOpacity=".94" /></radialGradient>
        <linearGradient id={`${visualId}-rim`} x1="80" y1="95" x2="400" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="#64ffd0" stopOpacity=".08" /><stop offset=".34" stopColor="#b5ffeb" stopOpacity=".86" /><stop offset=".68" stopColor="#69eadb" stopOpacity=".62" /><stop offset="1" stopColor="#61c5df" stopOpacity=".08" /></linearGradient>
        <linearGradient id={`${visualId}-stream`} x1="50" y1="80" x2="430" y2="245" gradientUnits="userSpaceOnUse"><stop stopColor="#64ffd0" stopOpacity=".05" /><stop offset=".3" stopColor="#64ffd0" /><stop offset=".7" stopColor="#7fe8e1" /><stop offset="1" stopColor="#64ffd0" stopOpacity=".05" /></linearGradient>
      </defs>
      <g className="stats-orbit-assembly">
      <ellipse className="stats-orbit-aura" cx="240" cy="161" rx="230" ry="150" fill={`url(#${visualId}-aura)`} />
      <g className="stats-orbit-guides">
        <ellipse cx="240" cy="162" rx="198" ry="77" transform="rotate(-20 240 162)" />
        <ellipse cx="240" cy="162" rx="177" ry="96" transform="rotate(23 240 162)" />
        <ellipse cx="240" cy="162" rx="83" ry="131" transform="rotate(48 240 162)" />
      </g>
      <g className="stats-orbit-flow">
        <ellipse cx="240" cy="162" rx="198" ry="77" transform="rotate(-20 240 162)" stroke={`url(#${visualId}-stream)`} strokeDasharray="90 815" />
      </g>
      <g className="stats-orbit-flow stats-orbit-flow-secondary">
        <ellipse cx="240" cy="162" rx="177" ry="96" transform="rotate(23 240 162)" stroke={`url(#${visualId}-stream)`} strokeDasharray="64 820" />
      </g>
      <ellipse cx="240" cy="162" rx="109" ry="78" fill={`url(#${visualId}-glass)`} stroke={`url(#${visualId}-rim)`} className="stats-orbit-glass" />
      <path d="M143 145C176 113 257 101 306 126" stroke={`url(#${visualId}-rim)`} className="stats-orbit-glint" />
      <path d="M46 170C128 236 307 256 432 138" stroke={`url(#${visualId}-rim)`} className="stats-orbit-front" />
      </g>
    </svg>
    <div className="reactor-value stats-orbit-value"><strong className="notranslate" translate="no">{activeCount === null ? "—" : compact(activeCount)}</strong><span>{"ACTIVE SERVICE NODES"}</span></div>
    <span className="sr-only">{status}</span>
  </div>;
}
