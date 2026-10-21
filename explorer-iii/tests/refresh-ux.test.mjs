import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { readProductionSource } from "./helpers/production-source.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function loadHook(filename, exportedName, environment) {
  const source = await readFile(new URL(`../app/explorer/hooks/${filename}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => statement.getText(ast)).join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const hookModule = { exports: {} };
  vm.runInNewContext(compiled, { module: hookModule, exports: hookModule.exports,
    URLSearchParams, AbortController, ...environment });
  return hookModule.exports[exportedName];
}

function browserEnvironment() {
  const timers = new Map();
  const listeners = new Map();
  let timer = 0;
  let cleanup;
  return {
    timers,
    cleanup() { cleanup?.(); },
    environment: {
      useEffect(callback) { cleanup = callback(); },
      window: { setTimeout(callback, delay) { const id = ++timer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } },
      document: { hidden: false, addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } },
      HIDDEN_TAB_REFRESH_DELAY_MS: 30_000,
    },
  };
}

test("a failed quorum page request releases navigation loading and keeps prior records", async () => {
  const browser = browserEnvironment();
  const loading = [];
  let dataUpdates = 0;
  const hook = await loadHook("use-quorum-refresh.ts", "useQuorumRefresh", {
    ...browser.environment,
    QUORUM_REFRESH_DELAY_MS: 5_000, QUORUM_CATCH_UP_RETRY_DELAY_MS: 2_000, LIVE_REQUEST_TIMEOUT_MS: 12_000,
    async fetchExplorerJson() { throw new Error("Node temporarily unavailable"); },
  });
  hook({ serviceNodesOnly: false, statisticsOnly: false, pageSizePreferencesLoaded: true,
    quorumPage: 1, quorumPageSize: 10, highestKnownHeightRef: { current: 882000 },
    setQuorumLiveSnapshot() { dataUpdates++; }, setQuorumLoading(value) { loading.push(value); }, quorumRefreshRef: { current: null } });
  await settle();
  assert.deepEqual(loading, [false]);
  assert.equal(dataUpdates, 0, "A failed request must not clear the last verified sample");
  assert.equal([...browser.timers.values()][0].delay, 5_000);
  browser.cleanup();
});

test("Service Node failures report unavailable state without clearing data or restarting a loading cycle", async () => {
  const browser = browserEnvironment();
  const statuses = [];
  const initial = { live: true, height: 882000, fetchedAt: "2026-10-21T15:00:00Z", serviceNodes: { total: 449 } };
  let current = initial;
  const hook = await loadHook("use-service-node-refresh.ts", "useServiceNodeRefresh", {
    ...browser.environment,
    SERVICE_NODE_REFRESH_DELAY_MS: 15_000, SERVICE_NODE_CATCH_UP_RETRY_DELAY_MS: 5_000,
    SERVICE_NODE_REQUEST_TIMEOUT_MS: 45_000, TRANSACTION_POOL_REFRESH_DELAY_MS: 5_000,
    async fetch() { throw new Error("Node temporarily unavailable"); },
  });
  hook({ highestKnownHeightRef: { current: 882000 }, serviceNodeRefreshRef: { current: null },
    setServiceNodeStatus(status) { statuses.push(status); },
    setServiceNodesLive(update) { current = update(current); } });
  await settle();
  assert.deepEqual(statuses, ["offline"]);
  assert.equal(current, initial);
  assert.ok([...browser.timers.values()].some((entry) => entry.delay === 5_000));
  assert.ok(!statuses.includes("loading"));
  browser.cleanup();
});

const source = await readProductionSource(new URL("../app/explorer/components/ledger-page.tsx", import.meta.url));
const viewModule = { exports: {} };
const compiled = ts.transpileModule(`${source}\nexport { LedgerPage, BlockRecords, TransactionRecords };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(compiled, { module: viewModule, exports: viewModule.exports, require: createRequire(import.meta.url), console });
const { BlockRecords, TransactionRecords, LedgerPage } = viewModule.exports;
const hash = "a".repeat(64);

test("loaded block and transaction tables keep records visible without repeated fetching messages", () => {
  const block = { height: 882000, age: "1 min", hash, txs: 0, size: "1 KiB", difficulty: "1000", fee: 0, reward: 896, inputs: 0, outputs: 2 };
  const transaction = { block: 882000, age: "1 min", hash, size: "1 KiB", confirmations: 1, txType: "transfer", fee: 0, inputs: 1, outputs: 2 };
  const blocks = renderToStaticMarkup(React.createElement(BlockRecords, { blocks: [block], openBlock() {}, loadingMessage: "Fetching block records…" }));
  const transactions = renderToStaticMarkup(React.createElement(TransactionRecords, { transactions: [transaction], openTransaction() {}, loadingMessage: "Fetching transaction records…" }));
  for (const html of [blocks, transactions]) {
    assert.match(html, /Showing the last verified records/);
    assert.match(html, /882,000/);
    assert.doesNotMatch(html, /Fetching|class="nodes-loading/);
  }
  const empty = renderToStaticMarkup(React.createElement(BlockRecords, { blocks: [], openBlock() {}, loadingMessage: "Mainnet unavailable. Retrying…" }));
  assert.match(empty, /Mainnet unavailable/);
});

test("partial block details have a stable background-update note while verified headers stay usable", () => {
  const ledger = { data: { height: 882000, anchorHeight: 882000, rows: [{ height: 882000, hash, timestamp: 1800000000, size: 1024, difficulty: 1000, txs: 0, fee: null, reward: null, inputs: null, outputs: null }], pendingDetails: true },
    loading: false, refreshing: true, error: "Node temporarily unavailable", page: 0, totalPages: 100,
    pageSize: 10, cursor: null, canPrevious: false, next() {}, previous() {}, latest() {}, changePageSize() {} };
  const html = renderToStaticMarkup(React.createElement(LedgerPage, { ledger, blocksOnly: true, liveHeight: 882000, displayNow: 1800000020000,
    query: "", setQuery() {}, search() {}, searchLoading: false, message: "", searchRef: { current: null }, openBlock() {}, openTransaction() {} }));
  assert.match(html, /Verified block headers are shown\. Additional details update in the background/);
  assert.match(html, /Showing the last verified records/);
  assert.match(html, /Node temporarily unavailable/);
  assert.match(html, /Open block 882000/);
  assert.doesNotMatch(html, /Updating verified block details|role="alert"|Fetching block records/);
});
