import { json } from "../responses";
import { jsonRpc, rpcFetch } from "../rpc";
import type { RpcHeader, DecodedBlock, RpcTransactions, RpcTransaction, DecodedTransaction } from "../rpc-types";

export async function blockResponse(url: URL): Promise<Response> {
      const id = url.searchParams.get("id") || "";
      const isHeight = /^\d{1,10}$/.test(id);
      const isHash = /^[a-f0-9]{64}$/i.test(id);
      if (!isHeight && !isHash) return json({ error: "Enter a valid block height or 64-character block hash" }, 400);
      try {
        const response = await jsonRpc("get_block", isHeight ? { height: Number(id) } : { hash: id.toLowerCase() });
        const header = response.data?.result?.block_header as RpcHeader | undefined;
        if (!header) return json({ error: "Block not found" }, 404);
        const blockResult = response.data?.result || {};
        const parsedBlock: DecodedBlock = JSON.parse(blockResult.json || "{}");
        const minerHash = String(blockResult.miner_tx_hash || header.miner_tx_hash || "");
        const minerResponse = minerHash ? await rpcFetch<RpcTransactions>("/get_transactions", {
          method: "POST",
          body: JSON.stringify({ txs_hashes: [minerHash], decode_as_json: true }),
        }) : { data: { txs: [] } };
        const minerRecord: Partial<RpcTransaction> = minerResponse.data?.txs?.[0] || {};
        const minerTransaction: DecodedTransaction = JSON.parse(minerRecord.as_json || JSON.stringify(parsedBlock.miner_tx || {}));
        const extraBytes = Array.isArray(minerTransaction.extra) ? minerTransaction.extra : [];
        const publicKeyOffset = extraBytes.findIndex((value: number, index: number) => value === 1 && extraBytes.length >= index + 33);
        const txPublicKey = publicKeyOffset >= 0
          ? extraBytes.slice(publicKeyOffset + 1, publicKeyOffset + 33).map((value: number) => value.toString(16).padStart(2, "0")).join("")
          : "";
        const outputs = (minerTransaction.vout || []).map((output, index: number) => ({
          index,
          amount: Number(output.amount || 0),
          key: String(output.target?.key || ""),
          globalIndex: Number(minerRecord.output_indices?.[index] ?? -1),
          unlockHeight: Number(minerTransaction.output_unlock_times?.[index] ?? minerTransaction.unlock_time ?? 0),
        }));
        return json({
          type: "block",
          height: header.height,
          hash: header.hash,
          timestamp: header.timestamp,
          transactions: header.num_txes,
          size: header.block_size,
          difficulty: header.difficulty,
          majorVersion: header.major_version,
          minorVersion: Number(header.minor_version || 0),
          orphan: Boolean(header.orphan_status),
          confirmations: Number(header.depth || 0) + 1,
          reward: Number(header.reward || 0),
          minerTransaction: {
            hash: minerHash,
            publicKey: txPublicKey,
            version: Number(minerTransaction.version || 0),
            type: Number(minerTransaction.type || 0),
            unlockHeight: Number(minerTransaction.unlock_time || 0),
            size: Number(minerRecord.size || 0),
            fee: Number(minerTransaction.rct_signatures?.txnFee || 0),
            ringCtType: Number(minerTransaction.rct_signatures?.type || 0),
            serviceNodeWinner: String(header.service_node_winner || ""),
            extra: extraBytes.map((value: number) => value.toString(16).padStart(2, "0")).join(""),
            outputs,
            raw: minerTransaction,
          },
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Block lookup failed" }, 502);
      }
    }
