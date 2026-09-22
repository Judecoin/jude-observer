// RPC contracts describe decoded payloads; runtime checks remain at each consumer.
export type RpcStatus = {
  status?: string;
  error?: { message?: string };
  result?: { status?: string };
};

export type RpcEnvelope<T extends { status?: string }> = RpcStatus & { result: T };
export type RpcResult<T = unknown> = { node: string; data: T };

export type RpcInfo = RpcStatus & {
  height: number;
  mainnet?: boolean;
  nettype?: string;
  target?: number;
  difficulty?: number;
  hard_fork?: number;
  version?: string;
  tx_pool_size?: number;
  block_weight_median?: number;
  block_size_median?: number;
  block_weight_limit?: number;
  block_size_limit?: number;
};

export type RpcHeader = {
  block_size: number;
  difficulty: number;
  hash: string;
  height: number;
  major_version: number;
  minor_version?: number;
  miner_tx_hash?: string;
  num_txes: number;
  reward: number;
  timestamp: number;
  tx_hashes?: string[];
  orphan_status?: boolean;
  depth?: number;
  service_node_winner?: string;
};

export type RpcServiceNode = {
  active: boolean;
  funded: boolean;
  last_reward_block_height: number;
  last_uptime_proof: number;
  registration_height: number;
  requested_unlock_height: number;
  service_node_pubkey: string;
  service_node_version: number[];
  staking_requirement: number;
  total_contributed: number;
  contributors?: Array<{ address: string; amount: number; reserved: number }>;
  portions_for_operator?: number;
  decommission_count?: number;
  earned_downtime_blocks?: number;
  operator_address?: string;
  public_ip?: string;
  quorumnet_port?: number;
  swarm_id?: string | number;
  last_decommission_height?: number;
  last_ip_change_height?: number;
  recommission_credit?: number;
  registration_hf_version?: number;
  storage_port?: number;
  storage_lmq_port?: number;
  pubkey_ed25519?: string;
  pubkey_x25519?: string;
};

export type RpcTransactionExtra = {
  sn_state_change?: { type?: string };
  sn_registration?: unknown;
  sn_contributor?: unknown;
  key_image_unlock?: unknown;
  sn_pubkey?: string;
  locked_key_images?: string[];
};

export type RpcExtra = RpcTransactionExtra & { extra?: RpcTransactionExtra };

export type DecodedTransaction = {
  type?: number;
  version?: number;
  unlock_time?: number;
  output_unlock_times?: number[];
  extra?: number[];
  vin?: Array<{
    gen?: { height?: number };
    key?: { key_offsets?: number[]; k_image?: string; amount?: number };
  }>;
  vout?: Array<{ amount?: number; target?: { key?: string } }>;
  rct_signatures?: { type?: number; txnFee?: number };
};

export type DecodedBlock = { miner_tx?: DecodedTransaction; tx_hashes?: string[] };

export type RpcTransaction = RpcExtra & {
  tx_hash: string;
  block_height: number;
  block_timestamp?: number;
  as_json?: string;
  tx_json?: string;
  size?: number;
  fee?: number;
  in_pool?: boolean;
  blink?: boolean;
  double_spend_seen?: boolean;
  output_indices?: number[];
};

export type RpcPoolTransaction = RpcExtra & {
  id_hash?: string;
  tx_json?: string;
  receive_time?: number;
  last_relayed_time?: number;
  blob_size?: number;
  weight?: number;
  fee?: number;
  blink?: boolean;
  double_spend_seen?: boolean;
};

export type RpcTransactions = RpcStatus & { txs: RpcTransaction[] };
export type RpcPool = RpcStatus & { transactions?: RpcPoolTransaction[] };
export type RpcOutputs = RpcStatus & {
  outs?: Array<{ key?: string; txid?: string; height?: number; unlocked?: boolean }>;
};
export type RpcEmission = RpcStatus & { data?: { coinbase?: number; blk_no?: number } };

export type RpcMethods = {
  get_block: { status?: string; block_header?: RpcHeader; json?: string; miner_tx_hash?: string };
  get_last_block_header: { status?: string; block_header?: RpcHeader };
  get_block_headers_range: { status?: string; headers: RpcHeader[] };
  get_service_nodes: { status?: string; service_node_states: RpcServiceNode[] };
  get_service_node_blacklisted_key_images: {
    status?: string;
    blacklist: Array<{ key_image: string; unlock_height: number }>;
  };
  get_quorum_state: {
    status?: string;
    untrusted?: boolean;
    quorums?: Array<{ height: number; quorum: { validators: string[]; workers: string[] } }>;
  };
};
