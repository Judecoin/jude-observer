import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("worker/index.ts", workerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function declaration(name) {
  const node = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `Missing production function ${name}`);
  return node.getText(sourceFile);
}

function workerFetchSource() {
  const worker = sourceFile.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find((statement) => statement.name.getText(sourceFile) === "worker");
  const method = worker?.initializer?.properties.find((property) => property.name?.getText(sourceFile) === "fetch");
  assert.ok(method, "Missing production worker fetch method");
  return method.getText(sourceFile).replace(/^async fetch\(/, "async function workerFetch(");
}

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [1_700_000_000_000])); }
  static now() { return 1_700_000_000_000; }
}

function productionFunctions(dependencies) {
  const program = [
    declaration("classifyTransaction"),
    declaration("verifiedChainTransactionDetails"),
    declaration("chainSnapshot"),
    declaration("json"),
    workerFetchSource(),
    "module.exports = { chainSnapshot, workerFetch };",
  ].join("\n\n");
  const compiled = ts.transpileModule(program, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, URL, Request, Response, Headers, Error,
    Date: FixedDate, EXPLORER_PAGE_SIZE: 5, JUDECOIN_EMISSION_API: "https://example.test/emission",
    deregisteredHistory: { nodes: [], sourceHeight: 990, generatedAt: "2023-11-14T00:00:00.000Z" },
    ...dependencies,
  });
  return testModule.exports;
}

function gate() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

const HASH = "a".repeat(64);
const TX = {
  tx_hash: HASH, block_height: 999, block_timestamp: 1_699_999_900, size: 321,
  output_indices: [12], in_pool: false,
  as_json: JSON.stringify({
    version: 2, type: 0, extra: [], unlock_time: 0,
    vin: [{ key: { amount: 0, k_image: "image", key_offsets: [2, 3] } }],
    vout: [{ amount: 0, target: { key: "output" } }],
    rct_signatures: { type: 1, txnFee: 17 },
  }),
};

function header(height, transaction = false) {
  return {
    height, timestamp: 1_699_999_900 - (1_000 - height) * 180,
    hash: height.toString(16).padStart(64, "0"), num_txes: transaction ? 1 : 0,
    tx_hashes: transaction ? [HASH] : [], block_size: 200, difficulty: 18_000,
    reward: 1_017, major_version: 16,
  };
}

function chainHarness({ historical = false, held = [], emissionError = false } = {}) {
  const calls = [];
  const gates = new Map(held.map((name) => [name, gate()]));
  const request = async (name, value) => {
    calls.push(name);
    if (gates.has(name)) await gates.get(name).promise;
    return value;
  };
  const txEnd = historical ? 840 : 1_000;
  const blockEnd = historical ? 990 : 1_000;
  const txHeaders = Array.from({ length: 160 }, (_, index) => header(txEnd - 159 + index, index === 159));
  const blockHeaders = Array.from({ length: 5 }, (_, index) => header(blockEnd - 4 + index, !historical && index === 4));
  const info = { status: "OK", height: 1_001, target: 180, difficulty: 18_000, hard_fork: 16, version: 3, tx_pool_size: 0, block_weight_median: 1_000, block_weight_limit: 2_000 };
  const functions = productionFunctions({
    cachedRpcFetch: (path) => {
      if (path === "/get_info") return request("info", { node: "https://rpc.example.test", data: info });
      assert.equal(path, "/get_transactions");
      return request("transaction-details", { data: { txs: [TX] } });
    },
    cachedRpcFetchNode: async () => {
      const result = await request("emission", { data: { status: "success", data: { coinbase: 50_000, blk_no: 1_000 } } });
      if (emissionError) throw new Error("Emission unavailable");
      return result;
    },
    cachedJsonRpc: (method, params) => {
      if (method === "get_block") {
        const selected = blockHeaders.find((item) => item.height === params.height);
        assert.ok(selected, "Do not request speculative block heights");
        return request(`block:${params.height}`, { data: { result: { json: JSON.stringify({ miner_tx: { vin: [{ gen: { height: params.height } }], vout: [{}, {}] }, tx_hashes: selected.tx_hashes }) } } });
      }
      assert.equal(method, "get_block_headers_range");
      if (params.get_tx_hashes == null) return request("tip", { data: { result: { headers: [header(1_000)] } } });
      const isTransactionRange = params.end_height === txEnd && params.start_height === txEnd - 159;
      return request(isTransactionRange ? "transaction-range" : "block-range", { data: { result: { headers: isTransactionRange ? txHeaders : blockHeaders } } });
    },
    serviceNodeStatesRequest: (height) => {
      assert.equal(height, 1_000);
      return request("service-nodes", { data: { info: { height: 1_001 }, serviceNodeStates: [{ requested_unlock_height: 0, publicKey: "node" }] } });
    },
    quorumPageSnapshot: (height, page, pageSize) => request("quorum", { live: true, height, page, pageSize, records: [{ height, validators: ["v"], workers: ["w"] }] }),
    buildServiceNodesSnapshot: (nodes, height) => ({ total: nodes.length, active: 1, height }),
  });
  return {
    calls, gates,
    run: () => functions.chainSnapshot(...(historical ? [2, 1] : [])),
  };
}

test("cold chain starts optional supply without waiting for chain info", async () => {
  const harness = chainHarness({ held: ["info", "emission"] });
  const result = harness.run();
  await flush();
  assert.deepEqual(harness.calls, ["emission", "info"]);
  harness.gates.get("info").resolve();
  await flush();
  assert.ok(harness.calls.includes("transaction-details"));
  harness.gates.get("emission").resolve();
  assert.equal((await result).network.minedSupply, 50_000);
});

test("historical ranges and then independent tip/block/transaction details overlap", async () => {
  const harness = chainHarness({ historical: true, held: ["transaction-range", "block-range", "tip", "block:990", "transaction-details"] });
  const result = harness.run();
  await flush();
  assert.ok(harness.calls.includes("transaction-range"));
  assert.ok(harness.calls.includes("block-range"), "Block range must start while transaction range is unresolved");
  harness.gates.get("transaction-range").resolve();
  harness.gates.get("block-range").resolve();
  await flush();
  for (const name of ["tip", "block:990", "transaction-details"]) {
    assert.ok(harness.calls.includes(name), `${name} must start before any other detail read completes`);
  }
  for (const name of ["tip", "block:990", "transaction-details"]) harness.gates.get(name).resolve();
  const snapshot = await result;
  assert.deepEqual(Array.from(snapshot.blocks, (block) => block.height), [990, 989, 988, 987, 986]);
  assert.equal(snapshot.network.height, 1_000);
  assert.equal(snapshot.network.latestBlockTimestamp, 1_699_999_900);
  assert.equal(snapshot.transactions[0].block, 840);
  assert.equal(snapshot.transactions[0].confirmations, 161);
  assert.deepEqual([...harness.calls].sort(), ["emission", "info", "service-nodes", "quorum", "transaction-range", "block-range", "tip", "block:990", "block:989", "block:988", "block:987", "block:986", "transaction-details"].sort());
});

test("chain overlap preserves verified network and transaction/block arithmetic", async () => {
  const harness = chainHarness();
  const snapshot = JSON.parse(JSON.stringify(await harness.run()));
  assert.deepEqual(snapshot.network, {
    height: 1_000, difficulty: 18_000, targetSeconds: 180, hashrate: 100,
    hardFork: 16, protocol: "3", txPoolSize: 0, blockSizeMedian: 1_000, blockSizeLimit: 2_000,
    coinbase: null, fees: null, minedSupply: 50_000, supplyHeight: 1_000, supplySource: "Judecoin emission index API",
    latestBlockTimestamp: 1_699_999_900, latestBlockAgeSeconds: 100, synced: true,
  });
  assert.deepEqual(snapshot.blocks[0], {
    height: 1_000, timestamp: 1_699_999_900, hash: "3e8".padStart(64, "0"), txs: 1, size: 200,
    difficulty: 18_000, fee: 17, reward: 1_000, inputs: 1, outputs: 3,
  });
  assert.deepEqual(snapshot.transactions, [{
    hash: HASH, block: 1_000, timestamp: 1_699_999_900, size: 321, confirmations: 1,
    txType: "transfer", fee: 17, reward: 0, inputs: 1, outputs: 1,
  }]);
  assert.deepEqual(snapshot.serviceNodes, { total: 1, active: 1, height: 1_000 });
  assert.deepEqual(snapshot.pagination, { blockPage: 0, transactionPage: 0, pageSize: 5, transactionScanSize: 160 });
  assert.equal(harness.calls.filter((call) => call.endsWith("-range")).length, 1, "Default page still uses one header range");
  assert.equal(harness.calls.filter((call) => call.startsWith("block:")).length, 5);
  assert.ok(!harness.calls.includes("tip"), "Do not add an unnecessary live-tip request");
});

test("overlapped optional supply failure keeps the existing null supply contract", async () => {
  const snapshot = await chainHarness({ emissionError: true }).run();
  assert.equal(snapshot.live, true);
  assert.equal(snapshot.network.minedSupply, null);
  assert.equal(snapshot.network.supplyHeight, null);
  assert.equal(snapshot.network.supplySource, null);
});

function transactionHarness() {
  const calls = [];
  const info = gate();
  const ring = gate();
  const { workerFetch } = productionFunctions({
    rpcFetch: async (path) => {
      calls.push(path);
      if (path === "/get_transactions") return { data: { txs: [TX] } };
      if (path === "/get_info") { await info.promise; return { data: { height: 1_001 } }; }
      assert.equal(path, "/get_outs");
      await ring.promise;
      return { data: { outs: [{ key: "ring-a", txid: "source-a", height: 500, unlocked: true }, { key: "ring-b", txid: "source-b", height: 501, unlocked: true }] } };
    },
  });
  return { calls, info, ring, run: () => workerFetch(new Request(`https://example.test/api/transaction?hash=${HASH}`), {}, {}) };
}

test("transaction confirmation and ring reads overlap and preserve all resolved details", async () => {
  const harness = transactionHarness();
  const pending = harness.run();
  await flush();
  assert.deepEqual(harness.calls, ["/get_transactions", "/get_info", "/get_outs"]);
  harness.ring.resolve();
  harness.info.resolve();
  const response = await pending;
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.confirmations, 3);
  assert.equal(data.fee, 17);
  assert.equal(data.txType, "transfer");
  assert.equal(data.size, 321);
  assert.deepEqual(data.inputs, [{
    index: 0, type: "key", keyImage: "image", amount: 0, ringSize: 2, keyOffsets: [2, 5],
    ringMembers: [
      { index: 2, outputKey: "ring-a", transactionHash: "source-a", blockHeight: 500, unlocked: true },
      { index: 5, outputKey: "ring-b", transactionHash: "source-b", blockHeight: 501, unlocked: true },
    ],
  }]);
  assert.deepEqual(data.outputs, [{ index: 0, key: "output", globalIndex: 12, unlockHeight: 0, confidential: true }]);
});

test("optional ring failure preserves absolute indices and verified transaction values", async () => {
  const harness = transactionHarness();
  const pending = harness.run();
  await flush();
  harness.ring.reject(new Error("get_outs disabled"));
  harness.info.resolve();
  const response = await pending;
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.confirmations, 3);
  assert.equal(data.fee, 17);
  assert.deepEqual(data.inputs[0].keyOffsets, [2, 5]);
  assert.deepEqual(data.inputs[0].ringMembers, []);
});

test("required confirmation read failure still fails the transaction response", async () => {
  const harness = transactionHarness();
  const pending = harness.run();
  await flush();
  harness.info.reject(new Error("Info unavailable"));
  harness.ring.resolve();
  const response = await pending;
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Info unavailable" });
});
