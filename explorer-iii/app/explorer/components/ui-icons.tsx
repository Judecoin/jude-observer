import type { ReactNode } from "react";

export type UiIconName = "home" | "nodes" | "statistics" | "blocks" | "transactions" | "quorums" | "search" | "copy" | "check" | "shield" | "transfer" | "registration" | "contribution" | "recommission" | "decommission" | "deregistration" | "ip-change" | "unlock" | "block-reward";

const paths: Record<UiIconName, ReactNode> = {
  home: <><rect x="3" y="3" width="7" height="7" rx="1.3" /><rect x="14" y="3" width="7" height="7" rx="1.3" /><rect x="3" y="14" width="7" height="7" rx="1.3" /><rect x="14" y="14" width="7" height="7" rx="1.3" /></>,
  nodes: <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="m10.8 7.3-4.6 8.3m7-8.3 4.6 8.3M7.5 18h9" /></>,
  statistics: <><path d="M4 20V10m8 10V4m8 16v-7M2 20h20" /><path d="m4 7 8-5 8 7" /></>,
  blocks: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></>,
  transactions: <><path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4" /></>,
  quorums: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="3.5" r="1.5" /><circle cx="4.5" cy="16.5" r="1.5" /><circle cx="19.5" cy="16.5" r="1.5" /><path d="M12 5v4m-6.2 6.7 3.6-2.1m5.2 0 3.6 2.1M7 4.7a9 9 0 0 0-4 7.5M21 12.2a9 9 0 0 0-4-7.5M7 20a9 9 0 0 0 10 0" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  shield: <><path d="m12 3 8 3v6c0 4.5-8 9-8 9s-8-4.5-8-9V6l8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  transfer: <><path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4" /></>,
  registration: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8m-4-4h8" /></>,
  contribution: <><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" /></>,
  recommission: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4V8Z" /></>,
  decommission: <><circle cx="12" cy="12" r="9" /><path d="M9 8v8m6-8v8" /></>,
  deregistration: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m9 9 6 6m0-6-6 6" /></>,
  "ip-change": <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a16 16 0 0 0 0 18 16 16 0 0 0 0-18ZM5 6.5a17 17 0 0 0 14 0M5 17.5a17 17 0 0 1 14 0" /></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3" /></>,
  "block-reward": <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9m-4-7 4 2 4-2" /></>,
};

export function UiIcon({ name, size = 20, className }: { name: UiIconName; size?: number; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
