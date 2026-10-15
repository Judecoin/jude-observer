import ExplorerClient from "../explorer/client";
import { readExplorerBootstrap } from "../../worker/bootstrap-context";

export const dynamic = "force-dynamic";

export default function StatisticsPage() {
  return <ExplorerClient statisticsOnly initialData={readExplorerBootstrap()} />;
}
