import type { Dispatch, SetStateAction, RefObject } from "react";
import type { ChainSnapshot, ServiceNodesLiveSnapshot } from "../../explorer-types";
import { useEffect } from "react";
import { fetchSnapshotWithRetry } from "../requests";
import { rememberChainSnapshot, isProvisionalSnapshot, rememberServiceNodesSnapshot } from "../snapshot-store";
import { isNewerHeightSnapshot } from "../snapshot-validation";
import { TRANSACTION_POOL_REFRESH_DELAY_MS, NETWORK_REFRESH_DELAY_MS } from "../constants";

export function useChainRefresh({ serviceNodesOnly, pageSizePreferencesLoaded, snapshotParams, highestKnownHeightRef, setSnapshot, setServiceNodesLive, setConnection, setQuorumLoading, blockPage, blockPageSize, transactionPage, transactionPageSize, quorumPage, quorumPageSize, snapshot, knownChainHeight }: {
  serviceNodesOnly: boolean;
  pageSizePreferencesLoaded: boolean;
  snapshotParams: (overrides?: Partial<Record<"blockPage" | "blockPageSize" | "transactionPage" | "transactionPageSize" | "quorumPage" | "quorumPageSize", number>>, tip?: number) => URLSearchParams;
  highestKnownHeightRef: RefObject<number>;
  setSnapshot: Dispatch<SetStateAction<ChainSnapshot | null>>;
  setServiceNodesLive: Dispatch<SetStateAction<ServiceNodesLiveSnapshot | null>>;
  setConnection: Dispatch<SetStateAction<"live" | "loading" | "offline">>;
  setQuorumLoading: Dispatch<SetStateAction<boolean>>;
  blockPage: number;
  blockPageSize: number;
  transactionPage: number;
  transactionPageSize: number;
  quorumPage: number;
  quorumPageSize: number;
  snapshot: ChainSnapshot | null;
  knownChainHeight: number;
}) {

  useEffect(() => {
    if (serviceNodesOnly) return;
    if (!pageSizePreferencesLoaded) return;
    let active = true;
    let retryTimer = 0;
    const loadSnapshot = async () => {
      try {
        const data = await fetchSnapshotWithRetry(snapshotParams());
        if (!active) return;
        highestKnownHeightRef.current = Math.max(highestKnownHeightRef.current, data.network.height);
        const acceptedChain = rememberChainSnapshot(data) || data;
        setSnapshot((current) => {
          if (!current || isProvisionalSnapshot(current)) return acceptedChain;
          const sameSelection = current.pagination.blockPage === acceptedChain.pagination.blockPage
            && current.pagination.transactionPage === acceptedChain.pagination.transactionPage
            && current.pagination.pageSize === acceptedChain.pagination.pageSize
            && current.pagination.transactionScanSize === acceptedChain.pagination.transactionScanSize
            && current.quorums.page === acceptedChain.quorums.page
            && current.quorums.pageSize === acceptedChain.quorums.pageSize;
          if (!sameSelection) return acceptedChain;
          return isNewerHeightSnapshot(
            current.network.height, current.fetchedAt, acceptedChain.network.height, acceptedChain.fetchedAt,
          ) ? acceptedChain : current;
        });
        const seed = {
          live: acceptedChain.live,
          fetchedAt: acceptedChain.fetchedAt,
          height: acceptedChain.serviceNodesHeight,
          serviceNodes: acceptedChain.serviceNodes,
        };
        const acceptedServiceNodes = rememberServiceNodesSnapshot(seed);
        if (acceptedServiceNodes) setServiceNodesLive((current) => !current || isProvisionalSnapshot(current) || isNewerHeightSnapshot(
          current.height, current.fetchedAt, acceptedServiceNodes.height, acceptedServiceNodes.fetchedAt,
        ) ? acceptedServiceNodes : current);
        setConnection("live");
      } catch {
        if (!active) return;
        setConnection("offline");
        retryTimer = window.setTimeout(loadSnapshot, TRANSACTION_POOL_REFRESH_DELAY_MS);
      } finally {
        if (active) setQuorumLoading(false);
      }
    };
    void loadSnapshot();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Track the selection values used by snapshotParams without restarting on every render.
  }, [serviceNodesOnly, pageSizePreferencesLoaded, blockPage, blockPageSize, transactionPage, transactionPageSize, quorumPage, quorumPageSize]);

  useEffect(() => {
    if (serviceNodesOnly) return;
    if (!pageSizePreferencesLoaded) return;
    const snapshotHeight = snapshot?.network.height;
    if (snapshotHeight == null || knownChainHeight <= snapshotHeight) return;
    const targetHeight = knownChainHeight;
    let active = true;
    let retryTimer = 0;
    const refreshSnapshotAtTip = async () => {
      try {
        const data = await fetchSnapshotWithRetry(snapshotParams({}, targetHeight));
        if (!active) return;
        highestKnownHeightRef.current = Math.max(highestKnownHeightRef.current, data.network.height);
        const acceptedChain = rememberChainSnapshot(data) || data;
        setSnapshot((current) => !current || isProvisionalSnapshot(current) || isNewerHeightSnapshot(
          current.network.height, current.fetchedAt, acceptedChain.network.height, acceptedChain.fetchedAt,
        ) ? acceptedChain : current);
        const seed = {
          live: acceptedChain.live,
          fetchedAt: acceptedChain.fetchedAt,
          height: acceptedChain.serviceNodesHeight,
          serviceNodes: acceptedChain.serviceNodes,
        };
        const acceptedServiceNodes = rememberServiceNodesSnapshot(seed);
        if (acceptedServiceNodes) setServiceNodesLive((current) => !current || isProvisionalSnapshot(current) || isNewerHeightSnapshot(
          current.height, current.fetchedAt, acceptedServiceNodes.height, acceptedServiceNodes.fetchedAt,
        ) ? acceptedServiceNodes : current);
        setConnection("live");
        if (data.network.height < targetHeight) {
          retryTimer = window.setTimeout(refreshSnapshotAtTip, NETWORK_REFRESH_DELAY_MS);
        }
      } catch {
        if (active) retryTimer = window.setTimeout(refreshSnapshotAtTip, NETWORK_REFRESH_DELAY_MS);
      }
    };
    void refreshSnapshotAtTip();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Track the selection values used by snapshotParams without restarting on every render.
  }, [serviceNodesOnly, pageSizePreferencesLoaded, knownChainHeight, snapshot?.network.height, blockPage, blockPageSize, transactionPage, transactionPageSize, quorumPage, quorumPageSize]);
}
