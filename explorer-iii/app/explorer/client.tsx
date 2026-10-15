"use client";

import type { ExplorerBootstrap } from "../explorer-types";
import { useExplorer } from "./use-explorer";
import { ExplorerView } from "./components/explorer-view";

export default function ExplorerClient({ initialData, serviceNodesOnly = false, statisticsOnly = false, blocksOnly = false, transactionsOnly = false }: {
  initialData?: ExplorerBootstrap;
  serviceNodesOnly?: boolean;
  statisticsOnly?: boolean;
  blocksOnly?: boolean;
  transactionsOnly?: boolean;
}) {
  const explorer = useExplorer({ initialData, serviceNodesOnly, statisticsOnly, blocksOnly, transactionsOnly });
  return <ExplorerView {...explorer} />;
}
