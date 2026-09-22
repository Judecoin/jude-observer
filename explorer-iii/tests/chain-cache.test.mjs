import { readProductionSource } from "./helpers/production-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const workerSource = await readProductionSource(new URL("../worker/index.ts", import.meta.url));
const sourceFile = ts.createSourceFile("worker/index.ts", workerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.ok(sourceFile.statements.some((statement) => ts.isFunctionDeclaration(statement)
  && statement.name?.text === "createChainResponse"));



const instrumented = sourceFile.statements.map((statement) => {
  if (ts.isImportDeclaration(statement) || ts.isExportAssignment(statement)) return "";
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === "createChainResponse") {
    return "async function createChainResponse(url: URL) { return mockedCreateChainResponse(url); }";
  }
  return statement.getFullText(sourceFile);
}).join("\n") + "\nmodule.exports = { cachedChainResponse };\n";
const compiled = ts.transpileModule(instrumented, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "chain-cache-instrumented.ts",
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function chainResponse(height, extra = {}, status = 200) {
  return new Response(JSON.stringify({
    live: status === 200,
    fetchedAt: "2026-09-20T00:00:00.000Z",
    network: { height },
    blocks: [{ height, hash: "a".repeat(64), txs: 0 }],
    transactions: [],
    serviceNodesHeight: height,
    serviceNodes: { total: 439, active: 439 },
    ...extra,
  }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function cacheHarness(produce = async () => chainResponse(1_000)) {
  let now = 1_000_000;
  const stored = new Map();
  const calls = [];
  const background = [];
  const cache = {
    async match(request) { return stored.get(request.url)?.clone(); },
    async put(request, response) { stored.set(request.url, response.clone()); },
  };
  const testModule = { exports: {} };
  class TestDate extends Date {
    static now() { return now; }
  }
  vm.runInNewContext(compiled, {
    module: testModule,
    exports: testModule.exports,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    AbortController,
    Date: TestDate,
    console,
    setTimeout,
    clearTimeout,
    caches: { default: cache },
    async mockedCreateChainResponse(url) {
      calls.push(new URL(url));
      return produce(new URL(url), calls.length);
    },
  }, { filename: "chain-cache-instrumented.cjs" });
  return {
    calls,
    stored,
    background,
    advance(milliseconds) { now += milliseconds; },
    request(query = "") {
      const url = new URL(`https://explorer.example/api/chain${query ? `?${query}` : ""}`);
      return testModule.exports.cachedChainResponse(new Request(url), url, {
        waitUntil(promise) { background.push(Promise.resolve(promise)); },
        passThroughOnException() {},
      });
    },
  };
}

test("chain cache reuses normalized default parameters without changing response data", async () => {
  const harness = cacheHarness();
  const initial = await harness.request();
  const initialData = await initial.json();
  const explicit = await harness.request("quorumPageSize=5&transactionPage=0&blockPageSize=5&quorumPage=0&blockPage=0&transactionPageSize=5");
  assert.deepEqual(await explicit.json(), initialData);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.stored.size, 1);
  assert.equal(explicit.headers.get("cache-control"), "no-store");
});

test("chain cache isolates all page selections and page sizes", async () => {
  const harness = cacheHarness(async (_url, sequence) => chainResponse(1_000, { sequence }));
  const queries = ["", "blockPage=1", "transactionPage=1", "quorumPage=1",
    "blockPageSize=10", "transactionPageSize=10", "quorumPageSize=10"];
  const first = [];
  for (const query of queries) first.push(await (await harness.request(query)).json());
  for (let index = 0; index < queries.length; index += 1) {
    assert.deepEqual(await (await harness.request(queries[index])).json(), first[index]);
  }
  assert.equal(harness.calls.length, queries.length);
  assert.equal(harness.stored.size, queries.length);
});

test("a requested tip ahead of either fresh or stale chain cache waits for a caught-up result", async () => {
  const harness = cacheHarness(async (url) => chainResponse(Number(url.searchParams.get("tip") || 1_000)));
  assert.equal((await (await harness.request("tip=1000")).json()).network.height, 1_000);
  harness.advance(1);
  assert.equal((await (await harness.request("tip=1001")).json()).network.height, 1_001);
  harness.advance(6_001);
  assert.equal((await (await harness.request("tip=1002")).json()).network.height, 1_002);
  assert.equal(harness.calls.length, 3);
  assert.equal(harness.stored.size, 1, "minimum tip must not fragment the shared page cache");
  assert.equal(harness.background.length, 0, "below-tip results must not be returned via background refresh");
  assert.equal((await (await harness.request("tip=1001")).json()).network.height, 1_002);
  assert.equal(harness.calls.length, 3, "a snapshot already above the requested minimum is reusable");
});

test("a failed requested-tip refresh preserves the complete last verified chain response", async () => {
  const harness = cacheHarness(async (_url, sequence) => sequence === 1
    ? chainResponse(1_000)
    : new Response(JSON.stringify({ live: false, error: "RPC unavailable" }), { status: 503 }));
  const verified = await (await harness.request("tip=1000")).json();
  const response = await harness.request("tip=1001");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), verified);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.stored.size, 1);
  assert.deepEqual(await harness.stored.values().next().value.clone().json(), verified);
});

test("a slower lower-height refresh cannot replace a newer verified chain snapshot", async () => {
  const harness = cacheHarness(async (_url, sequence) => chainResponse(sequence === 1 ? 1_001 : 1_000));
  const newer = await (await harness.request()).json();
  harness.advance(300_001);
  const response = await harness.request();
  assert.deepEqual(await response.json(), newer);
  assert.deepEqual(await harness.stored.values().next().value.clone().json(), newer);
  assert.equal(harness.calls.length, 2);
});

test("concurrent identical chain refreshes share one producer and independently readable responses", async () => {
  const started = deferred();
  const release = deferred();
  const harness = cacheHarness(async () => {
    started.resolve();
    await release.promise;
    return chainResponse(1_000);
  });
  const requests = [harness.request("tip=1000"), harness.request("tip=1000"), harness.request("tip=1000")];
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  const callsWhilePending = harness.calls.length;
  release.resolve();
  const responses = await Promise.all(requests);
  assert.equal(callsWhilePending, 1);
  assert.notEqual(responses[0], responses[1]);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(payloads[0], payloads[1]);
  assert.deepEqual(payloads[1], payloads[2]);
  assert.equal(harness.calls.length, 1);
});

test("stale matching snapshots return before one shared background refresh finishes", async () => {
  const started = deferred();
  const release = deferred();
  const harness = cacheHarness(async (_url, sequence) => {
    if (sequence === 1) return chainResponse(1_000);
    started.resolve();
    await release.promise;
    return chainResponse(1_001);
  });
  const verified = await (await harness.request("tip=1000")).json();
  harness.advance(6_001);
  const responses = await Promise.all([harness.request("tip=1000"), harness.request("tip=1000")]);
  await started.promise;
  const payloads = await Promise.all(responses.map((response) => response.json()));


  assert.deepEqual(payloads[0], verified);
  assert.deepEqual(payloads[1], verified);
  const callsWhilePending = harness.calls.length;
  release.resolve();
  await Promise.all(harness.background);
  assert.equal(callsWhilePending, 2, "one initial read and one shared refresh");
  assert.equal((await (await harness.request("tip=1001")).json()).network.height, 1_001);
  assert.equal(harness.calls.length, 2);
});

test("a coalesced failed refresh is cleared so the next request can recover", async () => {
  const started = deferred();
  const release = deferred();
  const harness = cacheHarness(async (_url, sequence) => {
    if (sequence > 1) return chainResponse(1_000);
    started.resolve();
    await release.promise;
    return new Response(JSON.stringify({ live: false, error: "temporary RPC failure" }), { status: 503 });
  });
  const requests = [harness.request("tip=1000"), harness.request("tip=1000")];
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  const callsWhilePending = harness.calls.length;
  release.resolve();
  const failedResponses = await Promise.all(requests);
  assert.equal(callsWhilePending, 1);
  for (const response of failedResponses) {
    assert.equal(response.status, 503);
    assert.equal((await response.json()).live, false);
  }
  assert.equal(harness.stored.size, 0);
  const recovered = await harness.request("tip=1000");
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).network.height, 1_000);
  assert.equal(harness.calls.length, 2);
});

test("different minimum tips do not share an insufficient in-flight refresh", async () => {
  const lowStarted = deferred();
  const highStarted = deferred();
  const releaseLow = deferred();
  const releaseHigh = deferred();
  const harness = cacheHarness(async (url) => {
    const height = Number(url.searchParams.get("tip"));
    (height === 1_000 ? lowStarted : highStarted).resolve();
    await (height === 1_000 ? releaseLow : releaseHigh).promise;
    return chainResponse(height);
  });
  const lower = harness.request("tip=1000");
  const higher = harness.request("tip=1001");
  await Promise.all([lowStarted.promise, highStarted.promise]);
  releaseHigh.resolve();
  assert.equal((await (await higher).json()).network.height, 1_001);
  releaseLow.resolve();
  assert.equal((await (await lower).json()).network.height, 1_001);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.stored.size, 1);
  assert.equal((await harness.stored.values().next().value.clone().json()).network.height, 1_001);
});
