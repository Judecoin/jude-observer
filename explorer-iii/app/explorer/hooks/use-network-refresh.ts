import type { Dispatch, SetStateAction, RefObject } from "react";
import type { NetworkPreview } from "../../explorer-types";
import { useEffect } from "react";
import { HIDDEN_TAB_REFRESH_DELAY_MS, NETWORK_REFRESH_DELAY_MS } from "../constants";
import { fetchNetworkPreview } from "../requests";
import { rememberNetworkPreview, isProvisionalSnapshot } from "../snapshot-store";
import { isNewerHeightSnapshot } from "../snapshot-validation";

export function useNetworkRefresh({ setConnection, highestKnownHeightRef, setNetworkPreview, serviceNodeRefreshRef, quorumRefreshRef }: {
  setConnection: Dispatch<SetStateAction<"live" | "loading" | "offline">>;
  highestKnownHeightRef: RefObject<number>;
  setNetworkPreview: Dispatch<SetStateAction<NetworkPreview | null>>;
  serviceNodeRefreshRef: RefObject<(() => void) | null>;
  quorumRefreshRef: RefObject<(() => void) | null>;
}) {

  useEffect(() => {
    let active = true;
    let timer = 0;
    let inFlight = false;
    const refreshNetwork = async () => {
      if (!active || inFlight) return;
      if (document.hidden) {
        timer = window.setTimeout(refreshNetwork, HIDDEN_TAB_REFRESH_DELAY_MS);
        return;
      }
      inFlight = true;
      try {
        const data = await fetchNetworkPreview();
        if (!active) return;
        setConnection("live");
        const previousHeight = highestKnownHeightRef.current;
        if (data.network.height < previousHeight) return;
        highestKnownHeightRef.current = Math.max(highestKnownHeightRef.current, data.network.height);
        const accepted = rememberNetworkPreview(data);
        if (accepted) setNetworkPreview((current) => !current || isProvisionalSnapshot(current) || isNewerHeightSnapshot(
          current.network.height, current.fetchedAt, accepted.network.height, accepted.fetchedAt,
        ) ? accepted : current);
        if (data.network.height > previousHeight) {
          serviceNodeRefreshRef.current?.();
          quorumRefreshRef.current?.();
        }
      } catch {

        if (active) setConnection("offline");
      } finally {
        inFlight = false;
        if (active) timer = window.setTimeout(refreshNetwork, NETWORK_REFRESH_DELAY_MS);
      }
    };
    const resume = () => {
      if (!document.hidden && !inFlight) {
        window.clearTimeout(timer);
        void refreshNetwork();
      }
    };
    document.addEventListener("visibilitychange", resume);
    void refreshNetwork();
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [highestKnownHeightRef, quorumRefreshRef, serviceNodeRefreshRef, setConnection, setNetworkPreview]);
}
