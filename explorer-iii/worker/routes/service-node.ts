import { deregistrationTracker } from "../deregistration-source";
import { json } from "../responses";
import { jsonRpc } from "../rpc";
import deregisteredHistory from "../../data/deregistered-service-nodes.json";

export async function deregisteredNodesResponse(url: URL): Promise<Response> {
      const data = await deregistrationTracker(url.origin).read();
      return new Response(JSON.stringify(data), {
        status: data.status === "unavailable" ? 503 : 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

export async function serviceNodeResponse(url: URL): Promise<Response> {
      const key = (url.searchParams.get("key") || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(key)) return json({ error: "Enter a valid 64-character service-node public key" }, 400);
      try {
        const response = await jsonRpc("get_service_nodes", {
          service_node_pubkeys: [key],
          fields: {
            service_node_pubkey: true,
            active: true,
            funded: true,
            operator_address: true,
            contributors: true,
            public_ip: true,
            quorumnet_port: true,
            staking_requirement: true,
            total_contributed: true,
            registration_height: true,
            last_reward_block_height: true,
            last_uptime_proof: true,
            service_node_version: true,
            requested_unlock_height: true,
            decommission_count: true,
            swarm_id: true,
            last_decommission_height: true,
            last_ip_change_height: true,
            recommission_credit: true,
            registration_hf_version: true,
            storage_port: true,
            storage_lmq_port: true,
            pubkey_ed25519: true,
            pubkey_x25519: true,
          },
        });
        const node = response.data?.result?.service_node_states?.[0];
        if (!node) {
          const tracker = deregistrationTracker(url.origin);
          const current = await tracker.read();
          const historicalNode = tracker.find(key) || deregisteredHistory.nodes.find((entry) => entry.publicKey === key);
          if (!historicalNode && !current.live) return json({ error: "Service node records are synchronizing" }, 503);
          if (!historicalNode) return json({ error: "Service node not found" }, 404);
          return json({
            type: "service-node",
            historical: true,
            publicKey: historicalNode.publicKey,
            active: false,
            funded: false,
            registrationHeight: historicalNode.registeredAt,
            unlockHeight: historicalNode.unlockedAt,
            contributions: historicalNode.contributions,
          });
        }
        return json({
          type: "service-node",
          publicKey: node.service_node_pubkey,
          active: Boolean(node.active),
          funded: Boolean(node.funded),
          operatorAddress: node.operator_address || null,
          publicEndpoint: node.public_ip ? [node.public_ip, node.quorumnet_port].filter(Boolean).join(":") : null,
          stakingRequirement: Number(node.staking_requirement || 0),
          totalContributed: Number(node.total_contributed || 0),
          registrationHeight: Number(node.registration_height || 0),
          lastRewardHeight: Number(node.last_reward_block_height || 0),
          lastUptimeProof: Number(node.last_uptime_proof || 0),
          version: Array.isArray(node.service_node_version) && node.service_node_version.length ? node.service_node_version.join(".") : null,
          unlockHeight: Number(node.requested_unlock_height || 0),
          decommissionCount: Number(node.decommission_count || 0),
          swarmId: node.swarm_id == null ? null : Number.isSafeInteger(node.swarm_id) ? String(node.swarm_id) : `${String(node.swarm_id)} (numeric precision not guaranteed)`,
          lastDecommissionHeight: Number(node.last_decommission_height || 0),
          lastIpChangeHeight: Number(node.last_ip_change_height || 0),
          recommissionCredit: Number(node.recommission_credit || 0),
          registrationProtocol: Number(node.registration_hf_version || 0),
          storagePort: Number(node.storage_port || 0),
          storageLmqPort: Number(node.storage_lmq_port || 0),
          ed25519PublicKey: String(node.pubkey_ed25519 || ""),
          x25519PublicKey: String(node.pubkey_x25519 || ""),
          contributors: (node.contributors || []).map((contributor) => ({
            address: contributor.address,
            amount: Number(contributor.amount || 0),
            reserved: Number(contributor.reserved || 0),
          })),
          raw: node,
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Service-node lookup failed" }, 502);
      }
    }
