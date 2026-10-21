import type { Dispatch, SetStateAction, RefObject } from "react";
import type { QuorumSnapshot } from "../../explorer-types";
import { useEffect } from "react";
import { HIDDEN_TAB_REFRESH_DELAY_MS, QUORUM_REFRESH_DELAY_MS, QUORUM_CATCH_UP_RETRY_DELAY_MS } from "../constants";
import { rememberQuorumSnapshot, isProvisionalSnapshot } from "../snapshot-store";
import { isNewerHeightSnapshot } from "../snapshot-validation";
import { fetchExplorerJson } from "../requests";
import { LIVE_REQUEST_TIMEOUT_MS } from "../constants";

export function useQuorumRefresh({ serviceNodesOnly, statisticsOnly, pageSizePreferencesLoaded, quorumPage, quorumPageSize, highestKnownHeightRef, setQuorumLiveSnapshot, setQuorumLoading, quorumRefreshRef }: {
  serviceNodesOnly: boolean;
  statisticsOnly: boolean;
  pageSizePreferencesLoaded: boolean;
  quorumPage: number;
  quorumPageSize: number;
  highestKnownHeightRef: RefObject<number>;
  setQuorumLiveSnapshot: Dispatch<SetStateAction<QuorumSnapshot | null>>;
  setQuorumLoading: Dispatch<SetStateAction<boolean>>;
  quorumRefreshRef: RefObject<(() => void) | null>;
}) {

  useEffect(() => {
    if (serviceNodesOnly || statisticsOnly) return;
    if (!pageSizePreferencesLoaded) return;
    let active = true;
    let timer = 0;
    let inFlight = false;
    let refreshQueued = false;
    const controller = new AbortController();

    const refreshQuorums = async () => {
      if (!active || inFlight) return;
      if (document.hidden) {
        timer = window.setTimeout(refreshQuorums, HIDDEN_TAB_REFRESH_DELAY_MS);
        return;
      }
      inFlight = true;
      let nextDelay = QUORUM_REFRESH_DELAY_MS;
      try {
        const params = new URLSearchParams({ page: String(quorumPage), pageSize: String(quorumPageSize) });
        const tip = highestKnownHeightRef.current;
        if (tip > 0) params.set("tip", String(tip));
        else if (quorumPage === 0) params.set("latest", "1");
        const data = await fetchExplorerJson<QuorumSnapshot>(`/api/quorums?${params}`, "Quorum data unavailable", LIVE_REQUEST_TIMEOUT_MS, controller.signal);
        if (!data.live || data.trusted !== true || !Number.isInteger(data.height)
          || data.page !== quorumPage || data.pageSize !== quorumPageSize
          || !Array.isArray(data.records) || data.records.length === 0
          || data.records.some((record) => !Number.isInteger(record.height)
            || !Array.isArray(record.validators) || !Array.isArray(record.workers))) {
          throw new Error("Invalid quorum data");
        }
        highestKnownHeightRef.current = Math.max(highestKnownHeightRef.current, data.height);
        if (active) {
          const accepted = rememberQuorumSnapshot(data);
          if (accepted) setQuorumLiveSnapshot((current) => !current || isProvisionalSnapshot(current)
            || current.page !== accepted.page
            || current.pageSize !== accepted.pageSize
            || isNewerHeightSnapshot(current.height, current.fetchedAt, accepted.height, accepted.fetchedAt)
            ? accepted : current);
          nextDelay = data.height < highestKnownHeightRef.current
            ? QUORUM_CATCH_UP_RETRY_DELAY_MS
            : QUORUM_REFRESH_DELAY_MS;
        }
      } catch {
        nextDelay = QUORUM_REFRESH_DELAY_MS;
      } finally {
        inFlight = false;
        if (active) {
          setQuorumLoading(false);
          const delay = refreshQueued ? 0 : nextDelay;
          refreshQueued = false;
          timer = window.setTimeout(refreshQuorums, delay);
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
      void refreshQuorums();
    };
    const resume = () => { if (!document.hidden) requestRefresh(); };

    quorumRefreshRef.current = requestRefresh;
    document.addEventListener("visibilitychange", resume);
    void refreshQuorums();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
      if (quorumRefreshRef.current === requestRefresh) quorumRefreshRef.current = null;
      document.removeEventListener("visibilitychange", resume);
    };
  }, [serviceNodesOnly, statisticsOnly, pageSizePreferencesLoaded, quorumPage, quorumPageSize, quorumRefreshRef, highestKnownHeightRef, setQuorumLiveSnapshot, setQuorumLoading]);
}
