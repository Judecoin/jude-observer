import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

export const TOP = 4_000;
export const hashFor = (kind, height, index = 0) => `${kind}${height.toString(16).padStart(8, "0")}${index.toString(16).padStart(8, "0")}`.padEnd(64, "0");

// Evaluate the real module graph (including RPC caching and failover), replacing
// only the HTTP boundary. No network or installed production server is needed.
export async function chainRpcHarness(options = {}) {
  const calls = [];
  let activeBlocks = 0;
  let peakBlocks = 0;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [1_800_000_000_000])); }
    static now() { return 1_800_000_000_000; }
  }
  const txHeights = options.txHeights ?? Array.from({ length: 100 }, (_, index) => TOP - index);
  const header = (height) => ({
    height, hash: hashFor("3", height), timestamp: 1_799_999_900 - (TOP - height) * 180,
    difficulty: 18_000, reward: 1_017, block_size: 200, major_version: 16,
    num_txes: txHeights.includes(height) ? 1 : 0,
    tx_hashes: txHeights.includes(height) ? [hashFor("1", height)] : [],
    ...(options.legacy ? {} : { miner_tx_hash: hashFor("2", height) }),
  });
  function record(hash) {
    const height = Number.parseInt(hash.slice(1, 9), 16);
    const miner = hash[0] === "2";
    return {
      tx_hash: hash, block_height: height, in_pool: false, size: 321,
      as_json: JSON.stringify({
        type: 0, version: 2,
        vin: miner ? [{ gen: { height } }] : [{ key: { k_image: "key" } }],
        vout: miner ? [{}, {}] : [{}],
        rct_signatures: miner ? { type: 0 } : { type: 1, txnFee: 17 },
      }),
    };
  }
  const context = vm.createContext({
    URL, Request, Response, Headers, AbortController, setTimeout, clearTimeout,
    Date: FixedDate, console,
    async fetch(url, init = {}) {
      const body = init.body ? JSON.parse(init.body) : null;
      const method = body?.method ?? new URL(url).pathname;
      const call = { method, params: body?.params, hashes: body?.txs_hashes, url };
      calls.push(call);
      if (method === "get_block") { activeBlocks++; peakBlocks = Math.max(peakBlocks, activeBlocks); }
      try {
        await new Promise((resolve) => setImmediate(resolve));
        if (options.fail?.(call)) throw new Error("Fixture upstream failure");
        let data;
        if (method === "/api/emission") data = { status: "success", data: { coinbase: 50_000, blk_no: TOP } };
        else if (method === "/get_info") data = { status: "OK", height: TOP + 1, top_block_hash: hashFor("3", TOP), target: 180, difficulty: 18_000, hard_fork: 16, version: "3" };
        else if (method === "get_block_headers_range") {
          const { start_height: start, end_height: end } = body.params;
          data = { result: { status: "OK", headers: Array.from({ length: end - start + 1 }, (_, index) => header(start + index)) } };
        } else if (method === "/get_transactions") data = { status: "OK", txs: body.txs_hashes.map(record).reverse() };
        else if (method === "get_block") {
          const height = body.params.height ?? Number.parseInt(body.params.hash.slice(1, 9), 16);
          const selected = header(height);
          data = { result: { status: "OK", block_header: selected, json: JSON.stringify({ miner_tx: JSON.parse(record(hashFor("2", height)).as_json), tx_hashes: selected.tx_hashes }) } };
        } else throw new Error(`Unexpected fixture RPC: ${method}`);
        return Response.json(options.mutate ? options.mutate(call, data) : data);
      } finally { if (method === "get_block") activeBlocks--; }
    },
  });
  const modules = new Map();
  async function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    let loadedModule;
    if (url.pathname.endsWith(".json")) {
      loadedModule = new vm.SyntheticModule(["default"], function () { this.setExport("default", { nodes: [], sourceHeight: 0, generatedAt: "2026-01-01" }); }, { context, identifier: url.href });
    } else {
      const source = options.chainSource && url.pathname.endsWith("/chain.ts") ? options.chainSource : await readFile(url, "utf8");
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      loadedModule = new vm.SourceTextModule(compiled, { context, identifier: url.href });
    }
    modules.set(url.href, loadedModule);
    return loadedModule;
  }
  const entry = await load(new URL("../../worker/chain.ts", import.meta.url));
  await entry.link((specifier, parent) => load(new URL(specifier.endsWith(".json") ? specifier : `${specifier}.ts`, parent.identifier)));
  await entry.evaluate();
  return {
    calls, header, record, peakBlocks: () => peakBlocks,
    async request(query = "") {
      const response = await entry.namespace.createChainResponse(new URL(`https://test.example/api/chain?${query}`));
      return { status: response.status, data: await response.json() };
    },
  };
}
