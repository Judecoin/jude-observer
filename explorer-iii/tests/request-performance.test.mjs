import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function loadModule(path, names, context = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const program = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n")
    + `\nmodule.exports = { ${names.join(", ")} };`;
  const compiled = ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, URL, URLSearchParams, Request, Response, Headers,
    AbortController, Date, Error, setTimeout, clearTimeout, ...context,
  });
  return testModule.exports;
}

function clock() {
  let now = 1_000_000;
  let nextId = 0;
  const timers = new Map();
  class ClockDate extends Date { static now() { return now; } }
  const environment = {
    Date: ClockDate,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return {
    environment, timers,
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

const RPC_NODES = ["https://preferred.test", "https://fallback.test", "https://third.test"];
async function rpcHarness(fetch) {
  const timer = clock();
  const rpc = await loadModule("../worker/rpc.ts", ["rpcFetch", "rpcNodePreference"], {
    ...timer.environment, fetch, JUDECOIN_RPC_NODES: RPC_NODES,
    JUDECOIN_EMISSION_API: "https://emission.test", RPC_FAILOVER_DELAY_MS: 350,
  });
  return { ...rpc, timer };
}

test("a slow preferred RPC launches a backup after the hedge delay and cancels the loser", async () => {
  const calls = [];
  const harness = await rpcHarness((url, { signal }) => {
    calls.push({ url, signal });
    if (url.startsWith(RPC_NODES[0])) return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    return Promise.resolve(Response.json({ status: "OK", height: 101 }));
  });
  const pending = harness.rpcFetch("/get_info");
  await harness.timer.advance(349);
  assert.equal(calls.length, 1);
  await harness.timer.advance(1);
  assert.equal((await pending).node, RPC_NODES[1]);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(harness.rpcNodePreference.current, RPC_NODES[1]);
  assert.equal(harness.timer.timers.size, 0);
});

test("a healthy preferred RPC does not start speculative node reads", async () => {
  const calls = [];
  const harness = await rpcHarness(async (url) => { calls.push(url); return Response.json({ status: "OK" }); });
  await harness.rpcFetch("/get_info");
  await harness.timer.advance(15_000);
  assert.deepEqual(calls, [`${RPC_NODES[0]}/get_info`]);
});

test("semantic RPC failures fail over immediately and preserve status validation", async () => {
  const calls = [];
  const harness = await rpcHarness(async (url) => {
    calls.push(url);
    return Response.json(url.startsWith(RPC_NODES[0]) ? { result: { status: "BUSY" } } : { result: { status: "OK", value: 42 } });
  });
  const result = await harness.rpcFetch("/json_rpc", { method: "POST", body: "{}" });
  assert.equal(result.data.result.value, 42);
  assert.equal(calls.length, 2);
  assert.equal(harness.timer.timers.size, 0);
});

test("an aborted caller cancels its RPC and prevents backup reads", async () => {
  const calls = [];
  const harness = await rpcHarness((url, { signal }) => {
    calls.push(url);
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const controller = new AbortController();
  const pending = harness.rpcFetch("/get_info", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
  await harness.timer.advance(15_000);
  assert.equal(calls.length, 1);
  assert.equal(harness.timer.timers.size, 0);
});

async function liveCacheHarness() {
  const stored = new Map();
  const cache = {
    async match(request) { return stored.get(request.url)?.clone(); },
    async put(request, response) { stored.set(request.url, response.clone()); },
  };
  const responses = await loadModule("../worker/responses.ts", ["noStoreResponse"]);
  const functions = await loadModule("../worker/live-cache.ts", ["cachedLiveResponse"], { caches: { default: cache }, ...responses });
  const policy = { path: "/api/service-nodes-live", freshMs: 5_000, staleMs: 300_000, ttlSeconds: 600, createdHeader: "x-created" };
  return { stored, request: (create, minimumHeight) => functions.cachedLiveResponse(new URL("https://explorer.test/api/service-nodes-live"), { ...policy, minimumHeight }, create, { waitUntil() {} }) };
}

test("concurrent live cache misses share one producer and independently readable bodies", async () => {
  const harness = await liveCacheHarness();
  let resolve;
  const gate = new Promise((done) => { resolve = done; });
  let calls = 0;
  const create = async () => { calls++; await gate; return Response.json({ live: true, height: 101 }); };
  const first = harness.request(create, 101);
  const second = harness.request(create, 101);
  await settle();
  assert.equal(calls, 1);
  resolve();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(harness.stored.size, 1);
});

test("live cache readers with different minimum heights cannot join an insufficient pending load", async () => {
  const harness = await liveCacheHarness();
  let release;
  const gate = new Promise((done) => { release = done; });
  const older = harness.request(async () => { await gate; return Response.json({ height: 100 }); }, 100);
  const newer = harness.request(async () => Response.json({ height: 101 }), 101);
  assert.equal((await (await newer).json()).height, 101);
  release();
  assert.equal((await (await older).json()).height, 101);
});

test("a failed shared live cache load clears so a subsequent request can recover", async () => {
  const harness = await liveCacheHarness();
  const failure = await harness.request(async () => Response.json({ live: false }, { status: 503 }), 101);
  assert.equal(failure.status, 503);
  assert.equal((await (await harness.request(async () => Response.json({ height: 101 }), 101)).json()).height, 101);
});

async function clientHarness(fetch) {
  const timer = clock();
  const constants = await loadModule("../app/explorer/constants.ts", ["SNAPSHOT_CACHE_TTL_MS", "SNAPSHOT_CACHE_MAX_ENTRIES", "SNAPSHOT_RETRY_DELAYS_MS", "LIVE_REQUEST_TIMEOUT_MS", "CHAIN_REQUEST_TIMEOUT_MS", "PAGE_SIZE_OPTIONS"]);
  const validation = await loadModule("../app/explorer/snapshot-validation.ts", ["isValidChainSnapshot", "isValidNetworkPreview", "shouldAcceptChainSnapshot"], constants);
  const functions = await loadModule("../app/explorer/requests.ts", ["fetchSnapshot", "fetchSnapshotWithRetry", "fetchExplorerJson", "snapshotCache"], { ...constants, ...validation, Date: timer.environment.Date, window: timer.environment, fetch });
  return { ...functions, timer, constants, validation };
}

function snapshot() {
  return {
    live: true, fetchedAt: "2026-09-20T00:00:00.000Z",
    network: { height: 100, difficulty: 1, hashrate: 1, targetSeconds: 180, latestBlockTimestamp: 100, hardFork: 16, blockSizeMedian: 1, blockSizeLimit: 2, protocol: "3", synced: true },
    blocks: [], transactions: [], serviceNodes: null, serviceNodesHeight: null,
    pagination: { blockPage: 0, transactionPage: 0, pageSize: 5, transactionScanSize: 160 },
    quorums: { page: 0, pageSize: 5, records: [] }, transactionPool: { available: false },
  };
}

test("browser deadline remains active while a response body is stalled", async () => {
  let requestSignal;
  const harness = await clientHarness(async (_url, { signal }) => {
    requestSignal = signal;
    return { ok: true, json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true })) };
  });
  const pending = harness.fetchExplorerJson("/api/network", "Network unavailable", 1_000);
  const rejected = assert.rejects(pending, /body aborted/);
  await harness.timer.advance(999);
  assert.equal(requestSignal.aborted, false);
  await harness.timer.advance(1);
  await rejected;
  assert.equal(requestSignal.aborted, true);
  assert.equal(harness.timer.timers.size, 0);
});

test("client page cache is bounded, expires abandoned pages, and deduplicates same-page reads", async () => {
  let calls = 0;
  const harness = await clientHarness(async () => { calls++; return Response.json(snapshot()); });
  const params = new URLSearchParams({ blockPage: "0" });
  const [first, second] = await Promise.all([harness.fetchSnapshot(params), harness.fetchSnapshot(params)]);
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  for (let page = 1; page <= harness.constants.SNAPSHOT_CACHE_MAX_ENTRIES + 5; page++) await harness.fetchSnapshot(new URLSearchParams({ blockPage: String(page) }));
  assert.equal(harness.snapshotCache.size, harness.constants.SNAPSHOT_CACHE_MAX_ENTRIES);
  await harness.timer.advance(harness.constants.SNAPSHOT_CACHE_TTL_MS + 1);
  await harness.fetchSnapshot(new URLSearchParams({ blockPage: "99" }));
  assert.equal(harness.snapshotCache.size, 1);
});

test("quorum-only page changes do not restart chain effects", async () => {
  const effects = [];
  let position = 0;
  let calls = 0;
  const functions = await loadModule("../app/explorer/hooks/use-chain-refresh.ts", ["useChainRefresh"], {
    useEffect(run, dependencies) {
      const previous = effects[position];
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
        previous?.cleanup?.();
        effects[position] = { dependencies, cleanup: run() };
      }
      position++;
    },
    fetchSnapshotWithRetry: () => { calls++; return new Promise(() => {}); },
    fetchSnapshot: () => new Promise(() => {}),
    TRANSACTION_POOL_REFRESH_DELAY_MS: 5_000,
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    window: { clearTimeout() {} },
  });
  const props = { serviceNodesOnly: false, pageSizePreferencesLoaded: true, snapshot: null, knownChainHeight: 0, highestKnownHeightRef: { current: 0 },
    snapshotParams: () => new URLSearchParams(), blockPage: 0, transactionPage: 0, blockPageSize: 5, transactionPageSize: 5 };
  functions.useChainRefresh({ ...props, quorumPage: 0, quorumPageSize: 5 });
  position = 0;
  functions.useChainRefresh({ ...props, quorumPage: 1, quorumPageSize: 25 });
  assert.equal(calls, 1);
  for (const effect of effects) effect.cleanup?.();
});

async function chainRefreshHarness(fetch, initialProps = {}) {
  const client = await clientHarness(fetch);
  const effects = [];
  let position = 0;
  const state = { snapshot: null, connection: "loading" };
  const props = {
    serviceNodesOnly: false, pageSizePreferencesLoaded: true, snapshot: null, knownChainHeight: 0,
    blockPage: 0, transactionPage: 0, blockPageSize: 5, transactionPageSize: 5,
    highestKnownHeightRef: { current: 0 },
    snapshotParams(_overrides, tip) { const params = new URLSearchParams(); if (tip > 0) params.set("tip", String(tip)); return params; },
    setSnapshot(update) { state.snapshot = typeof update === "function" ? update(state.snapshot) : update; },
    setServiceNodesLive() {}, setConnection(value) { state.connection = value; },
    ...initialProps,
  };
  const functions = await loadModule("../app/explorer/hooks/use-chain-refresh.ts", ["useChainRefresh"], {
    ...client, ...client.validation, window: client.timer.environment,
    NETWORK_REFRESH_DELAY_MS: 2_000, TRANSACTION_POOL_REFRESH_DELAY_MS: 5_000, HIDDEN_TAB_REFRESH_DELAY_MS: 30_000,
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    useEffect(run, dependencies) {
      const index = position++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, dependency) => !Object.is(value, previous.dependencies[dependency]))) {
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: run() };
      }
    }, rememberChainSnapshot: (data) => data,
    isProvisionalSnapshot: () => false,
  });
  const render = (changes = {}) => {
    Object.assign(props, changes);
    position = 0;
    functions.useChainRefresh({ ...props, snapshot: state.snapshot });
  };
  render();
  return { ...client, state, props, render, close() { for (const effect of effects) effect.cleanup?.(); } };
}

test("cold homepage renders verified headers before a slow full body then fills same-height details", async () => {
  let finish;
  const calls = [];
  const overview = { ...snapshot(), pendingDetails: true,
    blocks: [{ height: 100, timestamp: 100, hash: "a".repeat(64), txs: 0, size: 123, difficulty: 1, fee: null, reward: null, inputs: null, outputs: null }] };
  const complete = { ...overview, pendingDetails: undefined,
    blocks: [{ ...overview.blocks[0], fee: 0, reward: 896, inputs: 0, outputs: 2 }] };
  const harness = await chainRefreshHarness(async (url) => {
    calls.push(url);
    if (url.includes("overview=1")) return Response.json(overview);
    return { ok: true, json: () => new Promise((resolve) => { finish = resolve; }) };
  });
  await settle();
  assert.equal(harness.state.snapshot.pendingDetails, true);
  assert.equal(harness.state.snapshot.blocks[0].height, 100);
  assert.equal(harness.state.snapshot.blocks[0].reward, null);
  assert.equal(calls.length, 2);
  finish(complete);
  await settle();
  assert.equal(harness.state.snapshot.pendingDetails, undefined);
  assert.equal(harness.state.snapshot.blocks[0].reward, 896);
  assert.equal(harness.state.connection, "live");
  harness.close();
});

test("a stalled full response hits its deadline and recovers at the same height on background retry", async () => {
  let fullCalls = 0;
  const signals = [];
  const overview = { ...snapshot(), pendingDetails: true };
  const harness = await chainRefreshHarness(async (url, { signal }) => {
    if (url.includes("overview=1")) return Response.json(overview);
    fullCalls++;
    signals.push(signal);
    if (fullCalls === 1) return { ok: true, json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true })) };
    return Response.json(snapshot());
  });
  await settle();
  assert.equal(harness.state.snapshot.pendingDetails, true);
  await harness.timer.advance(harness.constants.CHAIN_REQUEST_TIMEOUT_MS);
  assert.equal(signals[0].aborted, true);
  assert.equal(harness.state.connection, "offline");
  await harness.timer.advance(5_000);
  assert.equal(fullCalls, 2);
  assert.equal(harness.state.snapshot.pendingDetails, undefined);
  assert.equal(harness.state.snapshot.network.height, 100);
  assert.equal(harness.state.connection, "live");
  harness.close();
});

test("a catch-up overview reaching the target does not cancel its still-pending decoded details", async () => {
  let finish;
  const newer = { ...snapshot(), network: { ...snapshot().network, height: 101 } };
  const harness = await chainRefreshHarness(async (url) => {
    if (!url.includes("tip=101")) return Response.json(snapshot());
    if (url.includes("overview=1")) return Response.json({ ...newer, pendingDetails: true, headerOnly: true });
    return { ok: true, json: () => new Promise((resolve) => { finish = resolve; }) };
  });
  await settle();
  assert.equal(harness.state.snapshot.network.height, 100);
  harness.props.highestKnownHeightRef.current = 101;
  harness.render({ knownChainHeight: 101 });
  await settle();
  assert.equal(harness.state.snapshot.network.height, 101);
  assert.equal(harness.state.snapshot.pendingDetails, true);
  harness.render();
  finish(newer);
  await settle();
  assert.equal(harness.state.snapshot.pendingDetails, undefined);
  assert.equal(harness.state.snapshot.network.height, 101);
  harness.close();
});

test("a longer successful chain poll keeps new-tip catch-up immediate and incomplete retries at five seconds", async () => {
  let fullCalls = 0;
  const harness = await chainRefreshHarness(async (url) => {
    if (!url.includes("overview=1")) fullCalls++;
    const height = url.includes("tip=101") ? 101 : 100;
    return Response.json({ ...snapshot(), network: { ...snapshot().network, height } });
  }, { successPollDelayMs: 30_000 });
  await settle();
  assert.equal(fullCalls, 1);
  await harness.timer.advance(5_000);
  assert.equal(fullCalls, 1, "a complete snapshot must not repeat the old five-second heavy read");
  harness.props.highestKnownHeightRef.current = 101;
  harness.render({ knownChainHeight: 101 });
  await settle();
  assert.equal(fullCalls, 2, "a known new block must refresh immediately instead of waiting thirty seconds");
  assert.equal(harness.state.snapshot.network.height, 101);
  await harness.timer.advance(24_999);
  assert.equal(fullCalls, 2);
  await harness.timer.advance(1);
  assert.equal(fullCalls, 3);
  harness.close();

  for (const incomplete of [true, false]) {
    let calls = 0;
    const retry = await chainRefreshHarness(async (url) => {
      if (url.includes("overview=1")) return Response.json({ ...snapshot(), pendingDetails: true, headerOnly: true });
      calls++;
      if (!incomplete && calls === 1) return Response.json({ error: "Temporary failure" }, { status: 503 });
      return Response.json({ ...snapshot(), ...(incomplete ? { pendingDetails: true } : {}) });
    }, { successPollDelayMs: 30_000 });
    await settle();
    await retry.timer.advance(4_999);
    assert.equal(calls, 1);
    await retry.timer.advance(1);
    assert.equal(calls, 2, "partial data and failures must retain the five-second retry");
    retry.close();
  }
});
