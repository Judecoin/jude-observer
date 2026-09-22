import type { DecodedTransaction, RpcExtra, RpcTransaction } from "./rpc-types";

type ExplorerTxType = "block-reward" | "transfer" | "registration" | "contribution" | "recommission" | "decommission" | "deregistration" | "ip-change" | "unlock" | "state-change";

export function classifyTransaction(parsed: DecodedTransaction | null | undefined, rpcExtra: RpcExtra | null = {}): ExplorerTxType {
  const type = Number(parsed?.type || 0);

  const extra = rpcExtra?.extra && typeof rpcExtra.extra === "object" ? rpcExtra.extra : rpcExtra;
  const state = String(extra?.sn_state_change?.type || "").toLowerCase();
  if (state === "dereg" || state === "deregister" || state === "deregistration") return "deregistration";
  if (state === "decom" || state === "decomm" || state === "decommission") return "decommission";
  if (state === "recom" || state === "recomm" || state === "recommission") return "recommission";
  if (state === "ip" || state === "ip-change" || state === "ip_change") return "ip-change";

  if (extra?.sn_registration) return "registration";
  if (extra?.sn_contributor) return "contribution";
  if (type === 2 || extra?.key_image_unlock) return "unlock";
  if (Array.isArray(parsed?.vin) && parsed.vin.some((input) => input?.gen)) return "block-reward";
  if (type === 0) return "transfer";
  if (type === 1) return "state-change";

  if (type === 3) return "state-change";
  return "state-change";
}

type VerifiedChainTransactionDetail = {
  fee: number;
  inputs: number;
  outputs: number;
  size: number;
  txType: ExplorerTxType;
};

export function verifiedChainTransactionDetails(requestedHashes: string[], rawTransactions: unknown) {
  if (!Array.isArray(rawTransactions)) {
    throw new Error("Judecoin returned no transaction-detail array");
  }
  const requested = new Set(requestedHashes.map((hash) => String(hash).toLowerCase()));
  if ([...requested].some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Judecoin returned an invalid requested transaction hash");
  }
  const details = new Map<string, VerifiedChainTransactionDetail>();
  for (const transaction of rawTransactions as RpcTransaction[]) {
    const hash = String(transaction?.tx_hash || "").toLowerCase();
    if (!requested.has(hash)) continue;
    if (details.has(hash)) throw new Error(`Judecoin returned duplicate transaction details for ${hash}`);
    if (typeof transaction?.as_json !== "string" || !transaction.as_json) {
      throw new Error(`Judecoin returned incomplete transaction details for ${hash}`);
    }
    const parsed: DecodedTransaction = JSON.parse(transaction.as_json);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.vin) || !Array.isArray(parsed.vout)) {
      throw new Error(`Judecoin returned incomplete transaction fields for ${hash}`);
    }

    const protocolZeroFee = parsed.rct_signatures?.type === 0;
    if (parsed.rct_signatures?.txnFee == null && !protocolZeroFee) {
      throw new Error(`Judecoin returned incomplete transaction fee fields for ${hash}`);
    }
    const fee = protocolZeroFee ? 0 : Number(parsed.rct_signatures!.txnFee);
    const size = Number(transaction.size);
    if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(size) || size < 0) {
      throw new Error(`Judecoin returned invalid transaction numbers for ${hash}`);
    }
    details.set(hash, {
      fee,
      inputs: parsed.vin.length,
      outputs: parsed.vout.length,
      size,
      txType: classifyTransaction(parsed, transaction),
    });
  }
  const missing = [...requested].filter((hash) => !details.has(hash));
  if (missing.length) {
    throw new Error(`Judecoin omitted ${missing.length} requested transaction detail(s)`);
  }
  return details;
}

export function requireSynchronizedPoolQuorum(count: number) {
  if (!Number.isInteger(count) || count < 2) {
    throw new Error("At least two synchronized Judecoin transaction pools are required");
  }
}
