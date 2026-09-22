import type { Dispatch, SetStateAction, RefObject } from "react";
import type { ServiceNodesLiveSnapshot } from "../../explorer-types";
import { useEffect } from "react";
import {
  HIDDEN_TAB_REFRESH_DELAY_MS,
  SERVICE_NODE_REFRESH_DELAY_MS,
  SERVICE_NODE_REQUEST_TIMEOUT_MS,
  SERVICE_NODE_CATCH_UP_RETRY_DELAY_MS,
  TRANSACTION_POOL_REFRESH_DELAY_MS,
} from "../constants";
import { isValidServiceNodesSnapshot, isNewerHeightSnapshot } from "../snapshot-validation";
import { rememberServiceNodesSnapshot, isProvisionalSnapshot } from "../snapshot-store";

export function useServiceNodeRefresh({ highestKnownHeightRef, setServiceNodesLive, serviceNodeRefreshRef }: {
  highestKnownHeightRef: RefObject<number>;
  setServiceNodesLive: Dispatch<SetStateAction<ServiceNodesLiveSnapshot | null>>;
  serviceNodeRefreshRef: RefObject<(() => void) | null>;
}) {

  useEffect(() => {
    let active = true;
    let timer = 0;
    let controller: AbortController | null = null;
    let requestTimeout = 0;
    let inFlight = false;
    let refreshQueued = false;

    const refreshServiceNodes = async () => {
      if (!active || inFlight) return;
      if (document.hidden) {
        timer = window.setTimeout(refreshServiceNodes, HIDDEN_TAB_REFRESH_DELAY_MS);
        return;
      }
      inFlight = true;
      let nextDelay = SERVICE_NODE_REFRESH_DELAY_MS;
      const requestController = new AbortController();
      controller = requestController;

      requestTimeout = window.setTimeout(() => requestController.abort(), SERVICE_NODE_REQUEST_TIMEOUT_MS);
      try {
        const tip = highestKnownHeightRef.current;
        const endpoint = tip > 0 ? `/api/service-nodes-live?tip=${tip}` : "/api/service-nodes-live";
        const response = await fetch(endpoint, { cache: "no-store", signal: requestController.signal });
        if (!response.ok) throw new Error("Service Node data unavailable");
        const data = await response.json() as ServiceNodesLiveSnapshot;
        const counts = data.serviceNodes
          ? [data.serviceNodes.total, data.serviceNodes.active, data.serviceNodes.funded, data.serviceNodes.exiting, data.serviceNodes.decommissioned]
          : [];
        if (!isValidServiceNodesSnapshot(data)
          || counts.length !== 5 || counts.some((value) => !Number.isInteger(value) || value < 0)) {
          throw new Error("Invalid Service Node data");
        }
        highestKnownHeightRef.current = Math.max(highestKnownHeightRef.current, data.height);
        if (active) {
          const accepted = rememberServiceNodesSnapshot(data);
          if (accepted) setServiceNodesLive((current) => !current || isProvisionalSnapshot(current) || isNewerHeightSnapshot(
            current.height, current.fetchedAt, accepted.height, accepted.fetchedAt,
          ) ? accepted : current);
          nextDelay = data.height < highestKnownHeightRef.current
            ? SERVICE_NODE_CATCH_UP_RETRY_DELAY_MS
            : SERVICE_NODE_REFRESH_DELAY_MS;
        }
      } catch {
        // Keep the last complete Service Node snapshot visible
        nextDelay = TRANSACTION_POOL_REFRESH_DELAY_MS;
      } finally {
        window.clearTimeout(requestTimeout);
        requestTimeout = 0;
        controller = null;
        inFlight = false;
        if (active) {
          const delay = refreshQueued ? 0 : nextDelay;
          refreshQueued = false;
          timer = window.setTimeout(refreshServiceNodes, delay);
        }
      }
    };

    const requestRefresh = () => {
      if (document.hidden) return;
      if (inFlight) {
        refreshQueued = true;
        return;
      }
      window.clearTimeout(timer);
      void refreshServiceNodes();
    };
    const resume = () => { if (!document.hidden) requestRefresh(); };

    serviceNodeRefreshRef.current = requestRefresh;
    document.addEventListener("visibilitychange", resume);
    void refreshServiceNodes();
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(requestTimeout);
      window.clearTimeout(timer);
      if (serviceNodeRefreshRef.current === requestRefresh) serviceNodeRefreshRef.current = null;
      document.removeEventListener("visibilitychange", resume);
    };
  }, [highestKnownHeightRef, serviceNodeRefreshRef, setServiceNodesLive]);
}
