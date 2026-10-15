import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function sourceWithoutImports(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ast.statements.filter((statement) => !ts.isImportDeclaration(statement)).map((statement) => statement.getFullText(ast)).join("\n");
}

const compiled = ts.transpileModule([
  await sourceWithoutImports("../worker/transactions.ts"),
  await sourceWithoutImports("../worker/ledger.ts"),
  await sourceWithoutImports("../worker/routes/block.ts"),
  "module.exports = { transactionsPageResponse, blocksPageResponse, blockResponse };",
].join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const hash = (id) => BigInt(id).toString(16).padStart(64, "0");
const pageUrl = (kind, cursor = null, pageSize = 5, extra = "") => new URL(`https://explorer.example/api/${kind}?pageSize=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${extra}`);

function harness({ height = 12, transactions = new Map(), mutateHeaders, mutateTransactions, mutateInfo, blockHashes } = {}) {
  let tip = height;
  let anchorChanged = false;
  let failTransactions = false;
  let infoReads = 0;
  const calls = [];
  const records = new Map();
  for (const [blockHeight, hashes] of transactions) {
    for (const txHash of hashes) records.set(txHash, {
      tx_hash: txHash, block_height: blockHeight, block_timestamp: 1_700_000_000 + blockHeight * 180,
      size: 123, in_pool: false,
      as_json: JSON.stringify({ type: 0, vin: [{ key: {} }], vout: [{ target: { key: hash(900) } }], rct_signatures: { txnFee: 2 } }),
    });
  }
  function header(blockHeight) {
    return {
      height: blockHeight, hash: hash(1_000_000 + blockHeight + (anchorChanged ? 2_000_000 : 0)),
      timestamp: 1_700_000_000 + blockHeight * 180, block_size: 500, difficulty: 1234,
      major_version: 17, num_txes: transactions.get(blockHeight)?.length ?? 0, reward: 100,
      tx_hashes: transactions.get(blockHeight) ?? [], miner_tx_hash: hash(5_000_000 + blockHeight),
    };
  }
  async function rpc(method, params) {
    calls.push({ method, params });
    if (method === "get_block") {
      const blockHeight = Number(params.height);
      const parsed = { miner_tx: { vin: [{ gen: { height: blockHeight } }], vout: [] } };
      if (blockHashes !== "omitted") parsed.tx_hashes = blockHashes ?? transactions.get(blockHeight) ?? [];
      return { node: "https://node.example", data: { result: { status: "OK", block_header: header(blockHeight), json: JSON.stringify(parsed) } } };
    }
    assert.equal(method, "get_block_headers_range");
    const headers = [];
    for (let blockHeight = params.start_height; blockHeight <= params.end_height; blockHeight += 1) headers.push(header(blockHeight));
    return { node: "https://node.example", data: { result: { status: "OK", headers: mutateHeaders ? mutateHeaders(headers, calls.length, params) : headers } } };
  }
  async function fetchRpc(path, init) {
    calls.push({ path, init });
    if (path === "/get_info") {
      infoReads++;
      const info = { status: "OK", height: tip + 1, mainnet: true, top_block_hash: header(tip).hash,
        tx_count: [...transactions].reduce((sum, [blockHeight, hashes]) => sum + (blockHeight <= tip ? hashes.length : 0), 0) };
      return { node: "https://node.example", data: mutateInfo ? mutateInfo(info, infoReads) : info };
    }
    assert.equal(path, "/get_transactions");
    if (failTransactions) throw new Error("Temporary RPC failure");
    const hashes = JSON.parse(init.body).txs_hashes;
    assert.ok(hashes.length <= 100, "each transaction RPC must be bounded");
    const txs = hashes.flatMap((txHash) => {
      const regular = records.get(txHash);
      if (regular) return [regular];
      const blockHeight = Number(BigInt(`0x${txHash}`)) - 5_000_000;
      if (blockHeight < 0 || blockHeight > tip) return [];
      return [{ tx_hash: txHash, block_height: blockHeight, as_json: JSON.stringify({ vin: [{ gen: { height: blockHeight } }], vout: [{}, {}] }) }];
    });
    return { node: "https://node.example", data: { status: "OK", txs: mutateTransactions ? mutateTransactions(txs, hashes) : txs } };
  }
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, console, URL, Response, btoa, atob,
    cachedJsonRpc: rpc, jsonRpc: rpc, cachedRpcFetch: fetchRpc, rpcFetch: fetchRpc,
    rpcFetchNode: (node, path, init) => { assert.equal(node, "https://node.example"); return fetchRpc(path, init); },
    explorerPageSize: (raw) => Number(raw), json: (data, status = 200) => Response.json(data, { status }),
  });
  return {
    calls, records, header,
    setTip(value) { tip = value; },
    reorganize() { anchorChanged = true; },
    failTransactions(value) { failTransactions = value; },
    request(kind, cursor = null, pageSize = 5, extra = "") {
      return testModule.exports[kind === "blocks" ? "blocksPageResponse" : "transactionsPageResponse"](pageUrl(kind, cursor, pageSize, extra));
    },
    blockDetail(height) { return testModule.exports.blockResponse(new URL(`https://explorer.example/api/block?id=${height}`)); },
  };
}

test("transaction cursors retain all transactions when one block spans multiple pages", async () => {
  const atTip = Array.from({ length: 13 }, (_, index) => hash(index + 1));
  const older = [hash(50), hash(51), hash(52)];
  const genesis = [hash(70)];
  const source = harness({ height: 12, transactions: new Map([[12, atTip], [11, older], [0, genesis]]) });
  const all = [];
  const pages = [];
  let cursor = null;
  do {
    const response = await source.request("transactions", cursor);
    assert.equal(response.status, 200);
    const page = await response.json();
    all.push(...page.rows.map((row) => row.hash));
    pages.push(page);
    cursor = page.nextCursor;
    assert.equal(page.hasMore, cursor !== null);
  } while (cursor);
  assert.deepEqual(all, [...atTip, ...older, ...genesis]);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(pages.map((page) => page.rows.length), [5, 5, 5, 2]);
  assert.equal(pages.at(-1).rows.at(-1).block, 0);
});

test("an advancing tip never shifts or duplicates anchored older transaction pages", async () => {
  const transactions = new Map([[8, Array.from({ length: 6 }, (_, index) => hash(index + 1))], [7, [hash(7)]]]);
  const source = harness({ height: 8, transactions });
  const initial = await (await source.request("transactions")).json();
  source.setTip(10);
  transactions.set(10, [hash(100)]);
  const older = await (await source.request("transactions", initial.nextCursor)).json();
  assert.equal(older.height, 10);
  assert.equal(older.anchorHeight, 8);
  assert.equal(older.anchorHash, initial.anchorHash);
  assert.deepEqual(older.rows.map((row) => row.hash), [hash(6), hash(7)]);
  assert.equal(older.rows[0].confirmations, 3);
  assert.equal(older.nextCursor, null);
});

test("sparse transaction scans expose an advancing continuation instead of a false history end", async () => {
  const source = harness({ height: 600, transactions: new Map([[50, [hash(1)]], [0, [hash(2)]]]) });
  const first = await (await source.request("transactions")).json();
  assert.deepEqual(first.rows, []);
  assert.equal(first.scannedBlocks, 512);
  assert.equal(first.scanLimited, true);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  const second = await (await source.request("transactions", first.nextCursor)).json();
  assert.deepEqual(second.rows.map((row) => row.block), [50, 0]);
  assert.equal(second.scannedBlocks, 89);
  assert.equal(second.hasMore, false);
  assert.equal(second.scanLimited, false);
});

test("genesis-only and empty chains finish without repeating height zero", async () => {
  for (const transactions of [new Map(), new Map([[0, [hash(1)]]])]) {
    const source = harness({ height: 0, transactions });
    const page = await (await source.request("transactions")).json();
    assert.equal(page.rows.length, transactions.size);
    assert.equal(page.nextCursor, null);
    assert.equal(page.hasMore, false);
    assert.equal(page.scannedBlocks, transactions.size === 0 ? 0 : 1);
  }
});

test("missing, duplicate and malformed header ranges never expose an advancing transaction cursor", async () => {
  const mutations = [
    (headers) => headers.slice(1),
    (headers) => headers.map((header, index) => index === 0 ? { ...header, height: 1 } : header),
    (headers) => headers.map((header, index) => index === 0 ? { ...header, hash: "invalid" } : header),
    (headers) => headers.map((header, index) => index === 0 ? { ...header, num_txes: 1, tx_hashes: [] } : header),
  ];
  for (const mutation of mutations) {
    const source = harness({ height: 12, transactions: new Map([[0, [hash(99)]]]), mutateHeaders: (headers) => headers.length > 1 ? mutation(headers) : headers });
    const response = await source.request("transactions");
    assert.equal(response.status, 503);
    const page = await response.json();
    assert.equal(page.live, false);
    assert.equal(page.nextCursor, undefined);
  }
});

test("a stalled transaction-detail request can retry the exact cursor without losing records", async () => {
  const all = Array.from({ length: 8 }, (_, index) => hash(index + 1));
  const source = harness({ height: 12, transactions: new Map([[12, all]]) });
  const first = await (await source.request("transactions")).json();
  source.failTransactions(true);
  const failed = await source.request("transactions", first.nextCursor);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).nextCursor, undefined);
  source.failTransactions(false);
  const retried = await (await source.request("transactions", first.nextCursor)).json();
  assert.deepEqual(retried.rows.map((row) => row.hash), all.slice(5));
  assert.equal(retried.hasMore, false);
});

test("missing or wrongly included transaction details fail instead of silently skipping rows", async () => {
  for (const mutation of [
    (records) => records.slice(1),
    (records) => records.map((record) => ({ ...record, block_height: record.block_height - 1 })),
    (records) => records.map((record) => ({ ...record, in_pool: true })),
    (records) => [...records, records[0]],
  ]) {
    const source = harness({ height: 12, transactions: new Map([[12, [hash(1), hash(2)]]]), mutateTransactions: mutation });
    const response = await source.request("transactions");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).nextCursor, undefined);
  }
});

test("a reorganized anchor rejects both ledger cursor kinds with a resettable conflict", async () => {
  const source = harness({ height: 12, transactions: new Map([[12, Array.from({ length: 8 }, (_, index) => hash(index + 1))]]) });
  const tx = await (await source.request("transactions")).json();
  const blocks = await (await source.request("blocks")).json();
  source.reorganize();
  for (const [kind, cursor] of [["transactions", tx.nextCursor], ["blocks", blocks.nextCursor]]) {
    const response = await source.request(kind, cursor);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /latest/);
  }
});

test("block cursors cover contiguous full history through genesis and keep exact reward fields", async () => {
  const source = harness({ height: 12, transactions: new Map([[10, [hash(1), hash(2)]]]) });
  const heights = [];
  let cursor = null;
  let rewarded;
  do {
    const response = await source.request("blocks", cursor);
    assert.equal(response.status, 200);
    const page = await response.json();
    heights.push(...page.rows.map((row) => row.height));
    rewarded ??= page.rows.find((row) => row.height === 10);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(heights, Array.from({ length: 13 }, (_, index) => 12 - index));
  assert.equal(rewarded.fee, 4);
  assert.equal(rewarded.reward, 96);
  assert.equal(rewarded.inputs, 2);
  assert.equal(rewarded.outputs, 4);
  assert.equal(source.calls.some((call) => call.method === "get_block"), false);
});

test("block headers remain usable with honest unknown fields when optional details fail", async () => {
  const source = harness({ height: 12, transactions: new Map([[12, [hash(1)]]]) });
  source.failTransactions(true);
  const page = await (await source.request("blocks")).json();
  assert.equal(page.pendingDetails, true);
  assert.equal(page.rows.length, 5);
  assert.equal(page.rows[0].fee, null);
  assert.equal(page.rows[0].reward, null);
  assert.equal(page.rows[0].outputs, null);
  assert.ok(page.nextCursor);
  const before = source.calls.filter((call) => call.path === "/get_transactions").length;
  const overview = await (await source.request("blocks", null, 5, "&overview=1")).json();
  assert.equal(overview.pendingDetails, true);
  assert.equal(source.calls.filter((call) => call.path === "/get_transactions").length, before);
});

test("old block heights remain addressable without a ten-thousand-page clamp", async () => {
  const source = harness({ height: 900_000 });
  const cursor = btoa(JSON.stringify({ version: 1, kind: "blocks", anchorHeight: 900_000, anchorHash: source.header(900_000).hash, nextHeight: 4, offset: 0 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const page = await (await source.request("blocks", cursor)).json();
  assert.deepEqual(page.rows.map((row) => row.height), [4, 3, 2, 1, 0]);
  assert.equal(page.anchorHeight, 900_000);
  assert.equal(page.hasMore, false);
});

test("invalid cursor, wrong cursor kind, and invalid page sizes return client errors", async () => {
  const source = harness();
  assert.equal((await source.request("transactions", "not-a-cursor")).status, 400);
  const blocks = await (await source.request("blocks")).json();
  assert.equal((await source.request("transactions", blocks.nextCursor)).status, 400);
  for (const size of ["50oops", "1", "101", "-5"]) assert.equal((await source.request("blocks", null, size)).status, 400);
});

test("block details expose validated regular transaction hashes, preserving unknown and verified-empty states", async () => {
  const expected = [hash(1), hash(2)];
  const transactions = new Map([[12, expected]]);
  const valid = await (await harness({ transactions }).blockDetail(12)).json();
  assert.deepEqual(valid.transactionHashes, expected);
  for (const blockHashes of ["omitted", [hash(1)], [hash(1), "malformed"], [hash(1), hash(1)]]) {
    const page = await (await harness({ transactions, blockHashes }).blockDetail(12)).json();
    assert.equal(page.transactionHashes, null);
  }
  const empty = await (await harness({ blockHashes: "omitted" }).blockDetail(12)).json();
  assert.deepEqual(empty.transactionHashes, []);
});

test("verified transaction totals and positions remain pinned as the current tip advances", async () => {
  const transactions = new Map([[12, Array.from({ length: 10 }, (_, index) => hash(index + 1))]]);
  const source = harness({ transactions });
  const first = await (await source.request("transactions")).json();
  assert.equal(first.totalRecords, 10);
  assert.equal(first.position, 0);
  assert.equal(source.calls.filter((call) => call.path === "/get_info").length, 2, "an uncached second same-node info read verifies the anchored count");
  source.setTip(14);
  transactions.set(14, [hash(100), hash(101), hash(102)]);
  const second = await (await source.request("transactions", first.nextCursor)).json();
  assert.equal(second.height, 14);
  assert.equal(second.totalRecords, 10);
  assert.equal(second.position, 5);
  assert.equal(second.rows.length, 5);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
  assert.equal(second.scannedBlocks, 1, "the final records do not create an empty tail page");
});

test("transaction take fills a logical page without changing its page size or skipping an in-block offset", async () => {
  const transactions = new Map([[12, Array.from({ length: 11 }, (_, index) => hash(index + 1))]]);
  const source = harness({ transactions });
  const first = await (await source.request("transactions", null, 5, "&take=2")).json();
  const second = await (await source.request("transactions", first.nextCursor, 5, "&take=3")).json();
  assert.equal(first.pageSize, 5);
  assert.equal(second.pageSize, 5);
  assert.equal(first.position, 0);
  assert.equal(second.position, 2);
  assert.equal(first.scanLimited, false);
  assert.equal(second.scanLimited, false);
  assert.deepEqual([...first.rows, ...second.rows].map((row) => row.hash), transactions.get(12).slice(0, 5));
  const third = await (await source.request("transactions", second.nextCursor)).json();
  const fourth = await (await source.request("transactions", third.nextCursor)).json();
  assert.equal(third.position, 5);
  assert.equal(fourth.position, 10);
  assert.equal(fourth.rows.length, 1);
  assert.equal(fourth.hasMore, false);
  assert.equal(fourth.position + fourth.rows.length, fourth.totalRecords);
});

test("empty scan segments preserve a zero position and remain resumable with a verified total", async () => {
  const source = harness({ height: 600, transactions: new Map([[50, [hash(1)]]]) });
  const first = await (await source.request("transactions")).json();
  assert.equal(first.totalRecords, 1);
  assert.equal(first.position, 0);
  assert.equal(first.rows.length, 0);
  assert.equal(first.scanLimited, true);
  const secondResponse = await source.request("transactions", first.nextCursor);
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.position, 0);
  assert.equal(second.rows.length, 1);
  assert.equal(second.totalRecords, 1);
  assert.equal(second.hasMore, false);
});

test("missing or racing latest transaction totals retry instead of publishing an unknown page count", async () => {
  for (const mutateInfo of [
    (info) => ({ ...info, tx_count: undefined }),
    (info) => ({ ...info, top_block_hash: undefined }),
    (info) => ({ ...info, top_block_hash: hash(999) }),
    (info, reads) => ({ ...info, tx_count: info.tx_count + (reads === 2 ? 1 : 0) }),
    (info, reads) => ({ ...info, height: info.height + (reads === 2 ? 1 : 0) }),
  ]) {
    const source = harness({ transactions: new Map([[12, Array.from({ length: 10 }, (_, index) => hash(index + 1))]]), mutateInfo });
    const response = await source.request("transactions");
    assert.equal(response.status, 503);
    const page = await response.json();
    assert.equal(page.live, false);
    assert.match(page.error, /total.*verif/i);
    assert.equal(page.rows, undefined);
    assert.equal(page.nextCursor, undefined);
  }
});

test("a transient count race recovers on the next fresh latest request without pinning an unknown anchor", async () => {
  const source = harness({ transactions: new Map([[12, Array.from({ length: 10 }, (_, index) => hash(index + 1))]]),
    mutateInfo: (info, reads) => ({ ...info, tx_count: info.tx_count + (reads === 2 ? 1 : 0) }) });
  assert.equal((await source.request("transactions")).status, 503);
  const recovered = await (await source.request("transactions")).json();
  assert.equal(recovered.totalRecords, 10);
  assert.equal(recovered.position, 0);
  assert.equal(recovered.rows.length, 5);
  assert.ok(recovered.nextCursor);
});

test("legacy cursors retain their history without fabricating a record position or a newer anchored total", async () => {
  const transactions = new Map([[12, [hash(1)]], [11, [hash(2)]], [9, [hash(3)]]]);
  const source = harness({ transactions });
  const encode = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const legacy = encode({ version: 1, kind: "transactions", anchorHeight: 12, anchorHash: source.header(12).hash, nextHeight: 11, offset: 0 });
  const currentAnchor = await (await source.request("transactions", legacy)).json();
  assert.equal(currentAnchor.position, null);
  assert.equal(currentAnchor.totalRecords, 3);
  assert.deepEqual(currentAnchor.rows.map((row) => row.hash), [hash(2), hash(3)]);
  const historical = encode({ version: 1, kind: "transactions", anchorHeight: 10, anchorHash: source.header(10).hash, nextHeight: 9, offset: 0 });
  const oldAnchor = await (await source.request("transactions", historical)).json();
  assert.equal(oldAnchor.position, null);
  assert.equal(oldAnchor.totalRecords, null);
  assert.deepEqual(oldAnchor.rows.map((row) => row.hash), [hash(3)]);
});

test("block totals and positions count the complete anchored chain including genesis", async () => {
  const source = harness();
  const first = await (await source.request("blocks")).json();
  const second = await (await source.request("blocks", first.nextCursor)).json();
  assert.equal(first.totalRecords, 13);
  assert.equal(first.position, 0);
  assert.equal(second.totalRecords, 13);
  assert.equal(second.position, 5);
});

test("invalid take values, changed cursor page sizes and impossible cursor counts are rejected", async () => {
  const source = harness({ transactions: new Map([[12, Array.from({ length: 10 }, (_, index) => hash(index + 1))]]) });
  for (const take of ["0", "6", "-1", "2oops"]) assert.equal((await source.request("transactions", null, 5, `&take=${take}`)).status, 400);
  const first = await (await source.request("transactions")).json();
  assert.equal((await source.request("transactions", first.nextCursor, 10)).status, 400);
  const original = JSON.parse(atob(first.nextCursor.replace(/-/g, "+").replace(/_/g, "/")));
  for (const changes of [{ position: -1 }, { position: 11 }, { position: 10 }, { position: 0 }, { totalRecords: -1 }, { totalRecords: null, position: 0 }]) {
    const cursor = btoa(JSON.stringify({ ...original, ...changes })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    assert.equal((await source.request("transactions", cursor)).status, 400);
  }
});

test("a forged small cursor total cannot truncate visibly remaining transactions", async () => {
  const source = harness({ transactions: new Map([[12, Array.from({ length: 10 }, (_, index) => hash(index + 1))]]) });
  const first = await (await source.request("transactions")).json();
  const original = JSON.parse(atob(first.nextCursor.replace(/-/g, "+").replace(/_/g, "/")));
  const cursor = btoa(JSON.stringify({ ...original, totalRecords: 6 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const response = await source.request("transactions", cursor);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).nextCursor, undefined);
});
