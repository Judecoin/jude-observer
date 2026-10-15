import ExplorerClient from "./explorer/client";
import { readExplorerBootstrap } from "../worker/bootstrap-context";

export const dynamic = "force-dynamic";

export default function Home() {
  return <ExplorerClient initialData={readExplorerBootstrap()} />;
}
