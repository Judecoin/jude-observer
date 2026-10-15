import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { readProductionSource } from "./helpers/production-source.mjs";

const source = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
const testModule = { exports: {} };
const compiled = ts.transpileModule(`${source}\nexport { ExplorerView, feeJude, jude, atomicJude, bytes };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiled, {
  module: testModule, exports: testModule.exports, require: createRequire(import.meta.url), console,
});
const { ExplorerView, feeJude, jude, atomicJude, bytes } = testModule.exports;
const key = "a".repeat(64);
const network = {
  height: 100, targetSeconds: 180, targetVerified: true,
  latestBlockTimestamp: 1_800_000_000, synced: true, difficulty: 1_000, hashrate: 10,
  hardFork: 16, protocol: "3", blockSizeMedian: 100, blockSizeLimit: 200,
};

function render(overrides = {}) {
  const node = { publicKey: key, registeredAt: 80, unlockedAt: 110, contributions: 1, unlockHeightVerified: true };
  return renderToStaticMarkup(React.createElement(ExplorerView, {
    particles: [], statisticsOnly: true, serviceNodesOnly: false,
    query: "", serviceNodeQuery: "", connection: "live", liveNetwork: network,
    serviceNodes: { total: 0, active: 0, funded: 0, exiting: 0, decommissioned: 0,
      totalContributed: 0, stakingRequirement: 23_600_000_000_000,
      unlockingNodes: [], decommissionedNodes: [], nodes: [] },
    blocks: [], transactions: [], homepageServiceNodes: [], awaitingServiceNodeRows: [],
    filteredServiceNodes: [], paginatedServiceNodes: [], serviceNodeHeight: 100,
    deregisteredNodes: [node], paginatedDeregisteredNodes: [node], deregisteredTotal: 1,
    deregisteredIndexedThrough: 100, deregisteredNodePage: 0, deregisteredNodeLastPage: 0,
    deregisteredNodePageSize: 20, lifecycleView: "deregistered",
    activeEnd: 0, awaitingEnd: 0, offlineEnd: 0, statusTotal: 1, currentServiceNodeTotal: 0,
    activeServiceNodes: 0, unlockingServiceNodes: 0, awaitingServiceNodes: 0,
    decommissionedServiceNodes: 0, lockedDeregisteredServiceNodeTotal: 1,
    stakingRatio: null, stakingRatioWidth: 0, minedSupply: null,
    ...overrides,
  }));
}

test("the deregistration ledger renders a visible remaining duration and UTC date", () => {
  const html = render();
  assert.match(html, /EST\. TIME LEFT/);
  assert.match(html, /EST\. UNLOCK \(UTC\)/);
  assert.match(html, /30 min/);
  assert.match(html, /10 blocks/);
  assert.match(html, /2027-01-15 08:30:00 UTC/);
  assert.doesNotMatch(html, /Invalid Date|NaN/);
});

test("the ledger labels archival schedules without presenting a current expiry", () => {
  const node = { publicKey: key, registeredAt: 80, unlockedAt: 110, contributions: 1, unlockHeightVerified: false };
  const html = render({ paginatedDeregisteredNodes: [node] });
  assert.match(html, /HISTORICAL SCHEDULE/);
  assert.match(html, /No current estimate/);
  assert.doesNotMatch(html, /2027-01-15 08:30:00 UTC/);
});


test("statistics distinguish unavailable snapshots from verified zero counts", () => {
  const unknown = render({ liveNetwork: null, serviceNodes: null, transactionPool: null, minedSupply: null });
  assert.match(unknown, /Awaiting a verified snapshot/);
  assert.doesNotMatch(unknown, />v0<|>0 B<|initial values are 0|>0\.00%<|>0\.00 kH\/s</);
  const verifiedZero = render({ transactionPool: { available: true, count: 0 }, minedSupply: 0, stakingRatio: 0 });
  assert.match(verifiedZero, /PENDING TRANSACTIONS<\/small><strong[^>]*>0<\/strong>/);
  assert.match(verifiedZero, /CURRENT SERVICE NODES<\/small><strong[^>]*>0<\/strong>/);
  assert.match(verifiedZero, /STAKING RATIO<\/small><strong[^>]*>0\.00%<\/strong>/);
});


test("mainnet amount fixtures and eight-place fees retain their established public units", () => {
  assert.equal(jude(23600000000000), "23,600");
  assert.equal(atomicJude(8960000000), "8.96");
  assert.equal(feeJude(596790), "0.00059679");
  assert.equal(feeJude(1000), "0.00000100");
  assert.equal(feeJude(0), "0.00000000");
  assert.equal(bytes(1024), "1.0 KiB");
  assert.equal(bytes(null), "Not reported");
});
