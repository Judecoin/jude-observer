import { useState, useRef, useEffect, useMemo } from "react";
import type {
  ChainSnapshot,
  BlocksPageSnapshot,
  TransactionsPageSnapshot,
  ServiceNodesLiveSnapshot,
  NetworkPreview,
  TransactionPoolSnapshot,
  QuorumSnapshot,
  Block,
  Transaction,
  ExplorerBootstrap,
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
import { useLedgerRefresh } from "./hooks/use-ledger-refresh";

export function useExplorer({ serviceNodesOnly = false, statisticsOnly = false, blocksOnly = false, transactionsOnly = false, initialData }: { serviceNodesOnly?: boolean; statisticsOnly?: boolean; blocksOnly?: boolean; transactionsOnly?: boolean; initialData?: ExplorerBootstrap }) {
  const ledgerOnly = blocksOnly || transactionsOnly;
  const homeOnly = !serviceNodesOnly && !statisticsOnly && !ledgerOnly;
  const ledger = useLedgerRefresh(blocksOnly ? "blocks" : transactionsOnly ? "transactions" : null, { initialData: blocksOnly ? initialData?.blocks : transactionsOnly ? initialData?.transactions : null, initialRequest: initialData?.ledgerRequest });
  const homepageBlockLedger = useLedgerRefresh(homeOnly ? "blocks" : null, { scope: "home", initialData: initialData?.blocks });
  const homepageTransactionLedger = useLedgerRefresh(homeOnly ? "transactions" : null, { scope: "home", initialData: initialData?.transactions });
  const [hydrated, setHydrated] = useState(false);
  // eslint-disable-next-line react-hooks/purity -- Live relative ages advance on refresh; the first hydration render uses its fixed SSR clock.
  const displayNow = !hydrated && initialData?.renderedAt != null ? initialData.renderedAt : Date.now();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep SSR and the first hydration render on the same request-local clock.
    setHydrated(true);
  }, []);
  const [query, setQuery] = useState("");
  const [serviceNodeQuery, setServiceNodeQuery] = useState("");
  const [serviceNodeStatus, setServiceNodeStatus] = useState<"loading" | "live" | "offline">(() => initialData?.serviceNodes ? "live" : "loading");
  const [message, setMessage] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<ChainSnapshot | null>(() => initialData?.chain ?? null);
  const [serviceNodesLive, setServiceNodesLive] = useState<ServiceNodesLiveSnapshot | null>(() => initialData?.serviceNodes ?? lastVerifiedServiceNodesSnapshot);
  const [networkPreview, setNetworkPreview] = useState<NetworkPreview | null>(() => initialData?.network ?? lastVerifiedNetworkPreview);
  const [transactionPoolSnapshot, setTransactionPoolSnapshot] = useState<TransactionPoolSnapshot | null>(() => initialData?.transactionPool ?? null);
  const [quorumLiveSnapshot, setQuorumLiveSnapshot] = useState<QuorumSnapshot | null>(() => initialData?.quorums ?? lastVerifiedQuorumSnapshot);
  const [connection, setConnection] = useState<"loading" | "live" | "offline">(() => initialData?.network?.live === true && initialData.renderedAt != null
    && initialData.renderedAt - Date.parse(initialData.network.fetchedAt) <= 90_000 ? "live" : "loading");
  const [blockPage, setBlockPage] = useState(0);
  const [transactionPage, setTransactionPage] = useState(0);
  const [quorumPage, setQuorumPage] = useState(initialData?.quorums?.page ?? 0);
  const [serviceNodePage, setServiceNodePage] = useState(0);
  const [homepageServiceNodePage, setHomepageServiceNodePage] = useState(0);
  const [deregisteredNodePage, setDeregisteredNodePage] = useState(0);
  const [deregisteredSnapshot, setDeregisteredSnapshot] = useState<DeregistrationSnapshot | null>(null);
  const [blockPageSize, setBlockPageSize] = useState(10);
  const [transactionPageSize, setTransactionPageSize] = useState(10);
  const [quorumPageSize, setQuorumPageSize] = useState(initialData?.quorums?.pageSize ?? 10);
  const [serviceNodePageSize, setServiceNodePageSize] = useState(50);
  const [homepageServiceNodePageSize, setHomepageServiceNodePageSize] = useState(10);
  const [deregisteredNodePageSize, setDeregisteredNodePageSize] = useState(20);
  const [pageSizePreferencesLoaded, setPageSizePreferencesLoaded] = useState(Boolean(initialData));
  const [quorumLoading, setQuorumLoading] = useState(false);
  const [lifecycleView, setLifecycleView] = useState<"unlocking" | "decommissioned" | "deregistered" | null>(null);
  const [lifecycleInitialized, setLifecycleInitialized] = useState(false);
  const highestKnownHeightRef = useRef(Math.max(initialData?.network?.network.height ?? 0, initialData?.chain?.network.height ?? 0, initialData?.serviceNodes?.height ?? 0, initialData?.blocks?.height ?? 0, initialData?.transactions?.height ?? 0));
  const skipInitialPreferenceWriteRef = useRef(Boolean(initialData));
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
    closeDetail();
    if (serviceNodesOnly || statisticsOnly || ledgerOnly) {
      window.location.assign(`/#${section}`);
      return;
    }
    const target = document.getElementById(section);
    if (target) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      window.history.replaceState(null, "", `#${section}`);
    }
  };
  const snapshotParams = (
    overrides: Partial<Record<"blockPage" | "blockPageSize" | "transactionPage" | "transactionPageSize" | "quorumPage" | "quorumPageSize", number>> = {},
    tip?: number,
  ) => {
    const params = new URLSearchParams({
      blockPage: String(homeOnly ? 0 : overrides.blockPage ?? blockPage), blockPageSize: String(homeOnly ? 10 : overrides.blockPageSize ?? blockPageSize),
      transactionPage: String(homeOnly ? 0 : overrides.transactionPage ?? transactionPage), transactionPageSize: String(homeOnly ? 10 : overrides.transactionPageSize ?? transactionPageSize),
    });
    const minimumHeight = tip ?? knownChainHeight;
    if (minimumHeight > 0) params.set("tip", String(minimumHeight));
    return params;
  };
  const prefetchSnapshot = (overrides: Parameters<typeof snapshotParams>[0]) => {
    // Quorums have their own verified endpoint and must not rebuild the chain.
    if (overrides?.quorumPage != null || overrides?.quorumPageSize != null) return;
    void fetchSnapshot(snapshotParams(overrides, knownChainHeight)).catch(() => undefined);
  };
  useDeregistrationRefresh({ statisticsOnly, setDeregisteredSnapshot, knownChainHeight });
  useNetworkRefresh({ setConnection, highestKnownHeightRef, setNetworkPreview, serviceNodeRefreshRef, quorumRefreshRef });
  useQuorumRefresh({ serviceNodesOnly: serviceNodesOnly || ledgerOnly, statisticsOnly, pageSizePreferencesLoaded, quorumPage, quorumPageSize, highestKnownHeightRef, setQuorumLiveSnapshot, setQuorumLoading, quorumRefreshRef });
  usePoolRefresh({ serviceNodesOnly: serviceNodesOnly || ledgerOnly, setTransactionPoolSnapshot });
  useChainRefresh({ serviceNodesOnly: serviceNodesOnly || ledgerOnly, pageSizePreferencesLoaded, snapshotParams, highestKnownHeightRef, setSnapshot, setServiceNodesLive, setConnection, blockPage: homeOnly ? 0 : blockPage, blockPageSize: homeOnly ? 10 : blockPageSize, transactionPage: homeOnly ? 0 : transactionPage, transactionPageSize: homeOnly ? 10 : transactionPageSize, snapshot, knownChainHeight, successPollDelayMs: homeOnly ? 30_000 : undefined, overviewOnly: homeOnly });

  useServiceNodeRefresh({ enabled: !ledgerOnly, highestKnownHeightRef, setServiceNodesLive, serviceNodeRefreshRef, setServiceNodeStatus });

  useEffect(() => {
    if (initialData) return;
    try {
      const saved = window.localStorage.getItem("jude-explorer-page-sizes:v3");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser preferences are unavailable during server rendering.
      if (!saved) { setPageSizePreferencesLoaded(true); return; }
      const sizes = JSON.parse(saved) as Record<string, number>;
      const valid = (value: number | undefined) => PAGE_SIZE_OPTIONS.includes(value as typeof PAGE_SIZE_OPTIONS[number]) ? value! : 10;
      setBlockPageSize(valid(sizes.blocks));
      setTransactionPageSize(valid(sizes.transactions));
      setQuorumPageSize(valid(sizes.quorums));
    } catch { /* Ignore invalid or unavailable saved page sizes. */ }
    setPageSizePreferencesLoaded(true);
  }, [initialData]);

  useEffect(() => {
    if (!pageSizePreferencesLoaded) return;
    if (skipInitialPreferenceWriteRef.current) { skipInitialPreferenceWriteRef.current = false; return; }
    try {
      window.localStorage.setItem("jude-explorer-page-sizes:v3", JSON.stringify({
        blocks: blockPageSize, transactions: transactionPageSize,
        quorums: quorumPageSize,
      }));
    } catch { /* Browser storage is optional. */ }
  }, [pageSizePreferencesLoaded, blockPageSize, transactionPageSize, quorumPageSize]);

  useEffect(() => {
    if (!pageSizePreferencesLoaded || serviceNodesOnly || ledgerOnly) return;
    const restored = readClientSnapshot(CLIENT_CHAIN_SNAPSHOT_KEY, isValidChainSnapshot);
    if (!restored) return;
    const matchesSelection = restored.pagination.blockPage === blockPage
      && restored.pagination.transactionPage === transactionPage
      && restored.pagination.pageSize === blockPageSize
      && restored.pagination.transactionScanSize === Math.max(160, transactionPageSize * 32);
    if (!matchesSelection) return;
    const accepted = rememberChainSnapshot(restored);
    if (!accepted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore only the verified browser snapshot matching the current selection.
    setSnapshot((current) => current ?? accepted);
  }, [pageSizePreferencesLoaded, serviceNodesOnly, ledgerOnly, blockPage, transactionPage,
    blockPageSize, transactionPageSize]);
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
    age: age(block.timestamp, displayNow),
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
    age: age(tx.timestamp, displayNow),
    block: tx.block,
    size: bytes(tx.size),
    confirmations: tx.confirmations,
    fee: tx.fee,
    reward: tx.reward,
    inputs: tx.inputs,
    outputs: tx.outputs,
    txType: tx.txType,
  })) : [];
  const liveNetwork = !networkPreview
    ? snapshot?.network ?? null
    : !snapshot || (isProvisionalSnapshot(snapshot) && !isProvisionalSnapshot(networkPreview)) || (
      isProvisionalSnapshot(snapshot) === isProvisionalSnapshot(networkPreview) && isNewerHeightSnapshot(
      snapshot.network.height, snapshot.fetchedAt, networkPreview.network.height, networkPreview.fetchedAt,
    )) ? networkPreview.network : snapshot.network;
  const homepageBlocks: Block[] = ((homepageBlockLedger.data as BlocksPageSnapshot | null)?.rows ?? []).map((block) => ({
    ...block, age: age(block.timestamp, displayNow), size: bytes(block.size), difficulty: difficulty(block.difficulty),
  }));
  const homepageTransactions: Transaction[] = ((homepageTransactionLedger.data as TransactionsPageSnapshot | null)?.rows ?? []).map((tx) => ({
    ...tx, age: age(tx.timestamp, displayNow), size: bytes(tx.size),
    confirmations: Math.max(tx.confirmations, (liveNetwork?.height ?? homepageTransactionLedger.data!.height) - tx.block + 1),
  }));
  const transactionPool = transactionPoolSnapshot
    ?? (snapshot?.transactionPool.available ? snapshot.transactionPool : null);
  const chainServiceNodesSnapshot: ServiceNodesLiveSnapshot | null = snapshot?.serviceNodes && snapshot.serviceNodesHeight != null ? {
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
  const selectedNodes = selectedServiceNodesSnapshot?.serviceNodes ?? null;
  const serviceNodeObservedAt = selectedServiceNodesSnapshot?.fetchedAt ?? null;
  const liveForkArchive = serviceNodesLive?.serviceNodes.forkArchive;
  const serviceNodes = useMemo(() => selectedNodes ? {
    ...selectedNodes,
    forkArchive: liveForkArchive ?? selectedNodes.forkArchive,
  } : null, [selectedNodes, liveForkArchive]);
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
    ? deregisteredNodes.filter((node) => node.unlockedAt > serviceNodeHeight && node.unlockHeightVerified === true).length
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
  const homepageServiceNodeLastPage = Math.max(0, Math.ceil((serviceNodes?.nodes.length ?? 0) / homepageServiceNodePageSize) - 1);
  const homepageServiceNodes = useMemo(
    () => [...(serviceNodes?.nodes || [])]
      .sort((a, b) => b.lastRewardAt - a.lastRewardAt || b.registeredAt - a.registeredAt || a.publicKey.localeCompare(b.publicKey))
      .slice(homepageServiceNodePage * homepageServiceNodePageSize, (homepageServiceNodePage + 1) * homepageServiceNodePageSize),
    [serviceNodes, homepageServiceNodePage, homepageServiceNodePageSize],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clamp the homepage page when the live node list shrinks.
    if (homepageServiceNodePage > homepageServiceNodeLastPage) setHomepageServiceNodePage(homepageServiceNodeLastPage);
  }, [homepageServiceNodePage, homepageServiceNodeLastPage]);

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
  const { detail, detailPending, detailRenderKey, detailBackdropRef, openBlock, openTransaction, openServiceNode, closeDetail, search } = useDetails({ liveNetwork, serviceNodeHeight, query, setMessage, setSearchLoading, searchScope: blocksOnly ? "block" : transactionsOnly ? "transaction" : undefined });

  return { displayNow, serviceNodeStatus, serviceNodeObservedAt, serviceNodesOnly, statisticsOnly, blocksOnly, transactionsOnly, ledger, homepageBlockLedger, homepageTransactionLedger, homepageBlocks, homepageTransactions, homepageServiceNodePage, homepageServiceNodePageSize, homepageServiceNodeLastPage, setHomepageServiceNodePage, setHomepageServiceNodePageSize, openSection, search, query, setQuery, searchLoading, message, connection, liveNetwork, serviceNodes, transactionPool, openTransaction, blockPage, blockPageSize, setBlockPage, setBlockPageSize, prefetchSnapshot, blocks, openBlock, snapshot, blocksSelectionMatches, transactionPage, transactionPageSize, setTransactionPage, setTransactionPageSize, transactions, transactionsSelectionMatches, activeEnd, awaitingEnd, offlineEnd, statusTotal, activeServiceNodes, unlockingServiceNodes, awaitingServiceNodes, decommissionedServiceNodes, lockedDeregisteredServiceNodeTotal, currentServiceNodeTotal, stakingRatio, stakingRatioWidth, minedSupply, setLifecycleView, lifecycleView, setDeregisteredNodePage, deregisteredTotal, deregisteredIndexedThrough, deregisteredNodes, deregisteredNodePage, deregisteredNodeLastPage, deregisteredNodePageSize, setDeregisteredNodePageSize, serviceNodeHeight, openServiceNode, paginatedDeregisteredNodes, serviceNodeQuery, setServiceNodeQuery, setServiceNodePage, filteredServiceNodes, awaitingServiceNodeRows, paginatedServiceNodes, serviceNodePage, serviceNodeLastPage, serviceNodePageSize, setServiceNodePageSize, latestQuorum, quorumPage, quorums, quorumPageSize, quorumLoading, changeQuorumPage, changeQuorumPageSize, homepageServiceNodes, detailPending, closeDetail, detail, detailBackdropRef, detailRenderKey };
}
