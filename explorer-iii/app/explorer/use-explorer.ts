import { useState, useRef, useEffect, useMemo } from "react";
import type {
  ChainSnapshot,
  ServiceNodesLiveSnapshot,
  NetworkPreview,
  TransactionPoolSnapshot,
  QuorumSnapshot,
  Block,
  Transaction,
} from "../explorer-types";
import {
  lastVerifiedServiceNodesSnapshot,
  lastVerifiedNetworkPreview,
  lastVerifiedQuorumSnapshot,
  isProvisionalSnapshot,
  readClientSnapshot,
  rememberChainSnapshot,
  provisionalClientSnapshots,
} from "./snapshot-store";
import type { DeregistrationSnapshot } from "../../worker/deregistration";
import {
  CLIENT_NETWORK_SNAPSHOT_KEY,
  CLIENT_SERVICE_NODES_SNAPSHOT_KEY,
  CLIENT_QUORUM_SNAPSHOT_KEY,
  PAGE_SIZE_OPTIONS,
  CLIENT_CHAIN_SNAPSHOT_KEY,
} from "./constants";
import {
  isValidNetworkPreview,
  isValidServiceNodesSnapshot,
  isValidQuorumSnapshot,
  isValidChainSnapshot,
  isNewerHeightSnapshot,
} from "./snapshot-validation";
import { fetchSnapshot } from "./requests";
import { useDeregistrationRefresh } from "./hooks/use-deregistration-refresh";
import { useNetworkRefresh } from "./hooks/use-network-refresh";
import { useQuorumRefresh } from "./hooks/use-quorum-refresh";
import { usePoolRefresh } from "./hooks/use-pool-refresh";
import { useChainRefresh } from "./hooks/use-chain-refresh";
import { useServiceNodeRefresh } from "./hooks/use-service-node-refresh";
import { age, bytes, difficulty } from "./formatters";
import { useDetails } from "./hooks/use-details";

export function useExplorer({ serviceNodesOnly = false, statisticsOnly = false }: { serviceNodesOnly?: boolean; statisticsOnly?: boolean }) {
  const [query, setQuery] = useState("");
  const [serviceNodeQuery, setServiceNodeQuery] = useState("");
  const [message, setMessage] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<ChainSnapshot | null>(null);
  const [serviceNodesLive, setServiceNodesLive] = useState<ServiceNodesLiveSnapshot | null>(() => lastVerifiedServiceNodesSnapshot);
  const [networkPreview, setNetworkPreview] = useState<NetworkPreview | null>(() => lastVerifiedNetworkPreview);
  const [transactionPoolSnapshot, setTransactionPoolSnapshot] = useState<TransactionPoolSnapshot | null>(null);
  const [quorumLiveSnapshot, setQuorumLiveSnapshot] = useState<QuorumSnapshot | null>(() => lastVerifiedQuorumSnapshot);
  const [connection, setConnection] = useState<"loading" | "live" | "offline">("loading");
  const [blockPage, setBlockPage] = useState(0);
  const [transactionPage, setTransactionPage] = useState(0);
  const [quorumPage, setQuorumPage] = useState(0);
  const [serviceNodePage, setServiceNodePage] = useState(0);
  const [deregisteredNodePage, setDeregisteredNodePage] = useState(0);
  const [deregisteredSnapshot, setDeregisteredSnapshot] = useState<DeregistrationSnapshot | null>(null);
  const [blockPageSize, setBlockPageSize] = useState(5);
  const [transactionPageSize, setTransactionPageSize] = useState(5);
  const [quorumPageSize, setQuorumPageSize] = useState(5);
  const [serviceNodePageSize, setServiceNodePageSize] = useState(50);
  const [deregisteredNodePageSize, setDeregisteredNodePageSize] = useState(20);
  const [pageSizePreferencesLoaded, setPageSizePreferencesLoaded] = useState(false);
  const [quorumLoading, setQuorumLoading] = useState(false);
  const [lifecycleView, setLifecycleView] = useState<"unlocking" | "decommissioned" | "deregistered" | null>(null);
  const [lifecycleInitialized, setLifecycleInitialized] = useState(false);
  const highestKnownHeightRef = useRef(0);
  const serviceNodeRefreshRef = useRef<(() => void) | null>(null);
  const quorumRefreshRef = useRef<(() => void) | null>(null);
  const knownChainHeight = Math.max(
    isProvisionalSnapshot(networkPreview) ? 0 : networkPreview?.network.height ?? 0,
    isProvisionalSnapshot(snapshot) ? 0 : snapshot?.network.height ?? 0,
    isProvisionalSnapshot(serviceNodesLive) ? 0 : serviceNodesLive?.height ?? 0,
  );

  useEffect(() => {
    const restoredNetwork = readClientSnapshot(CLIENT_NETWORK_SNAPSHOT_KEY, isValidNetworkPreview);
    const restoredServiceNodes = readClientSnapshot(CLIENT_SERVICE_NODES_SNAPSHOT_KEY, isValidServiceNodesSnapshot);
    const restoredQuorums = readClientSnapshot(CLIENT_QUORUM_SNAPSHOT_KEY, isValidQuorumSnapshot);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore browser storage after hydration.
    if (restoredNetwork) setNetworkPreview((current) => current ?? restoredNetwork);
    if (restoredServiceNodes) setServiceNodesLive((current) => current ?? restoredServiceNodes);
    if (restoredQuorums) setQuorumLiveSnapshot((current) => current ?? restoredQuorums);
  }, []);
  const openSection = (section: "blocks" | "transactions" | "quorums") => {
    if (serviceNodesOnly || statisticsOnly) {
      window.location.assign(`/#${section}`);
      return;
    }
    const target = document.getElementById(section);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `#${section}`);
    }
  };
  const snapshotParams = (
    overrides: Partial<Record<"blockPage" | "blockPageSize" | "transactionPage" | "transactionPageSize" | "quorumPage" | "quorumPageSize", number>> = {},
    tip?: number,
  ) => {
    const params = new URLSearchParams({
      blockPage: String(overrides.blockPage ?? blockPage), blockPageSize: String(overrides.blockPageSize ?? blockPageSize),
      transactionPage: String(overrides.transactionPage ?? transactionPage), transactionPageSize: String(overrides.transactionPageSize ?? transactionPageSize),
      quorumPage: String(overrides.quorumPage ?? quorumPage), quorumPageSize: String(overrides.quorumPageSize ?? quorumPageSize),
    });
    if (Number.isInteger(tip) && Number(tip) >= 0) params.set("tip", String(tip));
    return params;
  };
  const prefetchSnapshot = (overrides: Parameters<typeof snapshotParams>[0]) => {
    void fetchSnapshot(snapshotParams(overrides, knownChainHeight)).catch(() => undefined);
  };
  useDeregistrationRefresh({ statisticsOnly, setDeregisteredSnapshot, knownChainHeight });
  useNetworkRefresh({ setConnection, highestKnownHeightRef, setNetworkPreview, serviceNodeRefreshRef, quorumRefreshRef });
  useQuorumRefresh({ serviceNodesOnly, statisticsOnly, pageSizePreferencesLoaded, quorumPage, quorumPageSize, highestKnownHeightRef, setQuorumLiveSnapshot, setQuorumLoading, quorumRefreshRef });
  usePoolRefresh({ serviceNodesOnly, setTransactionPoolSnapshot });
  useChainRefresh({ serviceNodesOnly, pageSizePreferencesLoaded, snapshotParams, highestKnownHeightRef, setSnapshot, setServiceNodesLive, setConnection, setQuorumLoading, blockPage, blockPageSize, transactionPage, transactionPageSize, quorumPage, quorumPageSize, snapshot, knownChainHeight });

  useServiceNodeRefresh({ highestKnownHeightRef, setServiceNodesLive, serviceNodeRefreshRef });

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("jude-explorer-page-sizes");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser preferences are unavailable during server rendering.
      if (!saved) { setPageSizePreferencesLoaded(true); return; }
      const sizes = JSON.parse(saved) as Record<string, number>;
      const valid = (value: number | undefined) => PAGE_SIZE_OPTIONS.includes(value as typeof PAGE_SIZE_OPTIONS[number]) ? value! : 5;
      setBlockPageSize(valid(sizes.blocks));
      setTransactionPageSize(valid(sizes.transactions));
      setQuorumPageSize(valid(sizes.quorums));
    } catch { /* Ignore invalid or unavailable saved page sizes. */ }
    setPageSizePreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!pageSizePreferencesLoaded) return;
    try {
      window.localStorage.setItem("jude-explorer-page-sizes", JSON.stringify({
        blocks: blockPageSize, transactions: transactionPageSize,
        quorums: quorumPageSize,
      }));
    } catch { /* Browser storage is optional. */ }
  }, [pageSizePreferencesLoaded, blockPageSize, transactionPageSize, quorumPageSize]);

  useEffect(() => {
    if (!pageSizePreferencesLoaded || serviceNodesOnly) return;
    const restored = readClientSnapshot(CLIENT_CHAIN_SNAPSHOT_KEY, isValidChainSnapshot);
    if (!restored) return;
    const matchesSelection = restored.pagination.blockPage === blockPage
      && restored.pagination.transactionPage === transactionPage
      && restored.pagination.pageSize === blockPageSize
      && restored.pagination.transactionScanSize === Math.max(160, transactionPageSize * 32)
      && restored.quorums.page === quorumPage
      && restored.quorums.pageSize === quorumPageSize;
    if (!matchesSelection) return;
    const accepted = rememberChainSnapshot(restored);
    if (!accepted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore only the verified browser snapshot matching the current selection.
    setSnapshot((current) => current ?? accepted);
  }, [pageSizePreferencesLoaded, serviceNodesOnly, blockPage, transactionPage, quorumPage,
    blockPageSize, transactionPageSize, quorumPageSize]);
  const changeQuorumPage = (nextPage: number) => {
    if (quorumLoading || nextPage < 0) return;
    setQuorumLoading(true);
    setQuorumPage(nextPage);
  };
  const changeQuorumPageSize = (nextPageSize: number) => {
    setQuorumLoading(true);
    setQuorumPageSize(nextPageSize);
    setQuorumPage(0);
  };
  const blocksSelectionMatches = snapshot?.pagination.blockPage === blockPage
    && snapshot.pagination.pageSize === blockPageSize;
  const transactionsSelectionMatches = snapshot?.pagination.transactionPage === transactionPage
    && snapshot.pagination.transactionScanSize === Math.max(160, transactionPageSize * 32);
  const blocks: Block[] = snapshot && blocksSelectionMatches ? snapshot.blocks.map((block) => ({
    height: block.height,
    age: age(block.timestamp),
    hash: block.hash,
    txs: block.txs,
    size: bytes(block.size),
    difficulty: difficulty(block.difficulty),
    fee: block.fee,
    reward: block.reward,
    inputs: block.inputs,
    outputs: block.outputs,
  })) : [];
  const transactions: Transaction[] = snapshot && transactionsSelectionMatches ? snapshot.transactions.map((tx) => ({
    hash: tx.hash,
    age: age(tx.timestamp),
    block: tx.block,
    size: bytes(tx.size),
    confirmations: tx.confirmations,
    fee: tx.fee,
    reward: tx.reward,
    inputs: tx.inputs,
    outputs: tx.outputs,
    txType: tx.txType,
  })) : [];
  const particles = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const liveNetwork = !networkPreview
    ? snapshot?.network ?? null
    : !snapshot || (isProvisionalSnapshot(snapshot) && !isProvisionalSnapshot(networkPreview)) || (
      isProvisionalSnapshot(snapshot) === isProvisionalSnapshot(networkPreview) && isNewerHeightSnapshot(
      snapshot.network.height, snapshot.fetchedAt, networkPreview.network.height, networkPreview.fetchedAt,
    )) ? networkPreview.network : snapshot.network;
  const transactionPool = transactionPoolSnapshot
    ?? (snapshot?.transactionPool.available ? snapshot.transactionPool : null);
  const chainServiceNodesSnapshot: ServiceNodesLiveSnapshot | null = snapshot ? {
    live: snapshot.live,
    fetchedAt: snapshot.fetchedAt,
    height: snapshot.serviceNodesHeight,
    serviceNodes: snapshot.serviceNodes,
  } : null;

  if (chainServiceNodesSnapshot && isProvisionalSnapshot(snapshot)) provisionalClientSnapshots.add(chainServiceNodesSnapshot);
  const selectedServiceNodesSnapshot = !serviceNodesLive
    ? chainServiceNodesSnapshot
    : !chainServiceNodesSnapshot || (isProvisionalSnapshot(chainServiceNodesSnapshot) && !isProvisionalSnapshot(serviceNodesLive)) || (
      isProvisionalSnapshot(chainServiceNodesSnapshot) === isProvisionalSnapshot(serviceNodesLive) && isNewerHeightSnapshot(
      chainServiceNodesSnapshot.height, chainServiceNodesSnapshot.fetchedAt,
      serviceNodesLive.height, serviceNodesLive.fetchedAt,
    )) ? serviceNodesLive : chainServiceNodesSnapshot;
  const serviceNodes = selectedServiceNodesSnapshot?.serviceNodes ?? null;
  const selectedLiveQuorums = quorumLiveSnapshot?.page === quorumPage
    && quorumLiveSnapshot.pageSize === quorumPageSize ? quorumLiveSnapshot : null;
  const selectedChainQuorums = snapshot?.quorums.page === quorumPage
    && snapshot.quorums.pageSize === quorumPageSize ? snapshot.quorums : null;
  const liveQuorumHeight = selectedLiveQuorums?.records[0]?.height ?? -1;
  const chainQuorumHeight = selectedChainQuorums?.records[0]?.height ?? -1;
  const quorums = selectedLiveQuorums && (
    !selectedChainQuorums
    || (isProvisionalSnapshot(snapshot) && !isProvisionalSnapshot(selectedLiveQuorums))
    || (isProvisionalSnapshot(snapshot) === isProvisionalSnapshot(selectedLiveQuorums) && (liveQuorumHeight > chainQuorumHeight
    || (liveQuorumHeight === chainQuorumHeight
      && selectedLiveQuorums.records.length >= selectedChainQuorums.records.length)))
  )
    ? selectedLiveQuorums
    : selectedChainQuorums;
  const latestQuorum = quorums?.records[0] ?? null;
  const serviceNodeHeight = selectedServiceNodesSnapshot?.height ?? 0;
  const currentServiceNodeTotal = serviceNodes?.total ?? 0;
  const displayedDeregistration = deregisteredSnapshot?.live
    ? deregisteredSnapshot
    : snapshot?.deregisteredServiceNodes;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- The empty fallback only recomputes a pure pagination slice.
  const deregisteredNodes = displayedDeregistration?.nodes ?? [];
  const deregisteredTotal = displayedDeregistration?.total ?? null;
  const deregisteredIndexedThrough = displayedDeregistration?.indexedThrough ?? null;
  const lockedDeregisteredServiceNodeTotal = serviceNodes
    ? deregisteredNodes.filter((node) => node.unlockedAt > serviceNodeHeight).length
    : 0;
  const statusTotal = currentServiceNodeTotal + lockedDeregisteredServiceNodeTotal;
  const awaitingServiceNodeRows = Array.isArray(serviceNodes?.awaitingNodes)
    ? serviceNodes.awaitingNodes
    : [];
  const unlockingServiceNodes = serviceNodes?.exiting ?? 0;
  const decommissionedServiceNodes = serviceNodes?.decommissioned ?? 0;
  const activeServiceNodes = serviceNodes?.active ?? 0;
  const awaitingServiceNodes = serviceNodes
    ? Math.max(0, serviceNodes.total - serviceNodes.funded)
    : 0;
  const statusShare = (value: number) => statusTotal > 0 ? (value / statusTotal) * 100 : 0;
  const activeEnd = statusShare(activeServiceNodes);
  const awaitingEnd = activeEnd + statusShare(awaitingServiceNodes);
  const offlineEnd = awaitingEnd + statusShare(decommissionedServiceNodes);
  const minedSupply = snapshot?.network.minedSupply ?? null;
  const stakingRatio = serviceNodes && minedSupply && minedSupply > 0
    ? (serviceNodes.totalContributed / minedSupply) * 100
    : null;
  const stakingRatioWidth = Math.min(100, Math.max(0, stakingRatio ?? 0));
  const filteredServiceNodes = useMemo(() => {
    const nodes = [...(serviceNodes?.nodes || [])].sort((a, b) =>
      b.lastRewardAt - a.lastRewardAt
      || b.registeredAt - a.registeredAt
      || a.publicKey.localeCompare(b.publicKey),
    );
    const searchTerm = serviceNodeQuery.trim().toLowerCase();
    if (!searchTerm) return nodes;
    return nodes.filter((node) => node.publicKey.toLowerCase().includes(searchTerm));
  }, [serviceNodes, serviceNodeQuery]);
  const serviceNodeLastPage = Math.max(0, Math.ceil(filteredServiceNodes.length / serviceNodePageSize) - 1);
  const paginatedServiceNodes = useMemo(
    () => filteredServiceNodes.slice(serviceNodePage * serviceNodePageSize, (serviceNodePage + 1) * serviceNodePageSize),
    [filteredServiceNodes, serviceNodePage, serviceNodePageSize],
  );
  const homepageServiceNodes = useMemo(
    () => [...(serviceNodes?.nodes || [])]
      .sort((a, b) => b.lastRewardAt - a.lastRewardAt || b.registeredAt - a.registeredAt || a.publicKey.localeCompare(b.publicKey))
      .slice(0, 5),
    [serviceNodes],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clamp the current page when the live list shrinks.
    if (serviceNodePage > serviceNodeLastPage) setServiceNodePage(serviceNodeLastPage);
  }, [serviceNodePage, serviceNodeLastPage]);
  const deregisteredNodeLastPage = Math.max(0, Math.ceil(deregisteredNodes.length / deregisteredNodePageSize) - 1);
  const paginatedDeregisteredNodes = useMemo(
    () => deregisteredNodes.slice(deregisteredNodePage * deregisteredNodePageSize, (deregisteredNodePage + 1) * deregisteredNodePageSize),
    [deregisteredNodes, deregisteredNodePage, deregisteredNodePageSize],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clamp the current page when the live list shrinks.
    if (deregisteredNodePage > deregisteredNodeLastPage) setDeregisteredNodePage(deregisteredNodeLastPage);
  }, [deregisteredNodePage, deregisteredNodeLastPage]);

  useEffect(() => {
    if (!statisticsOnly || !serviceNodes || lifecycleInitialized) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Select the initial lifecycle view once live data arrives.
    if (serviceNodes.exiting > 0) setLifecycleView("unlocking");
    else if (serviceNodes.decommissioned > 0) setLifecycleView("decommissioned");
    setLifecycleInitialized(true);
  }, [statisticsOnly, serviceNodes, lifecycleInitialized]);
  const { detail, detailPending, detailRenderKey, detailBackdropRef, openBlock, openTransaction, openServiceNode, closeDetail, search } = useDetails({ liveNetwork, serviceNodeHeight, query, setMessage, setSearchLoading });

  return { particles, serviceNodesOnly, statisticsOnly, openSection, search, query, setQuery, searchLoading, message, connection, liveNetwork, serviceNodes, transactionPool, openTransaction, blockPage, blockPageSize, setBlockPage, setBlockPageSize, prefetchSnapshot, blocks, openBlock, snapshot, blocksSelectionMatches, transactionPage, transactionPageSize, setTransactionPage, setTransactionPageSize, transactions, transactionsSelectionMatches, activeEnd, awaitingEnd, offlineEnd, statusTotal, activeServiceNodes, unlockingServiceNodes, awaitingServiceNodes, decommissionedServiceNodes, lockedDeregisteredServiceNodeTotal, currentServiceNodeTotal, stakingRatio, stakingRatioWidth, minedSupply, setLifecycleView, lifecycleView, setDeregisteredNodePage, deregisteredTotal, deregisteredIndexedThrough, deregisteredNodes, deregisteredNodePage, deregisteredNodeLastPage, deregisteredNodePageSize, setDeregisteredNodePageSize, serviceNodeHeight, openServiceNode, paginatedDeregisteredNodes, serviceNodeQuery, setServiceNodeQuery, setServiceNodePage, filteredServiceNodes, awaitingServiceNodeRows, paginatedServiceNodes, serviceNodePage, serviceNodeLastPage, serviceNodePageSize, setServiceNodePageSize, latestQuorum, quorumPage, quorums, quorumPageSize, quorumLoading, changeQuorumPage, changeQuorumPageSize, homepageServiceNodes, detailPending, closeDetail, detail, detailBackdropRef, detailRenderKey };
}
