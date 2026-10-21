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
const source = [await stripped("../app/explorer/snapshot-validation.ts"), await stripped("../worker/bootstrap-store.ts"),
  await stripped("../worker/bootstrap.ts"), "module.exports={ExplorerSnapshotStore,explorerBootstrap,rememberBootstrapResponse,bootstrapCacheKey};"].join("\n");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const hash = (n) => n.toString(16).padStart(64, "0");

function storageFixture() {
  const values = new Map();
  const storage = {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { return values.delete(key); },
    async transaction(work) { return work(storage); },
  };
  return { storage, values };
}

function harness(storage, { age = 0, unavailable = false, edgeCache } = {}) {
  let now = Date.parse("2026-10-21T15:00:00Z") + age;
  const calls = [], jobs = [];
  class ClockDate extends Date { static now() { return now; } constructor(...args) { super(...(args.length ? args : [now])); } }
  const network = () => ({ live: true, fetchedAt: new Date(now).toISOString(), source: "Judecoin mainnet", node: "node.test", network: {
    height: 882000, difficulty: 10, hashrate: 1, targetSeconds: 180, targetVerified: true, latestBlockTimestamp: Math.floor(now / 1000),
    latestBlockAgeSeconds: 0, hardFork: 16, protocol: "16", synced: true, blockSizeMedian: 100, blockSizeLimit: 1000,
  } });
  const ledger = (kind, url) => {
    const pageSize = Number(url.searchParams.get("pageSize") ?? 50);
    const rows = Array.from({ length: pageSize }, (_, i) => kind === "blocks"
      ? { height: 882000 - i, hash: hash(882000 - i), timestamp: Math.floor(now / 1000) - i * 180,
        txs: 0, size: 120, difficulty: 10, fee: 0, reward: 896, inputs: 0, outputs: 1 }
      : { block: 882000 - i, hash: hash(2000000 - i), timestamp: Math.floor(now / 1000) - i * 180,
        size: 120, confirmations: i + 1, fee: 0, reward: 0, inputs: 1, outputs: 2, txType: "transfer" });
    return { live: true, fetchedAt: new Date(now).toISOString(), height: 882000, anchorHeight: 882000, anchorHash: hash(882000),
      pageSize, position: 0, rows, totalRecords: kind === "blocks" ? 882001 : 100, hasMore: true, nextCursor: "next", scannedBlocks: pageSize, scanLimited: false };
  };
  const invoke = async (kind, url) => {
    calls.push({ kind, url: new URL(url) });
    if (unavailable) throw new Error("Upstream unavailable");
    if (kind === "network") return Response.json(network());
    if (kind === "blocks" || kind === "transactions") return Response.json(ledger(kind, url));
    if (kind === "serviceNodes") return Response.json({ live: true, fetchedAt: new Date(now).toISOString(), height: 882000,
      serviceNodes: { total: 0, active: 0, funded: 0, exiting: 0, decommissioned: 0, totalContributed: 0, stakingRequirement: 23600,
        nodes: [], awaitingNodes: [], unlockingNodes: [], decommissionedNodes: [] } });
    if (kind === "quorums") return Response.json({ live: true, fetchedAt: new Date(now).toISOString(), height: 882000,
      trusted: true, page: 0, pageSize: 10, records: [{ height: 882000, validators: [], workers: [] }] });
    if (kind === "transactionPool") return Response.json({ available: true, count: 0, totalBytes: 0, transactions: [] });
    return Response.json({ ...network(), pendingDetails: false, headerOnly: false, blocks: [], transactions: [], serviceNodes: null,
      serviceNodesHeight: null, pagination: { blockPage: 0, transactionPage: 0, pageSize: 10, transactionScanSize: 320 },
      quorums: { page: 0, pageSize: 10, records: [] }, transactionPool: { available: true } });
  };
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, URL, URLSearchParams, Request, Response, btoa, atob, Date: ClockDate,
    setTimeout, clearTimeout, PAGE_SIZE_OPTIONS: [5, 10, 20, 25, 50, 100],
    ...(edgeCache ? { caches: { default: edgeCache } } : {}),
    cachedNetworkLiveResponse: (url) => invoke("network", url), cachedServiceNodesLiveResponse: (url) => invoke("serviceNodes", url),
    cachedQuorumLiveResponse: (url) => invoke("quorums", url), cachedTransactionPoolLiveResponse: (url) => invoke("transactionPool", url),
    cachedChainResponse: (_request, url) => invoke("chain", url), blocksPageResponse: (url) => invoke("blocks", url), transactionsPageResponse: (url) => invoke("transactions", url),
  });
  const store = new testModule.exports.ExplorerSnapshotStore({ storage });
  const env = { EXPLORER_SNAPSHOTS: { idFromName(name) { return name; }, get() { return store; } } };
  const ctx = { waitUntil(job) { jobs.push(Promise.resolve(job)); }, passThroughOnException() {} };
  return { ...testModule.exports, store, env, ctx, jobs, calls, network,
    advance(ms) { now += ms; },
    render(path = "/") { return testModule.exports.explorerBootstrap(new URL(path, "https://explorer.test"), ctx, env); },
    async settle() { for (let i = 0; i < jobs.length; i++) await jobs[i]; },
  };
}

test("new worker instances recover timestamped menu data even when edge cache and upstream are unavailable", async () => {
  const { storage } = storageFixture();
  const first = harness(storage);
  const homepage = await first.render();
  assert.equal(homepage.blocks.rows.length, 10);
  await first.settle();
  assert.ok(first.calls.some(({ kind, url }) => kind === "blocks" && url.searchParams.get("pageSize") === "50"));
  assert.ok(first.calls.some(({ kind, url }) => kind === "transactions" && url.searchParams.get("pageSize") === "50"));
  const replacement = harness(storage, { age: 600000, unavailable: true });
  const reopened = await replacement.render();
  assert.equal(reopened.network.network.height, 882000);
  assert.equal(reopened.network.fetchedAt, homepage.network.fetchedAt);
  assert.equal(reopened.blocks.rows.length, 10);
  assert.equal(reopened.transactions.rows.length, 10);
  const blocks = await replacement.render("/blocks");
  assert.equal(blocks.blocks.pageSize, 50);
  assert.equal(blocks.blocks.rows.length, 50);
  const transactions = await replacement.render("/transactions");
  assert.equal(transactions.transactions.pageSize, 50);
  assert.equal(transactions.transactions.rows.length, 50);
  assert.equal(transactions.ledgerRequest.cursor, null);
  const nodes = await replacement.render("/service-nodes");
  assert.equal(nodes.serviceNodes.height, 882000);
  const statistics = await replacement.render("/statistics");
  assert.equal(statistics.chain.headerOnly, false);
  await replacement.settle();
});

test("persistent fallback starts even while an edge-cache lookup is stalled", async () => {
  const { storage } = storageFixture();
  const first = harness(storage);
  await first.render();
  await first.settle();
  let reads = 0;
  const countingStorage = { ...storage, async get(key) { reads++; return storage.get(key); } };
  const next = harness(countingStorage, { age: 600000, unavailable: true,
    edgeCache: { match: () => new Promise(() => {}), async put() {} } });
  const render = next.render("/blocks");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(reads > 0, "durable data must be read before the blocked edge lookup finishes");
  const page = await render;
  assert.equal(page.network.network.height, 882000);
  assert.equal(page.blocks.rows.length, 50);
});

test("persistent page keys never substitute a different page size or unobserved cursor", async () => {
  const { storage } = storageFixture();
  const first = harness(storage);
  await first.render();
  await first.settle();
  const next = harness(storage, { age: 600000, unavailable: true });
  const absent = await next.render("/blocks?pageSize=20");
  assert.equal(absent.blocks, null);
  assert.equal(absent.network.network.height, 882000);
  await next.settle();
});

test("persistent records expire after six hours and cannot replace a newer observed height", async () => {
  const { storage } = storageFixture();
  const h = harness(storage);
  const key = "/__explorer-bootstrap/v1/network";
  const write = (data) => h.store.fetch(new Request("https://snapshot.internal/", { method: "POST", body: JSON.stringify({ key, data }) }));
  await write(h.network());
  h.advance(31000);
  await write({ ...h.network(), network: { ...h.network().network, height: 881999 } });
  const request = new Request(`https://snapshot.internal/?keys=${encodeURIComponent(JSON.stringify([key]))}`);
  const saved = await (await h.store.fetch(request)).json();
  assert.equal(saved.snapshots[key].network.height, 882000);
  h.advance(6 * 60 * 60 * 1000);
  const expired = await (await h.store.fetch(request)).json();
  assert.deepEqual(expired.snapshots, {});
});

test("frequent changing heights obey the hard persistent write interval", async () => {
  const { storage } = storageFixture();
  const h = harness(storage);
  const key = "/__explorer-bootstrap/v1/network";
  const write = (data) => h.store.fetch(new Request("https://snapshot.internal/", { method: "POST", body: JSON.stringify({ key, data }) }));
  await write(h.network());
  h.advance(2000);
  await write({ ...h.network(), network: { ...h.network().network, height: 882001 } });
  const response = await (await h.store.fetch(new Request(`https://snapshot.internal/?keys=${encodeURIComponent(JSON.stringify([key]))}`))).json();
  assert.equal(response.snapshots[key].network.height, 882000);
});

test("persistent snapshot namespace rejects arbitrary keys and future or oversized records", async () => {
  const { storage } = storageFixture();
  const h = harness(storage);
  const write = (key, data) => h.store.fetch(new Request("https://snapshot.internal/", { method: "POST", body: JSON.stringify({ key, data }) }));
  assert.equal((await write("/not-a-bootstrap-key", h.network())).status, 400);
  assert.equal((await write("/__explorer-bootstrap/v1/network", { ...h.network(), fetchedAt: "2100-01-01T00:00:00Z" })).status, 400);
  assert.equal((await write("/__explorer-bootstrap/v1/network", { ...h.network(), excess: "a".repeat(2500001) })).status, 413);
});
