import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { validatePublicSearchTerm } from "../app/explorer/detail-search.ts";

const HASH = "a".repeat(64);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const page = (extra = {}) => ({ live: true, fetchedAt: "2026-10-15T05:00:00Z", source: "Judecoin mainnet", node: "test", height: 100, anchorHeight: 100, anchorHash: HASH, pageSize: 50, rows: [], nextCursor: "older", hasMore: true, scannedBlocks: 50, scanLimited: false, totalRecords: null, position: null, ...extra });
const block = (height = 100) => ({ height, timestamp: 100, hash: HASH, txs: 0, size: 100, difficulty: 100, fee: 0, reward: 896, inputs: 0, outputs: 2 });

async function load(path, names, environment) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const program = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n") + `\nmodule.exports = { ${names.join(", ")} };`;
  const compiled = ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  vm.runInNewContext(compiled, { module: result, exports: result.exports, URL, URLSearchParams, AbortController, DOMException, Error, Date, atob, btoa, ...environment });
  return result.exports;
}

async function ledgerHarness(kind, fetchLedgerPage, initialUrl = `https://explorer.test/${kind}`, options = undefined, storedPageSize = null) {
  const states = [], effects = [], pendingEffects = [], timers = new Map(), listeners = new Map();
  const browserStateAccess = [];
  let cursor = 0, effectIndex = 0, timerId = 0;
  const location = new URL(initialUrl);
  const entries = [{ url: initialUrl, state: null }];
  let entry = 0;
  const history = {
    get state() { browserStateAccess.push("read history"); return entries[entry].state; },
    replaceState(state, _unused, url) { browserStateAccess.push("replace history"); if (url) location.href = new URL(url, location).href; entries[entry] = { state, url: location.href }; },
    pushState(state, _unused, url) { browserStateAccess.push("push history"); location.href = new URL(url, location).href; entries.splice(entry + 1); entries.push({ state, url: location.href }); entry++; },
    back() { assert.ok(entry > 0); entry--; location.href = entries[entry].url; listeners.get("popstate")?.(); },
  };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }]; },
    useEffect(run, dependencies) { const index = effectIndex++; const old = effects[index]; if (!old || dependencies.some((value, item) => !Object.is(value, old.dependencies[item]))) pendingEffects.push(() => { old?.cleanup?.(); effects[index] = { dependencies, cleanup: run() }; }); },
  };
  const window = { location, history, localStorage: { getItem() { browserStateAccess.push("read storage"); return storedPageSize; }, setItem() { browserStateAccess.push("write storage"); } },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    setTimeout(run, delay) { const id = ++timerId; timers.set(id, { run, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const documentListeners = new Map();
  const document = { hidden: false, addEventListener(name, callback) { if (!documentListeners.has(name)) documentListeners.set(name, new Set()); documentListeners.get(name).add(callback); }, removeEventListener(name, callback) { documentListeners.get(name)?.delete(callback); } };
  const functions = await load("../app/explorer/hooks/use-ledger-refresh.ts", ["useLedgerRefresh", "readLedgerSelection"], { ...hooks, fetchLedgerPage, window, document, PAGE_SIZE_OPTIONS: [5, 10, 20, 25, 50, 100] });
  const render = () => { cursor = 0; effectIndex = 0; const value = Array.isArray(kind) ? kind.map((entryKind) => functions.useLedgerRefresh(entryKind, options)) : functions.useLedgerRefresh(kind, options); while (pendingEffects.length) pendingEffects.shift()(); return value; };
  const firstRender = render(); render(); await settle();
  return { render, firstRender, location, history, timers, functions, document, browserStateAccess, resume() { for (const callback of documentListeners.get("visibilitychange") ?? []) callback(); }, close() { for (const effect of effects) effect.cleanup?.(); } };
}

test("homepage block and transaction pagers default to ten and remain independent without reading or mutating shared browser state", async () => {
  const calls = [];
  const initialUrl = "https://explorer.test/?cursor=unrelated&pageSize=100&page=9#quorums";
  const harness = await ledgerHarness(["blocks", "transactions"], async (kind, params) => {
    calls.push({ kind, cursor: params.get("cursor"), pageSize: params.get("pageSize") });
    return page({ pageSize: Number(params.get("pageSize")), totalRecords: 1000, position: params.get("cursor") ? Number(params.get("pageSize")) : 0, nextCursor: `${kind}-older`, pendingDetails: params.has("overview") });
  }, initialUrl, { scope: "home" });
  let [blocks, transactions] = harness.render();
  assert.equal(blocks.pageSize, 10); assert.equal(transactions.pageSize, 10);
  assert.equal(blocks.cursor, null); assert.equal(transactions.cursor, null);
  blocks.next(); harness.render(); await settle(); [blocks, transactions] = harness.render();
  assert.equal(blocks.cursor, "blocks-older"); assert.equal(blocks.page, 1);
  assert.equal(transactions.cursor, null); assert.equal(transactions.page, 0);
  transactions.changePageSize(25); harness.render(); await settle(); [blocks, transactions] = harness.render();
  assert.equal(transactions.pageSize, 25); assert.equal(transactions.page, 0);
  assert.equal(blocks.pageSize, 10); assert.equal(blocks.page, 1);
  const pending = [...harness.timers.values()];
  assert.equal(pending.length, 2); assert.ok(pending.every((timer) => timer.delay === 10_000));
  harness.timers.clear(); for (const timer of pending) timer.run(); await settle(); [blocks, transactions] = harness.render();
  assert.equal(blocks.cursor, "blocks-older"); assert.equal(transactions.cursor, null);
  assert.ok(calls.some((call) => call.kind === "blocks" && call.cursor === "blocks-older" && call.pageSize === "10"));
  assert.ok(calls.some((call) => call.kind === "transactions" && call.cursor === null && call.pageSize === "25"));
  blocks.previous(); harness.render(); await settle(); [blocks, transactions] = harness.render();
  assert.equal(blocks.cursor, null); assert.equal(blocks.page, 0); assert.equal(transactions.pageSize, 25);
  transactions.next(); harness.render(); await settle(); [blocks, transactions] = harness.render();
  transactions.latest(); harness.render(); await settle(); [blocks, transactions] = harness.render();
  assert.equal(blocks.cursor, null); assert.equal(transactions.cursor, null);
  assert.equal(harness.location.href, initialUrl);
  assert.deepEqual(harness.browserStateAccess, []);
  harness.close();
});

test("first-load failures recover automatically, latest records refresh every ten seconds, and returning to the tab refreshes immediately", async () => {
  let calls = 0;
  const harness = await ledgerHarness("transactions", async () => {
    calls++;
    if (calls === 1) throw new Error("Mainnet data unavailable. Retrying…");
    return page({ height: 100 + calls, totalRecords: 1000, position: 0 });
  });
  let view = harness.render();
  assert.equal(view.loading, false, "A failed first load must release the loading indicator");
  assert.match(view.error, /Retrying/);
  let scheduled = [...harness.timers.values()];
  assert.equal(scheduled.length, 1); assert.equal(scheduled[0].delay, 5_000);
  harness.timers.clear(); scheduled[0].run(); await settle(); view = harness.render();
  assert.equal(view.error, ""); assert.equal(view.loading, false); assert.equal(view.data.height, 102);
  scheduled = [...harness.timers.values()];
  assert.equal(scheduled.length, 1); assert.equal(scheduled[0].delay, 10_000);
  harness.timers.clear(); scheduled[0].run(); await settle(); view = harness.render();
  assert.equal(view.data.height, 103);
  harness.document.hidden = true; harness.resume(); assert.equal(calls, 3);
  harness.document.hidden = false; harness.resume(); await settle(); view = harness.render();
  assert.equal(calls, 4); assert.equal(view.data.height, 104);
  assert.equal(view.cursor, null); assert.equal(view.page, 0);
  harness.close();
  assert.equal(harness.timers.size, 0);
});

test("standalone search accepts genesis and exact public hashes and rejects addresses or numeric transaction IDs", () => {
  assert.equal(validatePublicSearchTerm("block", "0"), "0");
  assert.equal(validatePublicSearchTerm("block", "9999999999"), "9999999999");
  assert.equal(validatePublicSearchTerm("block", "10000000000"), null);
  assert.equal(validatePublicSearchTerm("transaction", "0"), null);
  assert.equal(validatePublicSearchTerm("transaction", ` ${HASH.toUpperCase()} `), HASH);
  assert.equal(validatePublicSearchTerm("transaction", "JC5uYXGiMVnAesLnVFtUMuDe432ebjmTB5gntgnmj9H7G14W49mo5aD7zQVwKDnKVwhCX3zccBgiBBn3JordMBUkT25YLfk"), null);
});

test("a history URL restores its cursor and size, Next/Back preserve pinned selections, and details hashes do not reset the page", async () => {
  const calls = [];
  const harness = await ledgerHarness("transactions", async (_kind, params) => { calls.push(params.toString()); return page({ pageSize: Number(params.get("pageSize")), totalRecords: 1000, position: params.get("cursor") === "old" ? 150 : 175, anchorHeight: 90, nextCursor: params.get("cursor") === "old" ? "older" : "oldest" }); }, "https://explorer.test/transactions?cursor=old&page=7&pageSize=25");
  let view = harness.render();
  assert.equal(view.cursor, "old"); assert.equal(view.page, 6); assert.equal(view.pageSize, 25);
  assert.match(calls[0], /cursor=old/);
  view.next(); harness.render(); await settle(); view = harness.render();
  assert.equal(view.cursor, "older"); assert.equal(view.page, 7); assert.equal(view.canPrevious, true);
  assert.equal(harness.location.searchParams.get("cursor"), "older");
  harness.history.pushState(harness.history.state, "", "#tx-example");
  harness.history.back(); harness.render(); await settle(); view = harness.render();
  assert.equal(view.cursor, "older"); assert.equal(view.page, 7); assert.equal(view.canPrevious, true);
  harness.history.back(); harness.render(); await settle(); view = harness.render();
  assert.equal(view.cursor, "old"); assert.equal(view.page, 6);
  assert.equal(view.data.anchorHeight, 90);
  const automaticRefresh = [...harness.timers.values()];
  assert.equal(automaticRefresh.length, 1);
  assert.equal(automaticRefresh[0].delay, 10_000);
  harness.timers.clear();
  automaticRefresh[0].run();
  await settle(); view = harness.render();
  assert.match(calls.at(-1), /cursor=old/);
  assert.equal(view.cursor, "old"); assert.equal(view.page, 6);
  assert.equal(view.data.anchorHeight, 90, "Automatic refresh preserves the historical selection");
  harness.close();
});

test("a decoded block page wins over a late overview and navigation aborts every request from the old selection", async () => {
  let finishOverview;
  const signals = [];
  const harness = await ledgerHarness("blocks", async (_kind, params, signal) => {
    signals.push(signal);
    if (params.get("overview") === "1") return new Promise((resolve) => { finishOverview = resolve; });
    return page({ rows: [block()] });
  });
  let view = harness.render();
  assert.equal(view.data.rows[0].reward, 896);
  assert.ok(signals[0].aborted, "A completed full read cancels its slower overview");
  finishOverview(page({ pendingDetails: true, rows: [{ ...block(), reward: null, fee: null, inputs: null, outputs: null }] }));
  await settle(); view = harness.render();
  assert.equal(view.data.rows[0].reward, 896);
  view.next(); harness.render();
  assert.ok(signals.slice(0, 2).every((signal) => signal.aborted));
  harness.close();
});

test("sparse transaction pages retain an advancing cursor and Return latest clears history", async () => {
  const harness = await ledgerHarness("transactions", async (_kind, params) => page({ rows: [], totalRecords: 1000, position: params.get("cursor") ? 50 : 0, scanLimited: true, nextCursor: "continue" }));
  let view = harness.render();
  assert.equal(view.data.scanLimited, true); assert.equal(view.data.hasMore, true);
  view.next(); harness.render(); await settle(); view = harness.render();
  assert.equal(view.cursor, "continue");
  view.latest(); harness.render(); await settle(); view = harness.render();
  assert.equal(view.cursor, null); assert.equal(view.page, 0); assert.equal(view.canPrevious, false);
  assert.equal(harness.location.searchParams.has("cursor"), false);
  assert.equal(view.pageSize, 50);
  harness.close();
});

test("ledger requests reject malformed render fields, distinguish invalid history from outage, and bound stalled bodies", async () => {
  const timers = new Map(); let id = 0;
  let response = Response.json(page({ totalRecords: 101, position: 0, rows: [{ ...block(), difficulty: "unknown" }] }));
  const functions = await load("../app/explorer/ledger-requests.ts", ["fetchLedgerPage"], { window: { setTimeout(run) { timers.set(++id, run); return id; }, clearTimeout(key) { timers.delete(key); } }, fetch: async () => response });
  await assert.rejects(functions.fetchLedgerPage("blocks", new URLSearchParams({ pageSize: "50" })), /Invalid mainnet records/);
  response = Response.json({ live: false }, { status: 409 });
  await assert.rejects(functions.fetchLedgerPage("blocks", new URLSearchParams({ pageSize: "50" })), /history changed/);
  response = Response.json({ live: false }, { status: 503 });
  await assert.rejects(functions.fetchLedgerPage("blocks", new URLSearchParams({ pageSize: "50" })), /unavailable/);
  const stalled = await load("../app/explorer/ledger-requests.ts", ["fetchLedgerPage"], { window: { setTimeout(run) { timers.set(++id, run); return id; }, clearTimeout(key) { timers.delete(key); } }, fetch: async (_url, { signal }) => ({ ok: true, json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })) }) });
  const pending = stalled.fetchLedgerPage("transactions", new URLSearchParams({ pageSize: "50" }));
  const rejected = assert.rejects(pending, /timed out/);
  await settle(); for (const timer of timers.values()) timer(); await rejected;
  assert.equal(timers.size, 0);
});

test("direct block and transaction detail bodies share a bounded lookup deadline", async () => {
  const source = await readFile(new URL("../app/explorer/hooks/use-details.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("use-details.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helper = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "readPublicDetail").getText(ast);
  const testModule = { exports: {} };
  let expire, signal, cleared = false;
  vm.runInNewContext(ts.transpileModule(`${helper}\nmodule.exports = { readPublicDetail };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    module: testModule, exports: testModule.exports, AbortController, Error,
    setTimeout(callback, delay) { assert.equal(delay, 20_000); expire = callback; return 1; }, clearTimeout() { cleared = true; },
    fetch: async (_url, options) => { signal = options.signal; return { ok: true, json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true })) }; },
  });
  const pending = testModule.exports.readPublicDetail("/api/block?id=0", new AbortController().signal);
  const rejected = assert.rejects(pending, /lookup timed out/);
  await settle(); expire(); await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(cleared, true);
});

const transaction = (index, height = 100) => ({ hash: index.toString(16).padStart(64, "0"), block: height, timestamp: 100, size: 100, confirmations: 1, fee: 0, reward: 0, inputs: 1, outputs: 1, txType: "transfer" });

async function ledgerRequestHarness(produce) {
  const calls = [], deadlines = [], timers = new Map();
  let timerId = 0;
  const functions = await load("../app/explorer/ledger-requests.ts", ["fetchLedgerPage"], {
    window: { setTimeout(callback, delay) { deadlines.push(delay); timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    fetch: async (url, { signal }) => {
      const params = new URL(url, "https://explorer.test").searchParams;
      calls.push(new URLSearchParams(params));
      const data = await produce(params, calls.length, signal);
      return typeof data?.json === "function" ? data : Response.json(data);
    },
  });
  return { calls, deadlines, timers, request: (query = { pageSize: "10" }, signal, scope) => functions.fetchLedgerPage("transactions", new URLSearchParams(query), signal, scope) };
}

test("sparse scan segments fill one transaction page with remaining take, one deadline, and a stable next cursor", async () => {
  const segments = [
    page({ pageSize: 10, totalRecords: 20, position: 0, rows: [transaction(1), transaction(2), transaction(3)], nextCursor: "scan-1", scanLimited: true }),
    page({ pageSize: 10, totalRecords: 20, position: 3, rows: [], nextCursor: "scan-2", scanLimited: true, scannedBlocks: 512 }),
    page({ pageSize: 10, totalRecords: 20, position: 3, rows: Array.from({ length: 7 }, (_, index) => transaction(index + 4, 99)), nextCursor: "page-2" }),
  ];
  const harness = await ledgerRequestHarness((_params, call) => segments[call - 1]);
  const data = await harness.request();
  assert.equal(data.rows.length, 10); assert.equal(data.position, 0); assert.equal(data.totalRecords, 20);
  assert.equal(data.nextCursor, "page-2"); assert.equal(data.hasMore, true); assert.equal(data.scanLimited, false);
  assert.deepEqual(harness.calls.map((params) => params.get("take")), ["10", "7", "7"]);
  assert.ok(harness.calls.every((params) => params.get("pageSize") === "10"));
  assert.deepEqual(harness.deadlines, [35_000]); assert.equal(harness.timers.size, 0);
});

test("a known final transaction page may be short while legacy unknown positions stay unknown", async () => {
  const final = await ledgerRequestHarness(() => page({ pageSize: 10, totalRecords: 14, position: 10, rows: [11, 12, 13, 14].map((index) => transaction(index, 90)), nextCursor: null, hasMore: false }));
  const result = await final.request({ pageSize: "10", cursor: "final-page" });
  assert.equal(result.rows.length, 4); assert.equal(result.hasMore, false); assert.equal(result.position, 10);
  const legacy = await ledgerRequestHarness(() => page({ pageSize: 10, totalRecords: null, position: null, rows: [transaction(1)], nextCursor: null, hasMore: false }));
  const old = await legacy.request({ pageSize: "10", cursor: "legacy-cursor" });
  assert.equal(old.totalRecords, null); assert.equal(old.position, null); assert.equal(old.rows.length, 1);
});

test("segment assembly rejects anchor/count/position changes, duplicate records, reversed heights and stalled cursors", async (t) => {
  const first = page({ pageSize: 10, totalRecords: 20, position: 0, rows: [transaction(1)], nextCursor: "segment-2", scanLimited: true });
  const second = page({ pageSize: 10, totalRecords: 20, position: 1, rows: [transaction(2, 99)], nextCursor: "segment-3", scanLimited: true });
  const cases = [
    ["anchor", { ...second, anchorHash: "b".repeat(64) }],
    ["total", { ...second, totalRecords: 21 }],
    ["position", { ...second, position: 2 }],
    ["duplicate", { ...second, rows: [transaction(1, 99)] }],
    ["known count becomes unknown", { ...second, totalRecords: null }],
    ["cursor", { ...second, nextCursor: "segment-2" }],
    ["no scan progress", { ...second, rows: [], scannedBlocks: 0 }],
  ];
  for (const [name, failure] of cases) await t.test(name, async () => {
    const harness = await ledgerRequestHarness((_params, call) => call === 1 ? first : failure);
    await assert.rejects(harness.request(), /History|history/);
    assert.equal(harness.calls.length, 2); assert.equal(harness.timers.size, 0);
  });
  const reversed = await ledgerRequestHarness((_params, call) => call === 1
    ? { ...first, rows: [transaction(1, 90)] } : { ...second, rows: [transaction(2, 99)] });
  await assert.rejects(reversed.request(), /out of order/);
  const unaligned = await ledgerRequestHarness(() => ({ ...first, position: 3 }));
  await assert.rejects(unaligned.request({ pageSize: "10", cursor: "internal-scan-cursor" }), /page boundary/);
});

test("a slow continuation body shares one deadline and a hidden checkpoint completes the same page on retry", async () => {
  const harness = await ledgerRequestHarness((_params, call, signal) => {
    if (call === 1) return page({ pageSize: 10, totalRecords: 20, position: 0, rows: [transaction(1)], nextCursor: "continuation", scanLimited: true });
    if (call === 3) return page({ pageSize: 10, totalRecords: 20, position: 1, rows: Array.from({ length: 9 }, (_, index) => transaction(index + 2, 99)), nextCursor: "page-2" });
    return { ok: true, json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })) };
  });
  const pending = harness.request({ pageSize: "10", cursor: "original-page" });
  const rejected = assert.rejects(pending, /timed out/);
  await settle(); assert.equal(harness.calls.length, 2); assert.deepEqual(harness.deadlines, [35_000]);
  for (const expire of harness.timers.values()) expire(); await rejected;
  const completed = await harness.request({ pageSize: "10", cursor: "original-page" });
  assert.equal(completed.rows.length, 10); assert.equal(completed.position, 0); assert.equal(completed.nextCursor, "page-2");
  assert.equal(new Set(completed.rows.map((row) => row.hash)).size, 10);
  assert.deepEqual(harness.calls.map((params) => params.get("cursor")), ["original-page", "continuation", "continuation"]);
  assert.deepEqual(harness.calls.map((params) => params.get("take")), ["10", "9", "9"]);
  assert.deepEqual(harness.deadlines, [35_000, 35_000]); assert.equal(harness.timers.size, 0);
});

test("a verified count can upgrade unknown metadata while the assembled page retains its original position", async () => {
  const harness = await ledgerRequestHarness((_params, call) => call === 1
    ? page({ pageSize: 10, totalRecords: null, position: 0, rows: [transaction(1)], nextCursor: "continue", scanLimited: true })
    : page({ pageSize: 10, totalRecords: 20, position: 1, rows: Array.from({ length: 9 }, (_, index) => transaction(index + 2, 99)), nextCursor: "page-2" }));
  const data = await harness.request();
  assert.equal(data.totalRecords, 20); assert.equal(data.position, 0); assert.equal(data.rows.length, 10);
});

test("checkpoint progress is isolated by scope and discarded after a semantic inconsistency", async () => {
  let mode = "home failure";
  const first = page({ pageSize: 10, totalRecords: 20, position: 0, rows: [transaction(1)], nextCursor: "continuation", scanLimited: true });
  const remainder = page({ pageSize: 10, totalRecords: 20, position: 1, rows: Array.from({ length: 9 }, (_, index) => transaction(index + 2, 99)), nextCursor: "page-2" });
  const full = { ...first, rows: [transaction(1), ...remainder.rows], nextCursor: "page-2", scanLimited: false };
  const harness = await ledgerRequestHarness((params) => {
    if (mode === "home failure") return params.get("cursor") === "original" ? first : Response.json({ live: false }, { status: 503 });
    if (mode === "page") return full;
    if (mode === "resume") return remainder;
    if (mode === "semantic") return params.get("cursor") === "original" ? first : { ...remainder, anchorHash: "b".repeat(64) };
    return full;
  });
  const query = { pageSize: "10", cursor: "original" };
  await assert.rejects(harness.request(query, undefined, "home"), /unavailable/);
  mode = "page"; await harness.request(query, undefined, "page");
  assert.equal(harness.calls.at(-1).get("cursor"), "original");
  mode = "resume"; const resumed = await harness.request(query, undefined, "home");
  assert.equal(harness.calls.at(-1).get("cursor"), "continuation"); assert.equal(resumed.rows.length, 10);
  mode = "semantic"; await assert.rejects(harness.request(query, undefined, "home"), /inconsistent/);
  mode = "fresh"; await harness.request(query, undefined, "home");
  assert.equal(harness.calls.at(-1).get("cursor"), "original");
});

test("a parent abort clears hidden progress before returning to the same history page", async () => {
  let fresh = false;
  const first = page({ pageSize: 10, totalRecords: 20, position: 0, rows: [transaction(1)], nextCursor: "continuation", scanLimited: true });
  const harness = await ledgerRequestHarness((params, _call, signal) => {
    if (fresh) return { ...first, rows: Array.from({ length: 10 }, (_, index) => transaction(index + 1)), nextCursor: "page-2", scanLimited: false };
    if (params.get("cursor") === "original") return first;
    return { ok: true, json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })) };
  });
  const controller = new AbortController();
  const pending = harness.request({ pageSize: "10", cursor: "original" }, controller.signal);
  const rejected = assert.rejects(pending, /Aborted/);
  await settle(); controller.abort(); await rejected;
  fresh = true;
  await harness.request({ pageSize: "10", cursor: "original" });
  assert.equal(harness.calls.at(-1).get("cursor"), "original");
});

test("verified positions override a forged page ordinal and legacy transaction links restart with verified latest totals", async () => {
  const trusted = await ledgerHarness("transactions", async (_kind, params) => page({ totalRecords: 123, position: params.get("cursor") === "correct-next" ? 100 : 50, nextCursor: "correct-next" }), "https://explorer.test/transactions?cursor=verified&page=999&pageSize=50");
  let view = trusted.render(); assert.equal(view.page, 1); assert.equal(view.totalPages, 3);
  view.next(); trusted.render(); await settle(); view = trusted.render();
  assert.equal(trusted.location.searchParams.get("page"), "3"); assert.equal(view.page, 2); assert.equal(view.totalPages, 3);
  trusted.close();
  const legacyCursor = btoa(JSON.stringify({ version: 1, kind: "transactions", anchorHeight: 100, anchorHash: HASH, nextHeight: 90, offset: 0 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const calls = [];
  const migrated = await ledgerHarness("transactions", async (_kind, params) => { calls.push(params.get("cursor")); return page({ totalRecords: 123, position: 0 }); }, `https://explorer.test/transactions?cursor=${legacyCursor}&page=7&pageSize=50#tx-example`);
  view = migrated.render(); assert.equal(view.page, 0); assert.equal(view.totalPages, 3); assert.equal(view.cursor, null);
  assert.equal(migrated.location.searchParams.has("cursor"), false); assert.equal(migrated.location.searchParams.has("page"), false);
  assert.equal(migrated.location.hash, "#tx-example"); assert.deepEqual(calls, [null]);
  migrated.close();
  const compatibleBlocks = await ledgerHarness("blocks", async () => page({ totalRecords: undefined, position: undefined, pageSize: 10, rows: [block(90)] }), "https://explorer.test/blocks?cursor=older&page=999&pageSize=10");
  view = compatibleBlocks.render(); assert.equal(view.page, 1); assert.equal(view.totalPages, 11);
  compatibleBlocks.close();
});

test("historical refresh keeps its anchor while Latest and row-size changes start a new counted snapshot", async () => {
  let liveHeight = 100;
  const harness = await ledgerHarness("transactions", async (_kind, params) => {
    const size = Number(params.get("pageSize"));
    const cursor = params.get("cursor");
    return page({ height: liveHeight, anchorHeight: cursor ? 100 : liveHeight, totalRecords: cursor ? 123 : liveHeight === 100 ? 123 : 160, position: cursor ? size : 0, pageSize: size, nextCursor: `history-${size}` });
  });
  let view = harness.render(); assert.equal(view.pageSize, 50); assert.equal(view.page, 0); assert.equal(view.totalPages, 3);
  view.next(); harness.render(); await settle(); view = harness.render();
  assert.equal(view.page, 1); assert.equal(view.data.anchorHeight, 100);
  liveHeight = 110;
  const refresh = [...harness.timers.values()][0]; harness.timers.clear(); refresh.run(); await settle(); view = harness.render();
  assert.equal(view.data.height, 110); assert.equal(view.data.anchorHeight, 100); assert.equal(view.page, 1); assert.equal(view.totalPages, 3);
  view.latest(); harness.render(); await settle(); view = harness.render();
  assert.equal(view.cursor, null); assert.equal(view.page, 0); assert.equal(view.data.anchorHeight, 110); assert.equal(view.totalPages, 4);
  view.changePageSize(10); harness.render(); await settle(); view = harness.render();
  assert.equal(view.pageSize, 10); assert.equal(view.page, 0); assert.equal(view.totalPages, 16); assert.equal(view.canPrevious, false);
  assert.equal(harness.location.searchParams.get("pageSize"), "10"); assert.equal(harness.location.searchParams.has("cursor"), false);
  harness.close();
});

test("unverified latest totals retry without publishing unknown pages, while a real v2 conflict preserves its cursor", async () => {
  let calls = 0;
  const latest = await ledgerHarness("transactions", async () => {
    calls++;
    return page({ totalRecords: calls === 1 ? null : 0, position: 0, rows: [], hasMore: false, nextCursor: null });
  });
  let view = latest.render(); assert.equal(view.data, null); assert.equal(view.loading, false); assert.match(view.error, /totals.*unavailable/);
  const retry = [...latest.timers.values()][0]; assert.equal(retry.delay, 5_000); latest.timers.clear(); retry.run(); await settle(); view = latest.render();
  assert.equal(view.page, 0); assert.equal(view.totalPages, 1); assert.equal(view.data.hasMore, false); assert.equal(view.error, "");
  latest.close();
  const cursor = btoa(JSON.stringify({ version: 2, kind: "transactions", anchorHeight: 100, anchorHash: HASH, nextHeight: 99, offset: 0, totalRecords: 123, position: 50, pageSize: 50 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const url = `https://explorer.test/transactions?cursor=${cursor}&page=2&pageSize=50`;
  const conflict = await ledgerHarness("transactions", async () => { throw new Error("The selected history changed. Return to latest to continue."); }, url);
  view = conflict.render(); assert.equal(view.data, null); assert.equal(view.cursor, cursor); assert.match(view.error, /history changed/);
  assert.equal(conflict.location.href, url); assert.ok(!conflict.browserStateAccess.some((access) => access.includes("push") || access.includes("replace")));
  conflict.close();
});

test("a matching server ledger seed renders without browser APIs or effects and survives hydration preferences and background refresh", async () => {
  const seeded = page({ pageSize: 50, totalRecords: 130_563, position: 0, rows: Array.from({ length: 50 }, (_, index) => transaction(index + 1)) });
  const server = await load("../app/explorer/hooks/use-ledger-refresh.ts", ["useLedgerRefresh"], {
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
    useEffect() {}, PAGE_SIZE_OPTIONS: [5, 10, 20, 25, 50, 100],
    fetchLedgerPage() { throw new Error("SSR must use its provided real snapshot"); },
  });
  const initialRequest = { cursor: null, pageSize: 50, page: 0 };
  const rendered = server.useLedgerRefresh("transactions", { initialData: seeded, initialRequest });
  assert.equal(rendered.data, seeded); assert.equal(rendered.loading, false); assert.equal(rendered.totalPages, 2612);
  let finish;
  const hydrated = await ledgerHarness("transactions", async () => new Promise((resolve) => { finish = resolve; }), "https://explorer.test/transactions", { initialData: seeded, initialRequest }, "25");
  let view = hydrated.render();
  assert.equal(hydrated.firstRender.data, seeded); assert.equal(view.data, seeded); assert.equal(view.pageSize, 50); assert.equal(view.loading, false);
  assert.ok(!hydrated.browserStateAccess.includes("read storage"), "A prior Rows preference must not replace the SSR selection");
  finish({ ...seeded, height: 101, anchorHeight: 101, anchorHash: "b".repeat(64), totalRecords: 130_564 });
  await settle(); view = hydrated.render();
  assert.equal(view.data.height, 101); assert.equal(view.data.rows.length, 50); assert.equal(view.loading, false);
  hydrated.close();
});

test("server history seeds retain their cursor and page size while mismatched or partial seeds cannot show another page's records", async () => {
  const history = page({ pageSize: 25, position: 50, totalRecords: 123, rows: Array.from({ length: 25 }, (_, index) => transaction(index + 51, 90)) });
  const server = await load("../app/explorer/hooks/use-ledger-refresh.ts", ["useLedgerRefresh"], {
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; }, useEffect() {}, PAGE_SIZE_OPTIONS: [5, 10, 20, 25, 50, 100],
  });
  const selected = server.useLedgerRefresh("transactions", { initialData: history, initialRequest: { cursor: "history-cursor", pageSize: 25, page: 999 } });
  assert.equal(selected.data, history); assert.equal(selected.cursor, "history-cursor"); assert.equal(selected.page, 2); assert.equal(selected.totalPages, 5);
  const mismatched = server.useLedgerRefresh("transactions", { initialData: history, initialRequest: { cursor: "different-size", pageSize: 50, page: 0 } });
  assert.equal(mismatched.data, null);
  const partial = server.useLedgerRefresh("transactions", { scope: "home", initialData: { ...history, pageSize: 10, position: 0, rows: history.rows.slice(0, 3), scanLimited: true } });
  assert.equal(partial.data, null);
  const home = server.useLedgerRefresh("transactions", { scope: "home", initialData: { ...history, pageSize: 10, position: 0, rows: history.rows.slice(0, 10) } });
  assert.equal(home.data.rows.length, 10); assert.equal(home.pageSize, 10); assert.equal(home.cursor, null); assert.equal(home.loading, false);
});
