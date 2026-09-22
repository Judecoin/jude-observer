import type { ChainSnapshot, Detail, DetailPending, DetailKind } from "../../explorer-types";
import type { Dispatch, SetStateAction, FormEvent } from "react";
import { useState, useRef, useEffect } from "react";
import { compact, bytes, difficulty, atomicJude, inOut, jude, estimatedBlockWait, estimatedBlockDate } from "../formatters";
import { TxTypeBadge } from "../components/shared";

export function useDetails({ liveNetwork, serviceNodeHeight, query, setMessage, setSearchLoading }: {
  liveNetwork: ChainSnapshot["network"] | null;
  serviceNodeHeight: number;
  query: string;
  setMessage: Dispatch<SetStateAction<string>>;
  setSearchLoading: Dispatch<SetStateAction<boolean>>;
}) {

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailPending, setDetailPending] = useState<DetailPending | null>(null);
  const [detailRenderKey, setDetailRenderKey] = useState(0);
  const detailRequestId = useRef(0);
  const detailAbortController = useRef<AbortController | null>(null);
  const detailBackdropRef = useRef<HTMLDivElement | null>(null);

  function beginDetailRequest(title: string, kind: DetailKind, message: string) {
    detailAbortController.current?.abort();
    const controller = new AbortController();
    detailAbortController.current = controller;
    const requestId = ++detailRequestId.current;
    setDetailPending({ title, kind, message });
    return { requestId, signal: controller.signal };
  }

  function resolveDetailRequest(requestId: number, nextDetail: Detail) {
    if (requestId !== detailRequestId.current) return;
    detailAbortController.current = null;
    setDetail(nextDetail);
    setDetailPending(null);
    setDetailRenderKey((value) => value + 1);
  }

  useEffect(() => {
    if (!detailRenderKey) return;
    const frame = window.requestAnimationFrame(() => {
      detailBackdropRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailRenderKey]);

  async function openBlock(id: number | string, updateHistory = true, searchResponse?: Response) {
    const request = beginDetailRequest("Block Details", "block", "Reading the selected block from the Judecoin mainnet.");
    if (updateHistory) window.history.pushState(null, "", `#block-${String(id)}`);
    try {
      const response = searchResponse ?? await fetch(`/api/block?id=${encodeURIComponent(String(id))}`, { signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Block lookup failed");
      resolveDetailRequest(request.requestId, { title: "Block Details", kind: "block", fullPage: true, rows: [], sections: [
        { kicker: "BLOCK IDENTITY", title: "Header", rows: [
          { label: "BLOCK HASH", value: data.hash },
          { label: "TIMESTAMP", value: new Date(data.timestamp * 1000).toLocaleString("en-US", { timeZoneName: "short" }) },
          { label: "CHAIN STATUS", value: data.orphan ? "Orphaned" : "Main chain" },
        ] },
        { kicker: "PUBLIC CONSENSUS DATA", title: "Consensus", rows: [
          { label: "TRANSACTIONS", value: compact(data.transactions) },
          { label: "BLOCK SIZE", value: bytes(data.size) },
          { label: "DIFFICULTY", value: difficulty(data.difficulty) },
          { label: "PROTOCOL VERSION", value: `${data.majorVersion}.${data.minorVersion}` },
          { label: "CONFIRMATIONS", value: compact(data.confirmations) },
          { label: "BLOCK REWARD", value: `${atomicJude(data.reward)} JUDE` },
        ] },
        { kicker: "BLOCK REWARD RECORD", title: "Block Reward Transaction", rows: [
          { label: "BLOCK REWARD TRANSACTION HASH", value: data.minerTransaction.hash },
          { label: "TRANSACTION PUBLIC KEY", value: data.minerTransaction.publicKey || "Not published" },
          { label: "TRANSACTION VERSION / TYPE", value: <span className="version-type-value"><code>{String(data.minerTransaction.version)}</code><i aria-hidden="true">/</i><TxTypeBadge type="block-reward" compact iconOnly /></span> },
          { label: "TRANSACTION SIZE", value: bytes(data.minerTransaction.size) },
          { label: "RINGCT", value: data.minerTransaction.ringCtType ? `Yes / type ${data.minerTransaction.ringCtType}` : "No" },
          { label: "UNLOCK HEIGHT", value: compact(data.minerTransaction.unlockHeight) },
          { label: "SERVICE NODE WINNER", value: data.minerTransaction.serviceNodeWinner || "Not available" },
        ] },
        { kicker: "PROTOCOL PAYLOAD", title: "Extra", rows: [{ label: "EXTRA", value: data.minerTransaction.extra || "None" }] },
      ], outputs: data.minerTransaction.outputs || [], outputTitle: "Block Reward Transaction Outputs", raw: JSON.stringify(data.minerTransaction.raw, null, 2), note: "Block rewards, output keys, and indices are public consensus data. Private wallet addresses and confidential transfer amounts are not requested." });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      resolveDetailRequest(request.requestId, { title: "Block Details", kind: "block", fullPage: true, rows: [{ label: "ERROR", value: error instanceof Error ? error.message : "Lookup failed" }] });
    }
  }

  function closeDetail() {
    detailAbortController.current?.abort();
    detailAbortController.current = null;
    detailRequestId.current += 1;
    setDetailPending(null);
    setDetail(null);
    if (window.location.hash.startsWith("#block-")) window.history.replaceState(null, "", "#blocks");
    else if (window.location.hash.startsWith("#tx-")) window.history.replaceState(null, "", "#transactions");
    else if (window.location.hash.startsWith("#node-")) window.history.replaceState(null, "", "#staking");
  }

  async function openTransaction(hash: string, knownType?: string, updateHistory = true, searchResponse?: Response) {
    const request = beginDetailRequest("Transaction Details", "transaction", "Reading public transaction metadata from the Judecoin mainnet.");
    if (updateHistory) window.history.pushState(null, "", `#tx-${hash}`);
    try {
      const response = searchResponse ?? await fetch(`/api/transaction?hash=${encodeURIComponent(hash)}`, { signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Transaction lookup failed");
      const confirmations = Number.isFinite(data.confirmations) ? data.confirmations : liveNetwork && data.blockHeight ? Math.max(0, liveNetwork.height - data.blockHeight + 1) : 0;
      const feePerKb = data.size > 0 ? data.fee / (data.size / 1000) : 0;

      const transactionType = knownType || data.txType || (data.transactionType === 0 ? "transfer" : "state-change");
      resolveDetailRequest(request.requestId, { title: "Transaction Details", kind: "transaction", fullPage: true, rows: [], sections: [
        { kicker: "IDENTIFIERS", title: "Transaction Identity", rows: [
          { label: "TRANSACTION HASH", value: data.hash },
          { label: "TRANSACTION PUBLIC KEY", value: data.publicKey || "Not published" },
          { label: "PAYMENT ID (ENCRYPTED)", value: data.paymentId || "Not included" },
        ] },
        { kicker: "PUBLIC ON-CHAIN DATA", title: "Metadata", rows: [
          { label: "BLOCK HEIGHT", value: data.blockHeight ? compact(data.blockHeight) : "Pending" },
          { label: "TIMESTAMP", value: data.timestamp ? new Date(data.timestamp * 1000).toLocaleString("en-US", { timeZoneName: "short" }) : "Pending" },
          { label: "TRANSACTION VERSION / TYPE", value: <span className="version-type-value"><code>{String(data.version)}</code><i aria-hidden="true">/</i><TxTypeBadge type={transactionType} compact iconOnly /></span> },
          { label: "TRANSACTION SIZE", value: bytes(data.size) },
          { label: "FEE", value: `${atomicJude(data.fee)} JUDE` },
          { label: "FEE PER KB", value: `${atomicJude(feePerKb)} JUDE` },
          { label: "CONFIRMATIONS", value: compact(confirmations) },
          { label: "RINGCT", value: data.ringCtType ? `Yes / type ${data.ringCtType}` : "No" },
          { label: "INPUTS / OUTPUTS" , value: inOut(data.inputs.length, data.outputs.length) },
          { label: "UNLOCK TIME / HEIGHT", value: compact(data.unlockTime) },
          { label: "STATUS", value: data.inPool ? "Transaction Pool" : "Confirmed" },
          { label: "DOUBLE SPEND", value: data.doubleSpendSeen ? "Detected" : "Not detected" },
        ] },
        { kicker: "PROTOCOL PAYLOAD", title: "Extra", rows: [{ label: "EXTRA", value: data.extra || "None" }] },
      ], inputs: data.inputs || [], outputs: data.outputs || [], outputTitle: "Transaction Outputs", raw: JSON.stringify(data.raw, null, 2), note: "All values shown are public, read-only chain metadata. Confidential amounts and participant wallet addresses remain hidden by the Judecoin protocol." });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      resolveDetailRequest(request.requestId, { title: "Transaction Details", kind: "transaction", fullPage: true, rows: [{ label: "ERROR", value: error instanceof Error ? error.message : "Lookup failed" }] });
    }
  }

  async function openServiceNode(key: string, updateHistory = true, searchResponse?: Response) {
    const request = beginDetailRequest("Service Node Details", "service-node", "Reading the selected Service Node record from the Judecoin mainnet.");
    if (updateHistory) window.history.pushState(null, "", `#node-${key}`);
    try {
      const response = searchResponse ?? await fetch(`/api/service-node?key=${encodeURIComponent(key)}`, { signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Service-node lookup failed");
      const contributorRows = (data.contributors || []).flatMap((contributor: { address: string; amount: number }, index: number) => [
        ...(contributor.address ? [{ label: `CONTRIBUTOR ${index + 1} ADDRESS`, value: contributor.address }] : []),
        ...(Number.isFinite(Number(contributor.amount)) ? [{ label: `CONTRIBUTOR ${index + 1} STAKE`, value: `${jude(contributor.amount)} JUDE` }] : []),
      ]);
      const pendingUnlock = !data.historical && Number(data.unlockHeight) > 0 && (serviceNodeHeight <= 0 || Number(data.unlockHeight) > serviceNodeHeight);
      const remainingUnlockBlocks = serviceNodeHeight > 0 && pendingUnlock ? Math.max(0, Number(data.unlockHeight) - serviceNodeHeight) : 0;
      const identityRows = [
        { label: "SERVICE NODE PUBLIC KEY", value: data.publicKey },
        { label: "STATUS", value: data.historical ? "Deregistered" : pendingUnlock ? "Pending Unlock" : data.unlockHeight ? "Unlock Height Reached" : data.active ? "Active" : data.funded ? "Decommissioned" : "Awaiting contributions" },
        ...(data.operatorAddress ? [{ label: "OPERATOR ADDRESS", value: data.operatorAddress }] : []),
        ...(data.publicEndpoint && data.publicEndpoint !== "Not published" ? [{ label: "PUBLIC ENDPOINT", value: data.publicEndpoint }] : []),
      ];
      const stakingRows = data.historical ? [
        ...(Number(data.registrationHeight) > 0 ? [{ label: "REGISTERED AT BLOCK" , value: compact(data.registrationHeight) }] : []),
        ...(Number(data.unlockHeight) > 0 ? [{ label: "STAKE OUTPUT UNLOCK HEIGHT", value: compact(data.unlockHeight) }] : []),
        ...(Number.isFinite(Number(data.contributions)) ? [{ label: "STAKE OUTPUTS", value: compact(data.contributions) }] : []),
        { label: "RECORD STATUS", value: "Deregistration recorded on chain" },
        ...(serviceNodeHeight > 0 && Number(data.unlockHeight) > 0 ? [{ label: "STAKE STATUS", value: serviceNodeHeight >= data.unlockHeight ? "Released" : `Locked until block ${compact(data.unlockHeight)}` }] : []),
      ] : [
        { label: "TOTAL STAKE", value: `${jude(data.totalContributed)} JUDE` },
        { label: "STAKING REQUIREMENT", value: `${jude(data.stakingRequirement)} JUDE` },
        { label: "FUNDING STATUS", value: data.funded ? "Fully funded" : "Awaiting contributions" },
        ...(Number(data.registrationHeight) > 0 ? [{ label: "REGISTERED AT BLOCK", value: compact(data.registrationHeight) }] : []),
        ...(Number(data.lastRewardHeight) > 0 ? [{ label: "LAST REWARD BLOCK", value: compact(data.lastRewardHeight) }] : []),
        ...(data.unlockHeight ? [
          { label: "UNLOCK STATUS", value: pendingUnlock ? "Scheduled — waiting for the unlock block" : "Scheduled unlock height reached" },
          { label: "SCHEDULED UNLOCK BLOCK", value: compact(data.unlockHeight) },
          ...(serviceNodeHeight > 0 && liveNetwork ? [
            { label: "CURRENT CHAIN HEIGHT", value: compact(serviceNodeHeight) },
            { label: "BLOCKS REMAINING", value: compact(remainingUnlockBlocks) },
            { label: "ESTIMATED TIME REMAINING", value: estimatedBlockWait(remainingUnlockBlocks, liveNetwork.targetSeconds) },
            { label: "ESTIMATED UNLOCK TIME (UTC)", value: estimatedBlockDate(serviceNodeHeight, Number(data.unlockHeight), liveNetwork.targetSeconds, liveNetwork.latestBlockTimestamp) },
          ] : []),
        ] : []),
        ...(Number(data.lastUptimeProof) > 0 ? [{ label: "LAST UPTIME PROOF", value: new Date(data.lastUptimeProof * 1000).toLocaleString("en-US", { timeZoneName: "short" }) }] : []),
        ...(data.version && data.version !== "Unknown" ? [{ label: "NODE VERSION", value: data.version }] : []),
        { label: "DECOMMISSIONS", value: compact(data.decommissionCount) },
      ];
      const reliableSwarmId = data.swarmId && !String(data.swarmId).includes("Unknown") && !String(data.swarmId).includes("precision not guaranteed") ? String(data.swarmId) : "";
      const protocolRows = data.historical ? [] : [
        ...(reliableSwarmId ? [{ label: "SWARM ID", value: reliableSwarmId }] : []),
        ...(Number(data.registrationProtocol) > 0 ? [{ label: "REGISTRATION PROTOCOL", value: String(data.registrationProtocol) }] : []),
        ...(Number(data.lastDecommissionHeight) > 0 ? [{ label: "LAST DECOMMISSION BLOCK", value: compact(data.lastDecommissionHeight) }] : []),
        ...(Number(data.lastIpChangeHeight) > 0 ? [{ label: "LAST IP CHANGE BLOCK", value: compact(data.lastIpChangeHeight) }] : []),
        { label: "RECOMMISSION CREDIT", value: compact(data.recommissionCredit || 0) },
        ...(Number(data.storagePort) > 0 ? [{ label: "STORAGE PORT", value: String(data.storagePort) }] : []),
        ...(Number(data.storageLmqPort) > 0 ? [{ label: "STORAGE LMQ PORT", value: String(data.storageLmqPort) }] : []),
        ...(data.ed25519PublicKey ? [{ label: "ED25519 PUBLIC KEY", value: data.ed25519PublicKey }] : []),
        ...(data.x25519PublicKey ? [{ label: "X25519 PUBLIC KEY", value: data.x25519PublicKey }] : []),
      ];
      resolveDetailRequest(request.requestId, { title: data.historical ? "Deregistered Service Node Details" : pendingUnlock ? "Pending Unlock Service Node Details" : "Service Node Details", kind: "service-node", fullPage: true, rows: [], sections: [
        { kicker: "NODE IDENTITY", title: "Identity", rows: identityRows },
        { kicker: data.historical ? "ON-CHAIN HISTORY" : pendingUnlock ? "UNLOCK SCHEDULE" : "PROOF OF STAKE", title: data.historical ? "Registration and Unlock" : pendingUnlock ? "Staking and Scheduled Unlock" : "Staking" , rows: stakingRows },
        ...(protocolRows.length ? [{ kicker: "PUBLIC NODE DATA", title: "Network and Protocol", rows: protocolRows }] : []),
        ...(contributorRows.length ? [{ kicker: "PUBLIC REGISTRATION DATA", title: "Contributors", rows: contributorRows }] : []),
      ], raw: data.raw ? JSON.stringify(data.raw, null, 2) : undefined, note: data.historical ? "Only fields retained in the public historical index are shown." : pendingUnlock ? "Estimated unlock timing is calculated from the current chain height and protocol target block time. Actual wall-clock timing may vary. Operator and contributor addresses are public Service Node registration data." : "Operator and contributor addresses are public Service Node registration data. Private keys, wallet balances, and private transaction amounts are never requested." });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      resolveDetailRequest(request.requestId, { title: "Service Node Details", kind: "service-node", fullPage: true, rows: [{ label: "ERROR", value: error instanceof Error ? error.message : "Lookup failed" }] });
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term) {
      setMessage("Enter a block height, block hash, transaction hash, or Service Node public key.");
      return;
    }
    if (/^\d+$/.test(term)) { setMessage(""); void openBlock(Number(term)); return; }
    if (!/^[a-fA-F0-9]{64}$/.test(term)) {
      setMessage("Enter a complete block height or a 64-character public identifier.");
      return;
    }
    const identifier = term.toLowerCase();
    setSearchLoading(true);
    setMessage("Searching the public chain…");
    try {
      const blockResponse = await fetch(`/api/block?id=${encodeURIComponent(identifier)}`);
      if (blockResponse.ok) { setMessage(""); await openBlock(identifier, true, blockResponse); return; }
      const transactionResponse = await fetch(`/api/transaction?hash=${encodeURIComponent(identifier)}`);
      if (transactionResponse.ok) { setMessage(""); await openTransaction(identifier, undefined, true, transactionResponse); return; }
      const nodeResponse = await fetch(`/api/service-node?key=${encodeURIComponent(identifier)}`);
      if (nodeResponse.ok) { setMessage(""); await openServiceNode(identifier, true, nodeResponse); return; }
      setMessage("No block, transaction, or Service Node matched that identifier.");
    } catch {
      setMessage("Search is temporarily unavailable. Please try again.");
    } finally {
      setSearchLoading(false);
    }
  }

  useEffect(() => {
    const openHashTarget = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#block-")) void openBlock(hash.slice(7), false);
      else if (hash.startsWith("#tx-")) void openTransaction(hash.slice(4), undefined, false);
      else if (hash.startsWith("#node-")) void openServiceNode(hash.slice(6), false);
      else setDetail(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeDetail(); };
    openHashTarget();
    window.addEventListener("popstate", openHashTarget);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("popstate", openHashTarget);
      window.removeEventListener("keydown", handleKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Subscribe once; detail reads use their arguments and stable refs, not render state.
  }, []);
  return { detail, detailPending, detailRenderKey, detailBackdropRef, openBlock, openTransaction, openServiceNode, closeDetail, search };
}
