import { cachedJsonRpc } from "./rpc";
import { buildForkSnapshot, POS_FORK_HEIGHT } from "./fork";
import type { RpcHeader } from "./rpc-types";
import type { ForkSnapshot } from "../app/explorer-types";

const ACTIVATION_PROOF_TTL_MS = 30_000;
const ACTIVATION_PROOF_BUDGET_MS = 1_000;
let verifiedActivationProof: { block: NonNullable<ForkSnapshot["activationBlock"]>; checkedAt: number } | null = null;
let pendingActivationProof: Promise<ForkSnapshot["activationBlock"]> | null = null;

function activationProofRequest(): Promise<ForkSnapshot["activationBlock"]> {
  if (pendingActivationProof) return pendingActivationProof;
  pendingActivationProof = cachedJsonRpc("get_block_headers_range", {
    start_height: POS_FORK_HEIGHT, end_height: POS_FORK_HEIGHT, fill_pow_hash: false,
  }).then((response) => {
    const header = (response.data?.result?.headers ?? []).find((candidate: RpcHeader) => candidate.height === POS_FORK_HEIGHT);
    if (!header || header.orphan_status === true || !/^[a-f0-9]{64}$/i.test(header.hash)
      || !Number.isSafeInteger(header.timestamp) || header.timestamp <= 0
      || !Number.isSafeInteger(header.major_version) || header.major_version <= 0) {
      verifiedActivationProof = null;
      return null;
    }
    const block = { height: header.height, hash: header.hash, timestamp: header.timestamp, protocol: header.major_version };
    verifiedActivationProof = { block, checkedAt: Date.now() };
    return block;
  }).catch(() => {
    verifiedActivationProof = null;
    return null;
  }).finally(() => { pendingActivationProof = null; });
  return pendingActivationProof;
}

export async function forkNetworkSnapshot(height: number, currentProtocol: number, targetSeconds: number, observedAt: string): Promise<ForkSnapshot> {
  let activationBlock: ForkSnapshot["activationBlock"] = null;
  if (height >= POS_FORK_HEIGHT) {
    if (verifiedActivationProof && Date.now() - verifiedActivationProof.checkedAt < ACTIVATION_PROOF_TTL_MS) {
      return buildForkSnapshot(height, currentProtocol, targetSeconds, observedAt, verifiedActivationProof.block);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      activationBlock = await Promise.race([
        activationProofRequest(),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ACTIVATION_PROOF_BUDGET_MS); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  return buildForkSnapshot(height, currentProtocol, targetSeconds, observedAt, activationBlock);
}
