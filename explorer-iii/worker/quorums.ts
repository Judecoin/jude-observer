import { MAX_QUORUM_PAGE, MAX_QUORUM_TIP, JUDECOIN_RPC_NODES, EXPLORER_PAGE_SIZE } from "./constants";
import type { RpcResult, RpcEnvelope, RpcMethods } from "./rpc-types";
import { cachedRpcFetchNode, rpcNodePreference } from "./rpc";

export function requestedQuorumPage(url: URL) {
  const raw = url.searchParams.get("page") || "0";
  if (!/^\d{1,5}$/.test(raw)) throw new RangeError("Invalid quorum page");
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page < 0 || page > MAX_QUORUM_PAGE) {
    throw new RangeError("Invalid quorum page");
  }
  return page;
}

export function requestedQuorumTip(url: URL) {
  const raw = url.searchParams.get("tip");
  if (raw == null || raw === "") return undefined;
  if (!/^\d{1,9}$/.test(raw)) throw new RangeError("Invalid quorum tip");
  const tip = Number(raw);
  if (!Number.isSafeInteger(tip) || tip < 0 || tip > MAX_QUORUM_TIP) {
    throw new RangeError("Invalid quorum tip");
  }
  return tip;
}

function verifiedTestingQuorumRecords(quorumResponse: RpcResult<RpcEnvelope<RpcMethods["get_quorum_state"]>>, pageSize: number) {
  const result = quorumResponse.data?.result;
  if (result?.status !== "OK" || result.untrusted !== false || !Array.isArray(result.quorums)) {
    throw new Error("Invalid Judecoin testing-quorum response");
  }
  const records = result.quorums.map((entry) => {
    if (!Number.isInteger(entry?.height)
      || !Array.isArray(entry?.quorum?.validators)
      || !Array.isArray(entry?.quorum?.workers)) {
      throw new Error("Incomplete Judecoin testing-quorum record");
    }
    return {
      height: Number(entry.height),
      validators: entry.quorum.validators.map(String),
      workers: entry.quorum.workers.map(String),
    };
  })
    .filter((entry: { height: number }) => entry.height >= 0)
    .sort((a: { height: number }, b: { height: number }) => b.height - a.height)
    .slice(0, pageSize);
  if (!records.length) throw new Error("Judecoin returned no testing-quorum records");
  return { result, records };
}

async function verifiedTestingQuorumRequest(
  params: Record<string, unknown>,
  pageSize: number,
  expectedEndHeight?: number,
) {
  const init = {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "explorer-read-only", method: "get_quorum_state", params }),
  };
  const verified = await Promise.any(JUDECOIN_RPC_NODES.map(async (node) => {
    const response = await cachedRpcFetchNode<RpcEnvelope<RpcMethods["get_quorum_state"]>>(node, "/json_rpc", init);
    const parsed = verifiedTestingQuorumRecords(response, pageSize);
    if (expectedEndHeight != null) {
      const expectedStartHeight = Number(params.start_height);
      const expectedCount = expectedEndHeight - expectedStartHeight + 1;
      const isCompleteRange = Number.isSafeInteger(expectedStartHeight)
        && parsed.records.length === expectedCount
        && parsed.records.every((record: { height: number }, index: number) => (
          record.height === expectedEndHeight - index
        ));
      if (!isCompleteRange) {
        throw new Error("Judecoin testing-quorum data has not reached the complete requested range");
      }
    }
    return { node, ...parsed };
  }));
  rpcNodePreference.current = verified.node;
  return verified;
}

export async function quorumPageSnapshot(topHeight: number, quorumPage: number, pageSize = EXPLORER_PAGE_SIZE) {
  if (quorumPage * pageSize > topHeight) throw new RangeError("Quorum page is beyond the requested chain tip");
  const quorumEndHeight = Math.max(0, topHeight - quorumPage * pageSize);
  const { result, records } = await verifiedTestingQuorumRequest({
    quorum_type: 0,
    start_height: Math.max(0, quorumEndHeight - (pageSize - 1)),
    end_height: quorumEndHeight,
  }, pageSize, quorumEndHeight);
  const protocolHasOlder = topHeight - (quorumPage + 1) * pageSize >= 0;
  return {
    live: true,
    fetchedAt: new Date().toISOString(),
    height: topHeight,
    source: "Judecoin mainnet quorum data",
    type: "Service Node testing",
    quorumType: 0,
    trusted: result.untrusted === false,
    page: quorumPage,
    pageSize,
    hasOlder: quorumPage < MAX_QUORUM_PAGE && protocolHasOlder,
    truncated: quorumPage >= MAX_QUORUM_PAGE && protocolHasOlder,
    records,
    unavailable: ["Checkpoint", "Blink", "Pulse"],
  };
}

export async function latestQuorumSnapshot(pageSize = EXPLORER_PAGE_SIZE) {

  const { result, records } = await verifiedTestingQuorumRequest({}, 1);
  const topHeight = records[0].height;
  return {
    live: true,
    fetchedAt: new Date().toISOString(),
    height: topHeight,
    source: "Judecoin mainnet quorum data",
    type: "Service Node testing",
    quorumType: 0,
    trusted: result.untrusted === false,
    page: 0,
    pageSize,
    hasOlder: topHeight - pageSize >= 0,
    truncated: false,
    records,
    unavailable: ["Checkpoint", "Blink", "Pulse"],
  };
}
