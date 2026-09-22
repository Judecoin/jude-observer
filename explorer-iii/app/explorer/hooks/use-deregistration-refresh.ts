import type { Dispatch, SetStateAction } from "react";
import type { DeregistrationSnapshot } from "../../../worker/deregistration";
import { useEffect } from "react";
import { isNewerHeightSnapshot } from "../snapshot-validation";
import { TRANSACTION_POOL_REFRESH_DELAY_MS } from "../constants";

export function useDeregistrationRefresh({ statisticsOnly, setDeregisteredSnapshot, knownChainHeight }: {
  statisticsOnly: boolean;
  setDeregisteredSnapshot: Dispatch<SetStateAction<DeregistrationSnapshot | null>>;
  knownChainHeight: number;
}) {

  useEffect(() => {
    if (!statisticsOnly) return;
    let active = true;
    let timer = 0;
    const load = async () => {
      try {
        const response = await fetch("/api/deregistered-service-nodes", { cache: "no-store" });
        if (!response.ok) throw new Error("Deregistration data unavailable");
        const data = await response.json() as DeregistrationSnapshot;
        if (!data.live || data.status !== "live" || !Number.isInteger(data.total) || !Array.isArray(data.nodes)) {
          throw new Error("Invalid deregistration data");
        } else if (active) {
          setDeregisteredSnapshot((current) => !current || isNewerHeightSnapshot(
            current.indexedThrough, current.generatedAt, data.indexedThrough, data.generatedAt,
          ) ? data : current);
        }
      } catch {
        if (active) timer = window.setTimeout(load, TRANSACTION_POOL_REFRESH_DELAY_MS);
      }
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [statisticsOnly, knownChainHeight, setDeregisteredSnapshot]);
}
