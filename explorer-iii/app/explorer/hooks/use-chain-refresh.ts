import type { Dispatch, SetStateAction, RefObject } from "react";
import type { ChainSnapshot, ServiceNodesLiveSnapshot } from "../../explorer-types";
import { useEffect } from "react";
import { fetchSnapshot, fetchSnapshotWithRetry } from "../requests";
import { rememberChainSnapshot, isProvisionalSnapshot, rememberServiceNodesSnapshot } from "../snapshot-store";
import { isNewerHeightSnapshot, shouldAcceptChainSnapshot } from "../snapshot-validation";
import { TRANSACTION_POOL_REFRESH_DELAY_MS, NETWORK_REFRESH_DELAY_MS, HIDDEN_TAB_REFRESH_DELAY_MS } from "../constants";

type ChainRefreshOptions = {
  serviceNodesOnly: boolean;
  pageSizePreferencesLoaded: boolean;
  snapshotParams: (overrides?: Partial<Record<"blockPage" | "blockPageSize" | "transactionPage" | "transactionPageSize" | "quorumPage" | "quorumPageSize", number>>, tip?: number) => URLSearchParams;
  highestKnownHeightRef: RefObject<number>;
  setSnapshot: Dispatch<SetStateAction<ChainSnapshot | null>>;
  setServiceNodesLive: Dispatch<SetStateAction<ServiceNodesLiveSnapshot | null>>;
  setConnection: Dispatch<SetStateAction<"live" | "loading" | "offline">>;
  blockPage: number;
  blockPageSize: number;
  transactionPage: number;
  transactionPageSize: number;
  snapshot: ChainSnapshot | null;
  knownChainHeight: number;
  successPollDelayMs?: number;
  overviewOnly?: boolean;
};

function commitChainSnapshot(data: ChainSnapshot, options: ChainRefreshOptions) {
  const { highestKnownHeightRef, setSnapshot, setServiceNodesLive, setConnection } = options;
  highestKnownHeightRef.current = Math.max(highestKnownHeightRef.current, data.network.height);
  const acceptedChain = rememberChainSnapshot(data) || data;
  setSnapshot((current) => !current || isProvisionalSnapshot(current) || shouldAcceptChainSnapshot(current, acceptedChain)
    ? acceptedChain : current);
  if (acceptedChain.serviceNodes && acceptedChain.serviceNodesHeight != null) {
    const acceptedServiceNodes = rememberServiceNodesSnapshot({
      live: acceptedChain.live, fetchedAt: acceptedChain.fetchedAt,
      height: acceptedChain.serviceNodesHeight, serviceNodes: acceptedChain.serviceNodes,
    });
    if (acceptedServiceNodes) setServiceNodesLive((current) => !current || isProvisionalSnapshot(current) || isNewerHeightSnapshot(
      current.height, current.fetchedAt, acceptedServiceNodes.height, acceptedServiceNodes.fetchedAt,
    ) ? acceptedServiceNodes : current);
  }
  setConnection("live");
}

export function useChainRefresh(options: ChainRefreshOptions) {
  const { serviceNodesOnly, pageSizePreferencesLoaded, snapshotParams, highestKnownHeightRef,
    blockPage, blockPageSize, transactionPage, transactionPageSize, snapshot, knownChainHeight, setConnection,
    successPollDelayMs = TRANSACTION_POOL_REFRESH_DELAY_MS, overviewOnly = false } = options;

  useEffect(() => {
    if (serviceNodesOnly) return;
    if (!pageSizePreferencesLoaded) return;
    let active = true;
    let retryTimer = 0;
    let inFlight = false;
    const loadSnapshot = async () => {
      if (!active || inFlight) return;
      if (document.hidden) {
        retryTimer = window.setTimeout(loadSnapshot, HIDDEN_TAB_REFRESH_DELAY_MS);
        return;
      }
      inFlight = true;
      let nextDelay = TRANSACTION_POOL_REFRESH_DELAY_MS;
      const params = snapshotParams({}, highestKnownHeightRef.current);
      const overviewParams = new URLSearchParams(params);
      overviewParams.set("overview", "1");
      // Render validated headers immediately while the independent full request
      // decodes rewards, transaction types, fees and input/output counts.
      if (!overviewOnly) void fetchSnapshot(overviewParams).then((data) => {
        if (active) commitChainSnapshot(data, options);
      }).catch(() => { /* The full read can still succeed independently. */ });
      try {
        const data = overviewOnly ? await fetchSnapshot(overviewParams) : await fetchSnapshotWithRetry(params, 1);
        if (active) commitChainSnapshot(data, options);
        if (overviewOnly || (!data.pendingDetails && !data.headerOnly)) nextDelay = successPollDelayMs;
      } catch {
        if (active) setConnection("offline");
      } finally {
        inFlight = false;
        // Complete background snapshots may poll less often; incomplete data
        // and first-load failures still recover without another block.
        if (active) retryTimer = window.setTimeout(loadSnapshot, nextDelay);
      }
    };
    const resume = () => {
      if (!document.hidden && !inFlight) {
        window.clearTimeout(retryTimer);
        void loadSnapshot();
      }
    };
    document.addEventListener("visibilitychange", resume);
    void loadSnapshot();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", resume);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Track the selection values used by snapshotParams without restarting on every render.
  }, [serviceNodesOnly, pageSizePreferencesLoaded, blockPage, blockPageSize, transactionPage, transactionPageSize, successPollDelayMs, overviewOnly]);

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
        const params = snapshotParams({}, targetHeight);
        const overviewParams = new URLSearchParams(params);
        overviewParams.set("overview", "1");
        if (!overviewOnly) void fetchSnapshot(overviewParams).then((data) => {
          if (active) commitChainSnapshot(data, options);
        }).catch(() => { /* Keep the current verified rows visible. */ });
        const data = overviewOnly ? await fetchSnapshot(overviewParams) : await fetchSnapshotWithRetry(params, 1);
        if (!active) return;
        commitChainSnapshot(data, options);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- An overview reaching the target must not cancel its still-pending full detail request.
  }, [serviceNodesOnly, pageSizePreferencesLoaded, knownChainHeight, blockPage, blockPageSize, transactionPage, transactionPageSize, overviewOnly]);
}
