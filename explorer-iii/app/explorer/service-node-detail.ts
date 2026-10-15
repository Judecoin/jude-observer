import type { ChainSnapshot, Detail } from "../explorer-types";
import { compact, jude, serviceNodeUnlockEstimate, utcTimestamp } from "./formatters";

export type ServiceNodeDetailRecord = {
  publicKey: string;
  historical?: boolean;
  active?: boolean;
  funded?: boolean;
  unlockHeight?: number;
  unlockHeightVerified?: boolean;
  sourceHeight?: number | null;
  registrationHeight?: number;
  contributions?: number;
  operatorAddress?: string | null;
  publicEndpoint?: string | null;
  totalContributed?: number;
  stakingRequirement?: number;
  lastRewardHeight?: number;
  lastUptimeProof?: number;
  version?: string | null;
  decommissionCount?: number;
  swarmId?: string | null;
  registrationProtocol?: number;
  lastDecommissionHeight?: number;
  lastIpChangeHeight?: number;
  recommissionCredit?: number;
  storagePort?: number;
  storageLmqPort?: number;
  ed25519PublicKey?: string;
  x25519PublicKey?: string;
  contributors?: Array<{ address?: string; amount?: number }>;
  raw?: unknown;
};

export function createServiceNodeDetail(data: ServiceNodeDetailRecord, liveNetwork: ChainSnapshot["network"] | null, serviceNodeHeight: number): Detail {
  const contributorRows = (data.contributors || []).flatMap((contributor, index) => [
    ...(contributor.address ? [{ label: `CONTRIBUTOR ${index + 1} ADDRESS`, value: contributor.address }] : []),
    ...(Number.isFinite(Number(contributor.amount)) ? [{ label: `CONTRIBUTOR ${index + 1} STAKE`, value: `${jude(Number(contributor.amount))} JUDE` }] : []),
  ]);
  const unlockHeight = Number(data.unlockHeight || 0);
  const currentHeight = Math.max(serviceNodeHeight, liveNetwork?.height ?? 0, data.sourceHeight ?? 0);
  const knownUnlock = Number.isSafeInteger(unlockHeight) && unlockHeight > 0;
  const pendingUnlock = knownUnlock && (currentHeight <= 0 || unlockHeight > currentHeight);
  const verifiedSchedule = !data.historical || data.unlockHeightVerified === true;
  const estimate = pendingUnlock && verifiedSchedule ? serviceNodeUnlockEstimate(unlockHeight, liveNetwork, currentHeight) : null;
  const estimateRows = estimate ? [
    { label: "CURRENT CHAIN HEIGHT", value: compact(estimate.currentHeight) },
    { label: "BLOCKS REMAINING", value: compact(estimate.remainingBlocks) },
    { label: "ESTIMATED TIME REMAINING", value: estimate.wait },
    ...(estimate.date ? [{ label: "ESTIMATED UNLOCK TIME (UTC)", value: estimate.date }] : []),
  ] : [];
  const identityRows = [
    { label: "SERVICE NODE PUBLIC KEY", value: data.publicKey },
    { label: "STATUS", value: data.historical ? pendingUnlock && verifiedSchedule ? "Deregistered — stake locked" : knownUnlock && !pendingUnlock ? "Deregistered — unlock height reached" : "Deregistered — historical record" : pendingUnlock ? "Pending Unlock" : knownUnlock ? "Unlock Height Reached" : data.active ? "Active" : data.funded ? "Decommissioned" : "Awaiting contributions" },
    ...(data.operatorAddress ? [{ label: "OPERATOR ADDRESS", value: data.operatorAddress }] : []),
    ...(data.publicEndpoint && data.publicEndpoint !== "Not published" ? [{ label: "PUBLIC ENDPOINT", value: data.publicEndpoint }] : []),
  ];
  const stakingRows = data.historical ? [
    ...(Number(data.registrationHeight) > 0 ? [{ label: "REGISTERED AT BLOCK" , value: compact(Number(data.registrationHeight || 0)) }] : []),
    ...(Number(data.unlockHeight) > 0 ? [{ label: "STAKE OUTPUT UNLOCK HEIGHT", value: compact(Number(data.unlockHeight || 0)) }] : []),
    ...(Number.isFinite(Number(data.contributions)) ? [{ label: "STAKE OUTPUTS", value: compact(Number(data.contributions || 0)) }] : []),
    { label: "RECORD STATUS", value: "Deregistration recorded on chain" },
    ...(currentHeight > 0 && knownUnlock ? [{ label: "STAKE STATUS", value: !pendingUnlock ? "Unlock height reached" : verifiedSchedule ? `Locked until block ${compact(unlockHeight)}` : "Historical unlock schedule — current lock not verified" }] : []),
    ...estimateRows,
  ] : [
    { label: "TOTAL STAKE", value: `${jude(Number(data.totalContributed || 0))} JUDE` },
    { label: "STAKING REQUIREMENT", value: `${jude(Number(data.stakingRequirement || 0))} JUDE` },
    { label: "FUNDING STATUS", value: data.funded ? "Fully funded" : "Awaiting contributions" },
    ...(Number(data.registrationHeight) > 0 ? [{ label: "REGISTERED AT BLOCK", value: compact(Number(data.registrationHeight || 0)) }] : []),
    ...(Number(data.lastRewardHeight) > 0 ? [{ label: "LAST REWARD BLOCK", value: compact(Number(data.lastRewardHeight || 0)) }] : []),
    ...(data.unlockHeight ? [
      { label: "UNLOCK STATUS", value: pendingUnlock ? "Scheduled — waiting for the unlock block" : "Scheduled unlock height reached" },
      { label: "SCHEDULED UNLOCK BLOCK", value: compact(Number(data.unlockHeight || 0)) },
      ...estimateRows,
    ] : []),
    ...(Number(data.lastUptimeProof) > 0 ? [{ label: "LAST UPTIME PROOF", value: utcTimestamp(Number(data.lastUptimeProof)) }] : []),
    ...(data.version && data.version !== "Unknown" ? [{ label: "NODE VERSION", value: data.version }] : []),
    { label: "DECOMMISSIONS", value: compact(Number(data.decommissionCount || 0)) },
  ];
  const reliableSwarmId = data.swarmId && !String(data.swarmId).includes("Unknown") && !String(data.swarmId).includes("precision not guaranteed") ? String(data.swarmId) : "";
  const protocolRows = data.historical ? [] : [
    ...(reliableSwarmId ? [{ label: "SWARM ID", value: reliableSwarmId }] : []),
    ...(Number(data.registrationProtocol) > 0 ? [{ label: "REGISTRATION PROTOCOL", value: String(data.registrationProtocol) }] : []),
    ...(Number(data.lastDecommissionHeight) > 0 ? [{ label: "LAST DECOMMISSION BLOCK", value: compact(Number(data.lastDecommissionHeight || 0)) }] : []),
    ...(Number(data.lastIpChangeHeight) > 0 ? [{ label: "LAST IP CHANGE BLOCK", value: compact(Number(data.lastIpChangeHeight || 0)) }] : []),
    { label: "RECOMMISSION CREDIT", value: compact(data.recommissionCredit || 0) },
    ...(Number(data.storagePort) > 0 ? [{ label: "STORAGE PORT", value: String(data.storagePort) }] : []),
    ...(Number(data.storageLmqPort) > 0 ? [{ label: "STORAGE LMQ PORT", value: String(data.storageLmqPort) }] : []),
    ...(data.ed25519PublicKey ? [{ label: "ED25519 PUBLIC KEY", value: data.ed25519PublicKey }] : []),
    ...(data.x25519PublicKey ? [{ label: "X25519 PUBLIC KEY", value: data.x25519PublicKey }] : []),
  ];
  return { title: data.historical ? "Deregistered Service Node Details" : pendingUnlock ? "Pending Unlock Service Node Details" : "Service Node Details", kind: "service-node", fullPage: true, rows: [], sections: [
    { kicker: "NODE IDENTITY", title: "Identity", rows: identityRows },
    { kicker: data.historical ? "ON-CHAIN HISTORY" : pendingUnlock ? "UNLOCK SCHEDULE" : "PROOF OF STAKE", title: data.historical ? "Registration and Unlock" : pendingUnlock ? "Staking and Scheduled Unlock" : "Staking" , rows: stakingRows },
    ...(protocolRows.length ? [{ kicker: "PUBLIC NODE DATA", title: "Network and Protocol", rows: protocolRows }] : []),
    ...(contributorRows.length ? [{ kicker: "PUBLIC REGISTRATION DATA", title: "Contributors", rows: contributorRows }] : []),
  ], raw: data.raw ? JSON.stringify(data.raw, null, 2) : undefined, note: data.historical ? estimate ? "Estimated unlock timing uses the verified stake unlock height and the reported target block time. Actual timing depends on block production. Only public deregistration fields are shown." : "Only fields retained in the public historical index are shown. Reaching a scheduled height does not establish the exact wall-clock unlock time." : pendingUnlock ? "Estimated unlock timing is calculated from the current chain height and protocol target block time. Actual wall-clock timing may vary. Operator and contributor addresses are public Service Node registration data." : "Operator and contributor addresses are public Service Node registration data. Private keys, wallet balances, and private transaction amounts are never requested." };
}
