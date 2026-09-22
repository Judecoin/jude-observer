import { json } from "../responses";
import { rpcFetch, rpcNodePreference, cachedRpcFetchNode } from "../rpc";
import type { RpcTransactions, RpcPoolTransaction, RpcPool, DecodedTransaction, RpcInfo, RpcOutputs } from "../rpc-types";
import { JUDECOIN_RPC_NODES } from "../constants";
import { classifyTransaction } from "../transactions";

export async function transactionResponse(url: URL): Promise<Response> {
      const hash = (url.searchParams.get("hash") || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) return json({ error: "Enter a valid 64-character transaction hash" }, 400);
      try {
        const response = await rpcFetch<RpcTransactions>("/get_transactions", {
          method: "POST",
          body: JSON.stringify({ txs_hashes: [hash], decode_as_json: true, tx_extra: true }),
        });
        let tx = response.data?.txs?.[0];
        if (!tx) {

          const lookupNodes = [...new Set([
            response.node,
            ...(rpcNodePreference.current ? [rpcNodePreference.current] : []),
            ...JUDECOIN_RPC_NODES,
          ])];
          let poolTransaction: RpcPoolTransaction | null | undefined = null;
          for (const node of lookupNodes) {
            try {
              const poolResponse = await cachedRpcFetchNode<RpcPool>(node, "/get_transaction_pool");
              poolTransaction = (Array.isArray(poolResponse.data?.transactions) ? poolResponse.data.transactions : [])
                .find((transaction) => String(transaction.id_hash || "").toLowerCase() === hash);
              if (poolTransaction) break;
            } catch {
              // Try the next public node.
            }
          }
          if (!poolTransaction) return json({ error: "Transaction not found" }, 404);
          tx = {
            tx_hash: hash,
            as_json: String(poolTransaction.tx_json || "{}"),
            block_height: 0,
            block_timestamp: Number(poolTransaction.receive_time || poolTransaction.last_relayed_time || 0),
            size: Number(poolTransaction.blob_size || poolTransaction.weight || 0),
            fee: Number(poolTransaction.fee || 0),
            in_pool: true,
            blink: Boolean(poolTransaction.blink),
            double_spend_seen: Boolean(poolTransaction.double_spend_seen),
            output_indices: [],
            extra: poolTransaction.extra,
          };
        }
        const parsed: DecodedTransaction = JSON.parse(tx.as_json || tx.tx_json || "{}");
        const extraBytes = Array.isArray(parsed.extra) ? parsed.extra : [];
        const publicKeyOffset = extraBytes.findIndex((value: number, index: number) => value === 1 && extraBytes.length >= index + 33);
        const txPublicKey = publicKeyOffset >= 0 ? extraBytes.slice(publicKeyOffset + 1, publicKeyOffset + 33).map((value: number) => value.toString(16).padStart(2, "0")).join("") : "";
        const paymentIdOffset = extraBytes.findIndex((value: number, index: number) => value === 2 && extraBytes[index + 1] === 9 && extraBytes[index + 2] === 1 && extraBytes.length >= index + 11);
        const paymentId = paymentIdOffset >= 0 ? extraBytes.slice(paymentIdOffset + 3, paymentIdOffset + 11).map((value: number) => value.toString(16).padStart(2, "0")).join("") : "";
        const inputs = (parsed.vin || []).map((input, index: number) => {
          let absoluteOffset = 0;
          const keyOffsets = Array.isArray(input.key?.key_offsets)
            ? input.key.key_offsets.map((offset: unknown) => {
                absoluteOffset += Number(offset || 0);
                return absoluteOffset;
              })
            : [];
          return {
            index,
            type: input.gen ? "coinbase" : input.key ? "key" : "special",
            keyImage: String(input.key?.k_image || ""),
            amount: Number(input.key?.amount || 0),
            ringSize: keyOffsets.length,
            keyOffsets,
            ringMembers: [] as Array<{ index: number; outputKey: string; transactionHash: string; blockHeight: number; unlocked: boolean }>,
          };
        });
        const requestedRingOutputs = inputs.flatMap((input) => input.keyOffsets.map((offset: number) => ({ amount: input.amount, index: offset })));

        const [infoResponse] = await Promise.all([
          rpcFetch<RpcInfo>("/get_info"),
          requestedRingOutputs.length ? rpcFetch<RpcOutputs>("/get_outs", {
              method: "POST",
              body: JSON.stringify({ outputs: requestedRingOutputs, get_txid: true }),
            }).then((ringResponse) => {
            const ringOutputs = Array.isArray(ringResponse.data?.outs) ? ringResponse.data.outs : [];
            let cursor = 0;
            for (const input of inputs) {
              input.ringMembers = input.keyOffsets.map((offset: number) => {
                const member = ringOutputs[cursor++] || {};
                return {
                  index: offset,
                  outputKey: String(member.key || ""),
                  transactionHash: String(member.txid || ""),
                  blockHeight: Number(member.height || 0),
                  unlocked: Boolean(member.unlocked),
                };
              });
            }
          }).catch(() => {

          }) : null,
        ]);
        return json({
          type: "transaction",
          hash: tx.tx_hash || hash,
          blockHeight: tx.block_height,
          confirmations: tx.in_pool ? 0 : Math.max(0, Number(infoResponse.data?.height || 0) - Number(tx.block_height || 0) + 1),
          timestamp: tx.block_timestamp,
          size: tx.size,
          inPool: Boolean(tx.in_pool),
          blink: Boolean(tx.blink),
          doubleSpendSeen: Boolean(tx.double_spend_seen),
          version: Number(parsed.version || 0),
          transactionType: Number(parsed.type || 0),
          txType: classifyTransaction(parsed, tx),
          unlockTime: Number(parsed.unlock_time || 0),
          fee: Number(parsed.rct_signatures?.txnFee || tx.fee || 0),
          ringCtType: Number(parsed.rct_signatures?.type || 0),
          publicKey: txPublicKey,
          paymentId,
          extra: extraBytes.map((value: number) => value.toString(16).padStart(2, "0")).join(""),
          inputs,
          outputs: (parsed.vout || []).map((output, index: number) => ({ index, key: String(output.target?.key || ""), globalIndex: Number(tx.output_indices?.[index] ?? -1), unlockHeight: Number(parsed.output_unlock_times?.[index] ?? parsed.unlock_time ?? 0), confidential: Number(output.amount || 0) === 0 })),
          raw: parsed,
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Transaction lookup failed" }, 502);
      }
    }
