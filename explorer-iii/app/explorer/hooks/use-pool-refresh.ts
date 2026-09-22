import type { Dispatch, SetStateAction } from "react";
import type { TransactionPoolSnapshot } from "../../explorer-types";
import { useEffect } from "react";
import { HIDDEN_TAB_REFRESH_DELAY_MS, TRANSACTION_POOL_REFRESH_DELAY_MS } from "../constants";
import { fetchTransactionPool } from "../requests";

export function usePoolRefresh({ serviceNodesOnly, setTransactionPoolSnapshot }: {
  serviceNodesOnly: boolean;
  setTransactionPoolSnapshot: Dispatch<SetStateAction<TransactionPoolSnapshot | null>>;
}) {

  useEffect(() => {
    if (serviceNodesOnly) return;
    let active = true;
    let timer = 0;
    let inFlight = false;
    const refreshTransactionPool = async () => {
      if (!active || inFlight) return;
      if (document.hidden) {
        timer = window.setTimeout(refreshTransactionPool, HIDDEN_TAB_REFRESH_DELAY_MS);
        return;
      }
      inFlight = true;
      try {
        const data = await fetchTransactionPool();
        if (active) setTransactionPoolSnapshot(data);
      } catch {
        // Preserve the last verified pool after a failed refresh.
      } finally {
        inFlight = false;
        if (active) timer = window.setTimeout(refreshTransactionPool, TRANSACTION_POOL_REFRESH_DELAY_MS);
      }
    };
    const resume = () => {
      if (!document.hidden && !inFlight) {
        window.clearTimeout(timer);
        void refreshTransactionPool();
      }
    };
    document.addEventListener("visibilitychange", resume);
    void refreshTransactionPool();
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [serviceNodesOnly, setTransactionPoolSnapshot]);
}
