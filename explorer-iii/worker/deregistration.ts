export type StakeIndex = {
  version: number;
  scannedThrough: number;
  scannedHash?: string;
  registrations: Record<string, number>;
  stakes: Array<{ keyImage: string; publicKey: string }>;
};

export type DeregisteredNode = {
  publicKey: string;
  registeredAt: number;
  unlockedAt: number;
  contributions: number;
};

export type DeregistrationSnapshot = {
  total: number | null;
  live: boolean;
  status: "live" | "syncing" | "unavailable";
  indexedThrough: number;
  sourceHeight: number | null;
  generatedAt: string;
  unresolvedKeyImages: number;
  nodes: DeregisteredNode[];
};

type Header = { height: number; hash: string; num_txes: number; tx_hashes?: string[] };
type StakeTransaction = {
  tx_hash: string;
  block_height: number;
  in_pool?: boolean;
  extra?: { sn_pubkey?: string; sn_registration?: unknown; locked_key_images?: string[] };
};
export type IndexReader = {
  headers(start: number, end: number): Promise<Header[]>;
  transactions(hashes: string[]): Promise<StakeTransaction[]>;
};
type BlacklistEntry = { key_image: string; unlock_height: number };
type LiveReader = IndexReader & {
  height: number;
  blacklist(): Promise<BlacklistEntry[]>;
};
type Checkpoint = { index: StakeIndex; history: DeregisteredNode[] };
type Storage = { load(): Promise<Checkpoint | null>; save(value: Checkpoint): Promise<void> };

const HASH = /^[a-f0-9]{64}$/i;
const HEADER_CHUNK = 1000;
const TX_CHUNK = 100;

function copyIndex(index: StakeIndex): StakeIndex {
  return { ...index, registrations: { ...index.registrations }, stakes: [...index.stakes] };
}

export function validateHeaders(headers: Header[], start: number, end: number) {
  if (!Array.isArray(headers) || headers.length !== end - start + 1) throw new Error("Incomplete block headers");
  headers.forEach((header, offset) => {
    if (header.height !== start + offset || !HASH.test(header.hash)) throw new Error("Invalid block header");
  });
}

export async function scanStakeRange(index: StakeIndex, reader: IndexReader, end: number): Promise<StakeIndex> {
  const start = index.scannedThrough + 1;
  const headers = await reader.headers(start, end);
  validateHeaders(headers, start, end);
  const hashes: string[] = [];
  for (const header of headers) {
    if (!Number.isInteger(header.num_txes) || header.num_txes < 0
      || (header.num_txes > 0 && !Array.isArray(header.tx_hashes))
      || (header.tx_hashes?.length || 0) !== header.num_txes) throw new Error("Missing block transaction hashes");
    for (const hash of header.tx_hashes || []) {
      if (!HASH.test(hash)) throw new Error("Invalid transaction hash");
      hashes.push(hash);
    }
  }
  
  if (hashes.length > TX_CHUNK * 4) {
    if (start === end) throw new Error("Transaction range exceeds scan budget");
    return scanStakeRange(index, reader, start + Math.floor((end - start) / 2));
  }
  const next = copyIndex(index);
  const stakes = new Map(next.stakes.map((stake) => [stake.keyImage, stake]));
  for (let offset = 0; offset < hashes.length; offset += TX_CHUNK) {
    const batch = hashes.slice(offset, offset + TX_CHUNK);
    const txs = await reader.transactions(batch);
    if (!Array.isArray(txs)) throw new Error("Invalid transaction response");
    const byHash = new Map(txs.map((tx) => [tx.tx_hash, tx]));
    for (const hash of batch) {
      const tx = byHash.get(hash);
      if (!tx || tx.in_pool || !Number.isInteger(tx.block_height)
        || tx.block_height < start || tx.block_height > end || !tx.extra) throw new Error("Incomplete decoded transactions");
      const key = tx.extra.sn_pubkey;
      if (!key) continue;
      if (!HASH.test(key)) throw new Error("Invalid service node public key");
      if (tx.extra.sn_registration) next.registrations[key] = tx.block_height;
      for (const keyImage of tx.extra.locked_key_images || []) {
        if (!HASH.test(keyImage)) throw new Error("Invalid stake key image");
        stakes.set(keyImage, { keyImage, publicKey: key });
      }
    }
  }
  next.stakes = [...stakes.values()];
  next.scannedThrough = end;
  next.scannedHash = headers[headers.length - 1].hash;
  return next;
}

export function resolveDeregisteredNodes(index: StakeIndex, blacklist: BlacklistEntry[], height: number) {
  if (!Array.isArray(blacklist)) throw new Error("Invalid deregistration response");
  const stakes = new Map(index.stakes.map((stake) => [stake.keyImage, stake]));
  const byNode = new Map<string, DeregisteredNode>();
  const seen = new Set<string>();
  let unresolvedKeyImages = 0;
  for (const entry of blacklist) {
    if (!HASH.test(entry.key_image) || !Number.isInteger(entry.unlock_height) || entry.unlock_height <= 0) {
      throw new Error("Invalid blacklist entry");
    }
    if (entry.unlock_height <= height || seen.has(entry.key_image)) continue;
    seen.add(entry.key_image);
    const stake = stakes.get(entry.key_image);
    const registeredAt = stake ? index.registrations[stake.publicKey] : 0;
    if (!stake || !registeredAt) { unresolvedKeyImages += 1; continue; }
    const node = byNode.get(stake.publicKey) || {
      publicKey: stake.publicKey, registeredAt, unlockedAt: 0, contributions: 0,
    };
    node.unlockedAt = Math.max(node.unlockedAt, entry.unlock_height);
    node.contributions += 1;
    byNode.set(node.publicKey, node);
  }
  return {
    nodes: [...byNode.values()].sort((a, b) => b.unlockedAt - a.unlockedAt || a.publicKey.localeCompare(b.publicKey)),
    unresolvedKeyImages,
  };
}

export function createDeregistrationTracker(seed: StakeIndex, open: () => Promise<LiveReader>, storage?: Storage) {
  let index = copyIndex(seed);
  const history = new Map<string, DeregisteredNode>();
  let snapshot: DeregistrationSnapshot | null = null;
  let pending: Promise<DeregistrationSnapshot> | null = null;
  let expiresAt = 0;

  async function refresh(): Promise<DeregistrationSnapshot> {
    try {
      const saved = await storage?.load().catch(() => null);
      if (saved?.index?.version === seed.version && saved.index.scannedThrough > index.scannedThrough
        && Array.isArray(saved.index.stakes) && saved.index.registrations) {
        index = copyIndex(saved.index);
        for (const node of saved.history || []) history.set(node.publicKey, node);
      }
      const reader = await open();
      if (!Number.isInteger(reader.height) || reader.height < seed.scannedThrough) throw new Error("Node is behind the stake index");
      if (index.scannedThrough > reader.height) index = copyIndex(seed);
      if (index.scannedHash) {
        const headers = await reader.headers(index.scannedThrough, index.scannedThrough);
        validateHeaders(headers, index.scannedThrough, index.scannedThrough);
        if (headers[0].hash !== index.scannedHash) { index = copyIndex(seed); history.clear(); }
      }
      const blacklist = await reader.blacklist();
      
      for (let chunk = 0; chunk < 4 && index.scannedThrough < reader.height; chunk += 1) {
        try {
          index = await scanStakeRange(index, reader, Math.min(reader.height, index.scannedThrough + HEADER_CHUNK));
        } catch { break; }
      }
      const { nodes, unresolvedKeyImages } = resolveDeregisteredNodes(index, blacklist, reader.height);
      for (const node of nodes) history.set(node.publicKey, node);
      await storage?.save({ index, history: [...history.values()] }).catch(() => undefined);
      return {
        total: unresolvedKeyImages ? null : nodes.length,
        live: unresolvedKeyImages === 0,
        status: unresolvedKeyImages ? "syncing" : "live",
        indexedThrough: index.scannedThrough,
        sourceHeight: reader.height,
        generatedAt: new Date().toISOString(),
        unresolvedKeyImages,
        nodes,
      };
    } catch {
      return {
        total: null, live: false, status: "unavailable", indexedThrough: index.scannedThrough,
        sourceHeight: null, generatedAt: new Date().toISOString(), unresolvedKeyImages: 0, nodes: [],
      };
    }
  }

  return {
    read(force = false): Promise<DeregistrationSnapshot> {
      if (pending) return pending;
      if (!force && snapshot && expiresAt > Date.now()) return Promise.resolve(snapshot);
      pending = refresh().then((value) => {
        snapshot = value;
        expiresAt = Date.now() + 10_000;
        return value;
      }).finally(() => { pending = null; });
      return pending;
    },
    find(publicKey: string) { return history.get(publicKey); },
  };
}
