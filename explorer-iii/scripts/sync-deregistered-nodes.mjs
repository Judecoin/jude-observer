import { readFile, writeFile } from "node:fs/promises";
import { scanStakeRange, resolveDeregisteredNodes, validateHeaders } from "../worker/deregistration.ts";

const RPC_NODES = [
  "http://node1.judecoin.com:16061",
  "http://node.judecoin.info:16061",
  "http://67.230.167.187:16061",
];
const INDEX_PATH = new URL("../data/service-node-stake-index.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/deregistered-service-nodes.json", import.meta.url);
const FIRST_POS_HEIGHT = 780000;

async function request(node, path, body) {
  const response = await fetch(`${node}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  const status = data.result?.status ?? data.status;
  if (status && status !== "OK") throw new Error(`RPC status: ${status}`);
  return data;
}

let index;
try {
  index = JSON.parse(await readFile(INDEX_PATH, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  index = { version: 1, scannedThrough: FIRST_POS_HEIGHT - 1, registrations: {}, stakes: [] };
}

let source;
for (const node of RPC_NODES) {
  try {
    const info = await request(node, "/get_info");
    if (info.status !== "OK" || !Number.isInteger(info.height) || info.height - 1 < index.scannedThrough) continue;
    source = { node, tip: info.height - 1 };
    break;
  } catch { continue; }
}
if (!source) throw new Error("No synchronized Judecoin RPC node is reachable");

const jsonRpc = async (method, params = {}) => {
  const data = await request(source.node, "/json_rpc", { jsonrpc: "2.0", id: "service-node-history", method, params });
  if (!data.result) throw new Error("Invalid RPC response");
  return data.result;
};
const reader = {
  headers: async (start, end) => (await jsonRpc("get_block_headers_range", {
    start_height: start, end_height: end, get_tx_hashes: true,
  })).headers,
  transactions: async (hashes) => (await request(source.node, "/get_transactions", {
    txs_hashes: hashes, decode_as_json: true, tx_extra: true, stake_info: true, prune: true,
  })).txs,
};

if (index.scannedHash) {
  const headers = await reader.headers(index.scannedThrough, index.scannedThrough);
  validateHeaders(headers, index.scannedThrough, index.scannedThrough);
  if (headers[0].hash !== index.scannedHash) {
    index = { version: 1, scannedThrough: FIRST_POS_HEIGHT - 1, registrations: {}, stakes: [] };
  }
}
while (index.scannedThrough < source.tip) {
  index = await scanStakeRange(index, reader, Math.min(source.tip, index.scannedThrough + 1000));
  process.stdout.write(`Indexed through block ${index.scannedThrough}\n`);
}
const blacklist = (await jsonRpc("get_service_node_blacklisted_key_images")).blacklist;
const { nodes, unresolvedKeyImages } = resolveDeregisteredNodes(index, blacklist, source.tip);
if (unresolvedKeyImages) throw new Error(`${unresolvedKeyImages} blacklist key images could not be resolved`);

let previous = [];
try {
  previous = JSON.parse(await readFile(OUTPUT_PATH, "utf8")).nodes;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const history = new Map(previous.map((node) => [node.publicKey, node]));
for (const node of nodes) history.set(node.publicKey, node);
await writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceHeight: source.tip,
  nodes: [...history.values()].sort((a, b) => b.unlockedAt - a.unlockedAt || a.publicKey.localeCompare(b.publicKey)),
}, null, 2)}\n`);
process.stdout.write(`Synchronized ${nodes.length} deregistered service nodes with locked stake through block ${source.tip}.\n`);
