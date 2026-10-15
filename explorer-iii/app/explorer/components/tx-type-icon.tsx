import { useId, type ReactNode } from "react";

export type TxTypeIconName = "block-reward" | "transfer" | "registration" | "contribution" | "recommission" | "decommission" | "deregistration" | "ip-change" | "unlock";

type IconPaint = { surface: string; facet: string; edge: string };

const typeSymbols: Record<TxTypeIconName, (paint: IconPaint) => ReactNode> = {
  "block-reward": ({ surface, facet, edge }) => <>
    <path d="m16 3 12 7-12 7-12-7 12-7Z" fill={facet} stroke={edge} />
    <path d="M4 10v13l12 7V17L4 10Z" fill={surface} stroke={edge} />
    <path d="m16 17 12-7v13l-12 7V17Z" fill={facet} stroke={edge} />
    <path d="m8 8 8-4 8 4" stroke="#b8f4dd" opacity=".55" />
    <circle cx="24" cy="24" r="5.6" fill="#0b3226" stroke={edge} />
    <path d="m24 20.8 1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1 1-2.2Z" fill="#9ae4d5" stroke="none" />
  </>,
  transfer: ({ surface, facet, edge }) => <>
    <rect x="3" y="4" width="26" height="10" rx="5" fill={surface} stroke={edge} />
    <rect x="3" y="18" width="26" height="10" rx="5" fill={facet} stroke={edge} />
    <path d="M8 9h16M24 23H8" stroke="#9ae4d5" />
    <path d="m21 6 3 3-3 3M11 20l-3 3 3 3" stroke="#a7efda" />
  </>,
  registration: ({ surface, facet, edge }) => <>
    <rect x="3" y="4" width="21" height="25" rx="5" fill={surface} stroke={edge} />
    <rect x="7" y="9" width="13" height="7" rx="2" fill={facet} stroke="none" />
    <circle cx="10" cy="12.5" r="1.25" fill="#9ae4d5" stroke="none" />
    <path d="M7 21h9M7 25h6" stroke="#77cdb3" opacity=".7" />
    <circle cx="25" cy="23" r="6" fill="#0b3226" stroke={edge} />
    <path d="M25 20v6m-3-3h6" stroke="#a7efda" />
  </>,
  contribution: ({ surface, facet, edge }) => <>
    <path d="M4 21v5a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3v-5H4Z" fill={surface} stroke={edge} />
    <circle cx="16" cy="9" r="6.5" fill={facet} stroke={edge} />
    <path d="M16 5.5v7" stroke="#a7efda" />
    <path d="M16 16v7m-3.5-3.5L16 23l3.5-3.5" stroke="#9ae4d5" />
    <path d="M8 26h16" stroke="#8ce0c1" opacity=".5" />
  </>,
  recommission: ({ surface, facet, edge }) => <>
    <circle cx="16" cy="16" r="11" fill={surface} stroke="none" />
    <path d="M27 14A11.2 11.2 0 1 0 26 22" stroke={edge} />
    <path d="M27 6v8h-8l8-8Z" fill={facet} stroke={edge} />
    <path d="m10.5 16 3.5 3.5 7.5-8" stroke="#a7efda" />
  </>,
  decommission: ({ surface, facet, edge }) => <>
    <rect x="3" y="3" width="26" height="26" rx="9" fill={surface} stroke={edge} />
    <rect x="10" y="9" width="4" height="14" rx="1.5" fill={facet} stroke="#8bddbd" />
    <rect x="18" y="9" width="4" height="14" rx="1.5" fill={facet} stroke="#8bddbd" />
    <path d="M11.5 11v9.5m8-9.5v9.5" stroke="#b1ecdb" opacity=".45" />
  </>,
  deregistration: ({ surface, facet, edge }) => <>
    <rect x="3" y="4" width="20" height="9" rx="3" fill={surface} stroke={edge} />
    <rect x="3" y="19" width="20" height="9" rx="3" fill={facet} stroke={edge} />
    <path d="M11 13v6" stroke={edge} />
    <path d="M7 8.5h3M7 23.5h3" stroke="#a7efda" />
    <circle cx="25" cy="16" r="6" fill="#0b3226" stroke={edge} />
    <path d="M21.5 16h7" stroke="#9ae4d5" />
  </>,
  "ip-change": ({ surface, facet, edge }) => <>
    <path d="M12 7.5h9.5c6 0 6 8 0 8H11c-6 0-6 9 0 9h10" stroke={edge} />
    <rect x="3" y="3" width="9" height="9" rx="3" fill={surface} stroke={edge} />
    <rect x="20" y="20" width="9" height="9" rx="3" fill={facet} stroke={edge} />
    <circle cx="7.5" cy="7.5" r="1.3" fill="#9ae4d5" stroke="none" />
    <path d="m23 22 2.5 2.5L23 27" stroke="#a7efda" />
  </>,
  unlock: ({ surface, edge }) => <>
    <path d="M10 13V8a6 6 0 0 1 11.3-2.8" stroke={edge} />
    <rect x="4" y="13" width="24" height="17" rx="5" fill={surface} stroke={edge} />
    <circle cx="16" cy="20" r="2" fill="#9ae4d5" stroke="none" />
    <path d="M16 22v3" stroke="#a7efda" />
    <path d="M8 16h5" stroke="#b1ecdb" opacity=".55" />
  </>,
};

export function TxTypeIcon({ type, size = 28 }: { type: string; size?: number }) {
  const iconId = useId().replace(/:/g, "");
  const paint: IconPaint = { surface: `url(#${iconId}-surface)`, facet: `url(#${iconId}-facet)`, edge: `url(#${iconId}-edge)` };
  const symbol = Object.hasOwn(typeSymbols, type) ? typeSymbols[type as TxTypeIconName](paint) : null;
  if (!symbol) return <span className="tx-type-icon-fallback" aria-hidden="true">?</span>;
  return <svg className="tx-type-icon" viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <defs>
      <linearGradient id={`${iconId}-surface`} x1="4" y1="3" x2="27" y2="30" gradientUnits="userSpaceOnUse"><stop stopColor="#9ae4d5" stopOpacity=".22" /><stop offset="1" stopColor="currentColor" stopOpacity=".07" /></linearGradient>
      <linearGradient id={`${iconId}-facet`} x1="5" y1="3" x2="27" y2="29" gradientUnits="userSpaceOnUse"><stop stopColor="#9ae4d5" stopOpacity=".3" /><stop offset="1" stopColor="currentColor" stopOpacity=".12" /></linearGradient>
      <linearGradient id={`${iconId}-edge`} x1="5" y1="3" x2="27" y2="29" gradientUnits="userSpaceOnUse"><stop stopColor="#acf3dc" stopOpacity=".92" /><stop offset=".5" stopColor="#8dddd0" stopOpacity=".85" /><stop offset="1" stopColor="currentColor" stopOpacity=".7" /></linearGradient>
    </defs>
    {symbol}
  </svg>;
}
