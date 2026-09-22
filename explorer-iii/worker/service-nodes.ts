import type { RpcServiceNode, RpcInfo, RpcEnvelope, RpcMethods } from "./rpc-types";
import { JUDECOIN_RPC_NODES } from "./constants";
import { rpcFetchNode, rpcNodePreference, cachedRpcResult, rpcResponseCache } from "./rpc";

function serviceNodeTotalReserved(node: RpcServiceNode) {
  return (node.contributors || []).reduce(
    (sum, contributor) => sum + Math.max(0, Number(contributor.reserved || 0)),
    0,
  );
}

function mapAwaitingServiceNodes(states: RpcServiceNode[]) {
  return states
    .filter((node) => !node.funded)
    .sort((a, b) => {
      const aRequired = Math.max(0, Number(a.staking_requirement || 0) - Number(a.total_contributed || 0));
      const bRequired = Math.max(0, Number(b.staking_requirement || 0) - Number(b.total_contributed || 0));
      return aRequired - bRequired
        || Number(b.registration_height || 0) - Number(a.registration_height || 0)
        || a.service_node_pubkey.localeCompare(b.service_node_pubkey);
    })
    .map((node) => {
      const requirement = Number(node.staking_requirement || 0);
      const contributed = Number(node.total_contributed || 0);
      const totalReserved = serviceNodeTotalReserved(node);
      return {
        publicKey: node.service_node_pubkey,
        contributors: node.contributors?.length || 0,
        maxContributors: 9,
        operatorFee: Number.isFinite(Number(node.portions_for_operator))
          ? Math.round((Number(node.portions_for_operator) / 1.8446744073709552e19) * 10_000) / 100
          : null,
        contributed,
        requirement,
        totalReserved,
        contributionRequired: Math.max(0, requirement - contributed),
        contributionOpen: Math.max(0, requirement - totalReserved),
        reservedRemaining: Math.max(0, totalReserved - contributed),
        registeredAt: Number(node.registration_height || 0),
        lastRewardAt: Number(node.last_reward_block_height || 0),
        unlockAt: Number(node.requested_unlock_height || 0),
      };
    });
}

export async function serviceNodeStatesRequest(requestedTip?: number) {
  const params = {
    fields: {
      service_node_pubkey: true,
      active: true,
      funded: true,
      staking_requirement: true,
      total_contributed: true,
      registration_height: true,
      last_reward_block_height: true,
      last_uptime_proof: true,
      service_node_version: true,
      requested_unlock_height: true,
      contributors: true,
      portions_for_operator: true,
      decommission_count: true,
      earned_downtime_blocks: true,
    },
  };
  const init = {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "explorer-read-only", method: "get_service_nodes", params }),
  };

  const cacheKey = "service-nodes:paired-v3";
  const load = async () => {
    const result = await Promise.any(JUDECOIN_RPC_NODES.map(async (node) => {
      const [infoResponse, serviceNodesResponse] = await Promise.all([
        rpcFetchNode<RpcInfo>(node, "/get_info", undefined, 35_000),
        rpcFetchNode<RpcEnvelope<RpcMethods["get_service_nodes"]>>(node, "/json_rpc", init),
      ]);
      const info = infoResponse.data;
      const serviceNodesResult = serviceNodesResponse.data?.result;
      const topHeight = Number(info?.height) - 1;
      if (info?.status !== "OK" || info?.mainnet !== true || info?.nettype !== "mainnet"
        || !Number.isInteger(info?.height) || topHeight < 0
        || serviceNodesResult?.status !== "OK"
        || !Array.isArray(serviceNodesResult?.service_node_states)
        || (Number.isInteger(requestedTip) && Number(requestedTip) >= 0 && topHeight < Number(requestedTip))) {
        throw new Error("Invalid Judecoin service-node response");
      }
      return {
        node,
        data: {
          info,
          serviceNodeStates: serviceNodesResult.service_node_states,
        },
      };
    }));
    rpcNodePreference.current = result.node;
    return result;
  };

  let result = await cachedRpcResult(cacheKey, load);
  const cachedTopHeight = Number(result.data?.info?.height) - 1;
  if (Number.isInteger(requestedTip) && Number(requestedTip) >= 0 && cachedTopHeight < Number(requestedTip)) {

    rpcResponseCache.delete(cacheKey);
    result = await cachedRpcResult(cacheKey, load);
  }
  return result;
}

export function buildServiceNodesSnapshot(currentServiceNodeStates: RpcServiceNode[], topHeight: number) {
  return {
    total: currentServiceNodeStates.length,
    active: currentServiceNodeStates.filter((node) => node.active).length,
    funded: currentServiceNodeStates.filter((node) => node.funded).length,
    exiting: currentServiceNodeStates.filter((node) => node.requested_unlock_height > topHeight).length,
    decommissioned: currentServiceNodeStates.filter(
      (node) => !node.active && node.funded && node.requested_unlock_height === 0,
    ).length,
    stakingRequirement: currentServiceNodeStates[0]?.staking_requirement || 0,
    totalContributed: currentServiceNodeStates.reduce((sum, node) => sum + Number(node.total_contributed || 0), 0),
    page: 0,
    pageSize: currentServiceNodeStates.length,
    awaitingNodes: mapAwaitingServiceNodes(currentServiceNodeStates),
    nodes: [...currentServiceNodeStates]
      .sort((a, b) => {
        return Number(b.last_reward_block_height || 0) - Number(a.last_reward_block_height || 0)
          || Number(b.registration_height || 0) - Number(a.registration_height || 0)
          || a.service_node_pubkey.localeCompare(b.service_node_pubkey);
      })
      .map((node) => ({
        publicKey: node.service_node_pubkey,
        active: node.active,
        funded: node.funded,
        contributed: node.total_contributed,
        requirement: node.staking_requirement,
        registeredAt: node.registration_height,
        lastRewardAt: node.last_reward_block_height,
        lastUptimeProof: node.last_uptime_proof,
        version: node.service_node_version.join("."),
        unlocking: node.requested_unlock_height > topHeight,
        unlockAt: Number(node.requested_unlock_height || 0),
        contributors: node.contributors?.length || 0,
        maxContributors: 9,
        operatorFee: Number.isFinite(Number(node.portions_for_operator))
          ? Math.round((Number(node.portions_for_operator) / 1.8446744073709552e19) * 10_000) / 100
          : null,
      })),
    unlockingNodes: currentServiceNodeStates
      .filter((node) => node.requested_unlock_height > topHeight)
      .sort((a, b) => a.requested_unlock_height - b.requested_unlock_height)
      .map((node) => ({
        publicKey: node.service_node_pubkey,
        contributed: Number(node.total_contributed || 0),
        registeredAt: Number(node.registration_height || 0),
        lastRewardAt: Number(node.last_reward_block_height || 0),
        unlockAt: Number(node.requested_unlock_height || 0),
      })),
    decommissionedNodes: currentServiceNodeStates
      .filter((node) => !node.active && node.funded && node.requested_unlock_height === 0)
      .sort((a, b) => b.last_uptime_proof - a.last_uptime_proof)
      .map((node) => ({
        publicKey: node.service_node_pubkey,
        contributors: node.contributors?.length || 0,
        maxContributors: 9,
        operatorFee: Number.isFinite(Number(node.portions_for_operator))
          ? Math.round((Number(node.portions_for_operator) / 1.8446744073709552e19) * 10_000) / 100
          : null,
        lastUptimeProof: Number(node.last_uptime_proof || 0),
        decommissionCount: Number(node.decommission_count || 0),
        downtimeCredit: Number(node.earned_downtime_blocks || 0),
      })),
  };
}

export async function serviceNodesLiveSnapshot(requestedTip?: number) {
  const serviceNodesResponse = await serviceNodeStatesRequest(requestedTip);
  const info = serviceNodesResponse.data?.info;
  const serviceNodeStates = serviceNodesResponse.data?.serviceNodeStates;
  if (info?.status !== "OK" || info?.mainnet !== true || info?.nettype !== "mainnet"
    || !Number.isInteger(info.height)) throw new Error("Invalid Judecoin node response");
  if (!Array.isArray(serviceNodeStates)) {
    throw new Error("Invalid Judecoin service-node response");
  }
  const topHeight = Math.max(0, info.height - 1);
  if (Number.isInteger(requestedTip) && Number(requestedTip) >= 0 && topHeight < Number(requestedTip)) {
    throw new Error("Judecoin Service Node snapshot has not reached the requested tip");
  }
  const currentServiceNodeStates = (serviceNodeStates as RpcServiceNode[]).filter(
    (node) => node.requested_unlock_height === 0 || node.requested_unlock_height > topHeight,
  );
  return {
    live: true,
    fetchedAt: new Date().toISOString(),
    height: topHeight,
    serviceNodes: buildServiceNodesSnapshot(currentServiceNodeStates, topHeight),
  };
}
