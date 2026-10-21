import assert from "node:assert/strict";
import test from "node:test";
import { chainRpcHarness, hashFor, TOP } from "./helpers/chain-rpc-harness.mjs";

test("full snapshots batch miner and regular transactions at every supported page size", async () => {
  for (const size of [5, 10, 20, 25, 50, 100]) {
    const harness = await chainRpcHarness();
    const { status, data } = await harness.request(`blockPageSize=${size}&transactionPageSize=${size}`);
    assert.equal(status, 200);
    assert.equal(data.pendingDetails, undefined);
    assert.equal(data.blocks.length, size);
    assert.equal(data.transactions.length, size);
    assert.equal(harness.calls.filter((call) => call.method === "get_block").length, 0);
    const batches = harness.calls.filter((call) => call.method === "/get_transactions");
    assert.equal(batches.length, Math.ceil(2 * size / 100));
    assert.ok(batches.every((call) => call.hashes.length <= 100));
    assert.equal(new Set(batches.flatMap((call) => call.hashes)).size, size * 2);
    assert.deepEqual(data.blocks[0], { height: TOP, hash: hashFor("3", TOP), timestamp: 1_799_999_900,
      txs: 1, size: 200, difficulty: 18_000, fee: 17, reward: 1_000, inputs: 1, outputs: 3 });
    assert.equal(data.transactions[0].confirmations, 1);
    assert.equal(data.transactions.at(-1).confirmations, size);
  }
});

test("legacy fallback preserves the same snapshot with at most four concurrent block RPCs", async () => {
  const query = "blockPageSize=100&transactionPageSize=100";
  const modern = await chainRpcHarness();
  const legacy = await chainRpcHarness({ legacy: true });
  assert.deepEqual(await legacy.request(query), await modern.request(query));
  assert.equal(legacy.calls.filter((call) => call.method === "get_block").length, 100);
  assert.equal(legacy.peakBlocks(), 4);
});

test("overview does no supply, decoded transaction, or decoded block RPC", async () => {
  const harness = await chainRpcHarness();
  const { data } = await harness.request("overview=1&blockPageSize=10");
  assert.equal(data.headerOnly, true);
  assert.equal(data.blocks.length, 10);
  assert.deepEqual(harness.calls.map((call) => call.method), ["/get_info", "get_block_headers_range"]);
});

test("a known newer tip rejects outdated info before header scans and detail work", async () => {
  const harness = await chainRpcHarness();
  const { status, data } = await harness.request(`tip=${TOP + 1}&blockPageSize=100&transactionPageSize=100`);
  assert.equal(status, 503);
  assert.match(data.error, /requested tip/);
  assert.deepEqual(harness.calls.map((call) => call.method).sort(), ["/api/emission", "/get_info"]);
});

test("sparse and historical transaction windows retain their boundaries and confirmation counts", async () => {
  const height = TOP - 319;
  const harness = await chainRpcHarness({ txHeights: [height] });
  const { data } = await harness.request("blockPage=2&blockPageSize=10&transactionPage=1&transactionPageSize=5");
  assert.equal(data.blocks[0].height, TOP - 20);
  assert.equal(data.transactions[0].block, height);
  assert.equal(data.transactions[0].confirmations, 320);
  assert.equal(data.pagination.transactionScanSize, 160);
  assert.ok(harness.calls.some((call) => call.params?.start_height === TOP - 319 && call.params?.end_height === TOP - 160));
});

test("missing miner hashes and missing miner records use verified compatibility reads", async () => {
  const harness = await chainRpcHarness({ mutate(call, data) {
    if (call.method === "/get_transactions") data.txs = data.txs.filter((record) => record.tx_hash !== hashFor("2", TOP));
    return data;
  } });
  const { data } = await harness.request();
  assert.equal(data.pendingDetails, undefined);
  assert.equal(harness.calls.filter((call) => call.method === "get_block").length, 1);
  assert.equal(data.blocks[0].outputs, 3);
});

test("failed transaction batches retain other verified rows and mark missing details", async () => {
  const harness = await chainRpcHarness({ fail: (call) => call.method === "/get_transactions" && call.hashes.includes(hashFor("1", TOP)) });
  const { status, data } = await harness.request("blockPageSize=100&transactionPageSize=100");
  assert.equal(status, 200);
  assert.equal(data.pendingDetails, true);
  assert.equal(data.blocks.length, 100);
  assert.equal(data.blocks[0].fee, null);
  assert.equal(data.transactions.length, 0);
  assert.equal(harness.calls.filter((call) => call.method === "get_block").length, 0, "the independent miner batch succeeds");
});

test("pool, wrong-height, malformed and duplicate details never become verified chain rows", async () => {
  for (const damage of ["pool", "height", "json", "duplicate"]) {
    const harness = await chainRpcHarness({ mutate(call, data) {
      if (call.method === "/get_transactions") {
        const record = data.txs.find((item) => item.tx_hash === hashFor("1", TOP));
        if (damage === "pool") record.in_pool = true;
        if (damage === "height") record.block_height--;
        if (damage === "json") record.as_json = "{";
        if (damage === "duplicate") data.txs.push({ ...record, block_height: TOP - 1 });
      }
      return data;
    } });
    const { data } = await harness.request();
    assert.equal(data.pendingDetails, true);
    assert.equal(data.blocks[0].fee, null);
    assert.equal(data.transactions.length, 4);
    assert.ok(data.transactions.every((row) => row.hash !== hashFor("1", TOP)));
  }
});

test("truncated, duplicate or incomplete hash-list headers fail rather than omit transactions", async () => {
  for (const damage of ["truncated", "duplicate", "hashes"]) {
    const harness = await chainRpcHarness({ mutate(call, data) {
      if (call.method === "get_block_headers_range") {
        const headers = data.result.headers;
        if (damage === "truncated") headers.shift();
        if (damage === "duplicate") headers[0] = headers[1];
        if (damage === "hashes") headers.at(-1).tx_hashes = [];
      }
      return data;
    } });
    const { status, data } = await harness.request();
    assert.equal(status, 503);
    assert.equal(data.live, false);
  }
});

test("reorg-mismatched fallback blocks and miner generation heights are not accepted", async () => {
  for (const damage of ["hash", "generation", "txs", "orphan"]) {
    const harness = await chainRpcHarness({ legacy: true, mutate(call, data) {
      if (call.method === "get_block") {
        if (damage === "hash") data.result.block_header.hash = "f".repeat(64);
        if (damage === "orphan") data.result.block_header.orphan_status = true;
        const parsed = JSON.parse(data.result.json);
        if (damage === "generation") parsed.miner_tx.vin[0].gen.height--;
        if (damage === "txs") parsed.tx_hashes = [];
        data.result.json = JSON.stringify(parsed);
      }
      return data;
    } });
    const { status, data } = await harness.request();
    assert.equal(status, 200);
    assert.equal(data.pendingDetails, true);
    assert.ok(data.blocks.every((block) => block.outputs === null && block.reward === null));
  }
});
