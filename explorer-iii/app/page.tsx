"use client";

import { useExplorer } from "./explorer/use-explorer";
import { ExplorerView } from "./explorer/components/explorer-view";

export default function Home({ serviceNodesOnly = false, statisticsOnly = false }: { serviceNodesOnly?: boolean; statisticsOnly?: boolean }) {
  const explorer = useExplorer({ serviceNodesOnly, statisticsOnly });
  return <ExplorerView {...explorer} />;
}
