import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function stripped(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getFullText(ast)).join("\n");
}
const compiled = ts.transpileModule([
  await stripped("../app/explorer/snapshot-validation.ts"), await stripped("../worker/bootstrap.ts"),
  "module.exports={explorerBootstrap,rememberBootstrapResponse,bootstrapCacheKey};",
].join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const hash = (value) => BigInt(value).toString(16).padStart(64, "0");
const encode = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (value) => JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function fixtures(now, height = 1_000) {
  const fetchedAt = new Date(now).toISOString();
  const network = { live: true, fetchedAt, source: "Judecoin mainnet", node: "node.test", network: {
    height, difficulty: 10, hashrate: 1, targetSeconds: 180, targetVerified: true, latestBlockTimestamp: 1_700_000_000,
    latestBlockAgeSeconds: 1, hardFork: 17, blockSizeMedian: 1_000, blockSizeLimit: 2_000, protocol: "3.2.0", synced: true,
    txPoolSize: 0, coinbase: null, fees: null, minedSupply: null, supplyHeight: null, supplySource: null,
  } };
  const serviceNodes = { live: true, fetchedAt, height, serviceNodes: { total: 1, active: 1, funded: 1, exiting: 0, decommissioned: 0,
    stakingRequirement: 23_600, totalContributed: 23_600, page: 0, pageSize: 1, awaitingNodes: [], unlockingNodes: [], decommissionedNodes: [],
    nodes: [{ publicKey: hash(5), active: true, funded: true, version: "3.2.0", unlocking: false, contributed: 23_600, requirement: 23_600,
      registeredAt: 50, lastRewardAt: height, unlockAt: 0, contributors: 1, maxContributors: 4, lastUptimeProof: 100, operatorFee: 0 }] } };
  const quorums = { live: true, fetchedAt, height, source: "Judecoin mainnet", trusted: true, type: "Service Node testing", quorumType: 0,
    page: 0, pageSize: 10, hasOlder: true, truncated: false, records: [{ height, validators: [hash(5)], workers: [hash(6)] }], unavailable: [] };
  const blockRows = (size) => Array.from({ length: size }, (_, index) => ({ height: height - index, hash: hash(10_000 + height - index), timestamp: 1_700_000_000 - index * 180,
    txs: 0, size: 123, difficulty: 10, fee: 0, reward: 896, inputs: 0, outputs: 2 }));
  function ledger(kind, size, position = 0, length = size, total = 100) {
    const rows = kind === "blocks" ? blockRows(size).map((row) => ({ ...row, height: row.height - position, hash: hash(10_000 + row.height - position) }))
      : Array.from({ length }, (_, index) => ({ hash: hash(2_000_000 + position + index), block: height - Math.floor((position + index) / 10), timestamp: 1_700_000_000 - position - index,
        size: 123, confirmations: 1, fee: 0, reward: 0, inputs: 1, outputs: 2, txType: "transfer" }));
    const totalRecords = kind === "blocks" ? height + 1 : total;
    const hasMore = position + rows.length < totalRecords;
    const nextPosition = position + rows.length;
    const nextCursor = hasMore ? encode({ version: kind === "blocks" ? 1 : 2, kind, anchorHeight: height, anchorHash: hash(10_000 + height),
      nextHeight: kind === "blocks" ? height - nextPosition : height - Math.floor(nextPosition / 10), offset: kind === "blocks" ? 0 : nextPosition % 10,
      ...(kind === "transactions" ? { totalRecords, position: nextPosition, pageSize: size } : {}) }) : null;
    return { live: true, fetchedAt, source: "Judecoin mainnet", node: "node.test", height, anchorHeight: height, anchorHash: hash(10_000 + height),
      pageSize: size, rows, totalRecords, position, hasMore, nextCursor, scannedBlocks: length, scanLimited: hasMore && length < size };
  }
  return { network, serviceNodes, quorums, transactionPool: { available: true, count: 0, totalBytes: 0, transactions: [] },
    chain: { ...network, blocks: blockRows(10), transactions: [], pendingDetails: true, headerOnly: true,
      serviceNodes: null, serviceNodesHeight: null, quorums, transactionPool: { available: false, count: 0, totalBytes: 0, transactions: [] },
      pagination: { blockPage: 0, transactionPage: 0, pageSize: 10, transactionScanSize: 320 } }, ledger };
}

function harness(sharedStored = new Map()) {
  let now = Date.parse("2026-10-15T08:00:00Z");
  let nextTimer = 0;
  const timers = new Map(), stored = sharedStored, calls = [], background = [], overrides = {};
  class ClockDate extends Date { static now() { return now; } constructor(...args) { super(...(args.length ? args : [now])); } }
  const cache = { async match(request) { return stored.get(request.url)?.clone(); }, async put(request, response) { stored.set(request.url, response.clone()); } };
  const invoke = async (kind, url) => {
    calls.push({ kind, url: new URL(url) });
    if (overrides[kind]) return overrides[kind](new URL(url), fixtures(now));
    const data = fixtures(now);
    if (kind === "blocks" || kind === "transactions") {
      const size = Number(url.searchParams.get("pageSize") ?? 50);
      const cursor = url.searchParams.get("cursor");
      const position = cursor ? (decode(cursor).position ?? 1_000 - decode(cursor).nextHeight) : 0;
      return Response.json(data.ledger(kind, size, position, Math.min(Number(url.searchParams.get("take") ?? size), 100 - position)));
    }
    return Response.json(data[kind]);
  };
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, { module: testModule, exports: testModule.exports, URL, URLSearchParams, Request, Response, btoa, atob, Date: ClockDate,
    caches: { default: cache }, PAGE_SIZE_OPTIONS: [5, 10, 20, 25, 50, 100],
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, due: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    cachedNetworkLiveResponse: (url) => invoke("network", url), cachedServiceNodesLiveResponse: (url) => invoke("serviceNodes", url),
    cachedQuorumLiveResponse: (url) => invoke("quorums", url), cachedTransactionPoolLiveResponse: (url) => invoke("transactionPool", url),
    cachedChainResponse: (_request, url) => invoke("chain", url), blocksPageResponse: (url) => invoke("blocks", url), transactionsPageResponse: (url) => invoke("transactions", url),
  });
  const ctx = { waitUntil(promise) { background.push(promise); }, passThroughOnException() {} };
  return { calls, overrides, stored, background, ctx, fixtures: () => fixtures(now),
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); } await settle(); },
    render(path = "/") { return testModule.exports.explorerBootstrap(new URL(path, "https://explorer.test"), ctx); },
    async remember(kind, path, data) { await testModule.exports.rememberBootstrapResponse(kind, new URL(path, "https://explorer.test"), Response.json(data), ctx); await Promise.all(background); },
    cacheKey(kind, path) { return testModule.exports.bootstrapCacheKey(kind, new URL(path, "https://explorer.test")); },
  };
}

test("a cold homepage collects verified components in parallel and warm HTML reuses every main row", async () => {
  const h = harness();
  const first = await h.render();
  assert.equal(first.network.network.height, 1_000);
  assert.equal(first.serviceNodes.serviceNodes.nodes.length, 1);
  assert.equal(first.blocks.rows.length, 10);
  assert.equal(first.transactions.rows.length, 10);
  assert.equal(first.transactions.totalRecords, 100);
  assert.equal(first.chain.headerOnly, true);
  assert.equal(first.ledgerRequest, null);
  assert.equal(h.calls.length, 7);
  const second = await h.render();
  assert.equal(second.transactions.rows.length, 10);
  assert.equal(h.calls.length, 7);
  assert.equal(h.stored.size, 7);
});

test("stale verified components render immediately while one shared background refresh runs", async () => {
  const h = harness();
  await h.render();
  await h.advance(6_000);
  const release = gate();
  for (const kind of ["network", "serviceNodes", "quorums", "transactionPool", "chain", "blocks", "transactions"]) h.overrides[kind] = async (_url, data) => {
    await release.promise;
    return Response.json(kind === "blocks" || kind === "transactions" ? data.ledger(kind, 10) : data[kind]);
  };
  const first = h.render(), second = h.render();
  const marker = Symbol("pending");
  const value = await Promise.race([first, settle().then(() => marker)]);
  assert.notEqual(value, marker, "stale snapshots must not wait for the four-second cold deadline");
  assert.equal((await second).transactions.rows.length, 10);
  assert.equal(h.calls.length, 14, "concurrent stale visitors must share all seven refreshes");
  release.resolve();
  await Promise.all(h.background);
});

test("cold slow components respect the render deadline and finish safely for the next visit", async () => {
  const h = harness(), release = gate();
  h.overrides.serviceNodes = async (_url, data) => { await release.promise; return Response.json(data.serviceNodes); };
  const pendingRender = h.render("/service-nodes");
  await settle();
  await h.advance(4_000);
  const first = await pendingRender;
  assert.ok(first.network);
  assert.equal(first.serviceNodes, null);
  release.resolve(); await Promise.all(h.background);
  assert.equal(first.serviceNodes, null, "later tasks must not mutate already returned SSR props");
  assert.equal((await h.render("/service-nodes")).serviceNodes.serviceNodes.total, 1);
});

test("failed refreshes preserve a complete same-height snapshot and do not replace it with overview fields", async () => {
  const h = harness();
  const complete = h.fixtures().ledger("blocks", 10);
  await h.remember("blocks", "/api/blocks?pageSize=10", complete);
  await h.advance(6_000);
  const overview = h.fixtures().ledger("blocks", 10);
  overview.pendingDetails = true;
  overview.rows = overview.rows.map((row) => ({ ...row, fee: null, reward: null, inputs: null, outputs: null }));
  await h.remember("blocks", "/api/blocks?pageSize=10&overview=1", overview);
  h.overrides.blocks = async () => Response.json({ live: false }, { status: 503 });
  const result = await h.render();
  assert.equal(result.blocks.rows[0].reward, 896);
  assert.equal(result.blocks.pendingDetails, undefined);
});

test("transactions assemble sparse scan windows into one complete page before caching", async () => {
  const h = harness();
  h.overrides.transactions = async (url, data) => {
    const size = Number(url.searchParams.get("pageSize"));
    const cursor = url.searchParams.get("cursor");
    return Response.json(data.ledger("transactions", size, cursor ? 2 : 0, cursor ? Number(url.searchParams.get("take")) : 2));
  };
  const result = await h.render();
  assert.equal(result.transactions.rows.length, 10);
  const reads = h.calls.filter((call) => call.kind === "transactions");
  assert.equal(reads.length, 2);
  assert.equal(reads[1].url.searchParams.get("take"), "8");
  const cached = await h.stored.get(h.cacheKey("transactions", "/api/transactions?pageSize=10")).json();
  assert.equal(cached.rows.length, 10);
});

test("a failed later transaction window never caches or exposes a partial user page", async () => {
  const h = harness();
  h.overrides.transactions = async (url, data) => url.searchParams.has("cursor")
    ? Response.json({ live: false }, { status: 503 }) : Response.json(data.ledger("transactions", 10, 0, 2));
  const result = await h.render();
  assert.equal(result.transactions, null);
  assert.equal(h.stored.has(h.cacheKey("transactions", "/api/transactions?pageSize=10")), false);
  await h.remember("transactions", "/api/transactions?pageSize=10", h.fixtures().ledger("transactions", 10, 0, 2));
  assert.equal(h.stored.has(h.cacheKey("transactions", "/api/transactions?pageSize=10")), false);
});

test("standalone query selections retain their exact cursor, size, and verified page number", async () => {
  const h = harness();
  const first = h.fixtures().ledger("transactions", 50);
  const url = `/transactions?pageSize=50&cursor=${encodeURIComponent(first.nextCursor)}&page=999`;
  const result = await h.render(url);
  assert.equal(result.transactions.position, 50);
  assert.equal(result.transactions.rows.length, 50);
  assert.equal(result.ledgerRequest.cursor, first.nextCursor);
  assert.equal(result.ledgerRequest.pageSize, 50);
  assert.equal(result.ledgerRequest.page, 1, "page must come from verified record position, not the URL ordinal");
  for (const invalid of ["/transactions?pageSize=51", "/transactions?cursor=invalid", "/blocks?pageSize=50oops"]) {
    const value = await h.render(invalid);
    assert.equal(value.transactions, null); assert.equal(value.blocks, null); assert.equal(value.ledgerRequest, null);
  }
});

test("browser API capture warms compatible keys and accepts a five-row pool preview with a larger total", async () => {
  const h = harness(), data = h.fixtures();
  await h.remember("network", "/api/network?unused=1", data.network);
  assert.ok(h.stored.has(h.cacheKey("network", "/api/network")));
  const pool = { available: true, count: 12, totalBytes: 1_200, transactions: Array.from({ length: 5 }, (_, index) => ({
    hash: hash(index + 30), receivedAt: 1_700_000_000, size: 100, fee: 0, inputs: 1, outputs: 2, txType: "transfer",
  })) };
  await h.remember("transactionPool", "/api/transaction-pool", pool);
  const result = await h.render();
  assert.equal(result.transactionPool.count, 12);
  assert.equal(result.transactionPool.transactions.length, 5);
  assert.equal(h.calls.some((call) => call.kind === "network" || call.kind === "transactionPool"), false);
});

test("a slower lower-height capture cannot replace a newer verified public snapshot", async () => {
  const h = harness();
  const newer = { ...h.fixtures().network, network: { ...h.fixtures().network.network, height: 1_001 } };
  await h.remember("network", "/api/network", newer);
  await h.advance(100);
  await h.remember("network", "/api/network", h.fixtures().network);
  assert.equal((await h.render("/blocks")).network.network.height, 1_001);
});

test("expired five-minute snapshots cannot masquerade as first-render data after an outage", async () => {
  const h = harness();
  await h.render("/service-nodes");
  await h.advance(300_001);
  h.overrides.network = async () => Response.json({ live: false }, { status: 503 });
  h.overrides.serviceNodes = async () => Response.json({ live: false }, { status: 503 });
  const result = await h.render("/service-nodes");
  assert.equal(result.network, null);
  assert.equal(result.serviceNodes, null);
});

test("simultaneous cold requests share producers while keeping route selections separate", async () => {
  const h = harness(), release = gate();
  h.overrides.network = async (_url, data) => { await release.promise; return Response.json(data.network); };
  const first = h.render("/blocks?pageSize=10"), second = h.render("/blocks?pageSize=50");
  await settle();
  assert.equal(h.calls.filter((call) => call.kind === "network").length, 1);
  assert.equal(h.calls.filter((call) => call.kind === "blocks").length, 2);
  release.resolve();
  assert.equal((await first).blocks.rows.length, 10);
  assert.equal((await second).blocks.rows.length, 50);
});

test("a new isolate with empty memory reuses the verified shared public cache without RPC", async () => {
  const initial = harness();
  await initial.render();
  const visitor = harness(initial.stored);
  for (const kind of ["network", "serviceNodes", "quorums", "transactionPool", "chain", "blocks", "transactions"]) {
    visitor.overrides[kind] = async () => { throw new Error("RPC unavailable"); };
  }
  const result = await visitor.render();
  assert.equal(result.network.network.height, 1_000);
  assert.equal(result.serviceNodes.serviceNodes.nodes.length, 1);
  assert.equal(result.blocks.rows.length, 10);
  assert.equal(result.transactions.rows.length, 10);
  assert.equal(visitor.calls.length, 0);
});
