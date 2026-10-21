import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { readProductionSource } from "./helpers/production-source.mjs";

const source = await readProductionSource(new URL("../app/explorer/components/fork-monitor.tsx", import.meta.url));
const testModule = { exports: {} };
const compiled = ts.transpileModule(`${source}\nexport { ForkMonitor, forkDuration, upgradeVersionStatus };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiled, { module: testModule, exports: testModule.exports, require: createRequire(import.meta.url), console });
const { ForkMonitor, forkDuration, upgradeVersionStatus } = testModule.exports;
const now = Date.parse("2026-10-21T15:00:00Z");
const readiness = { targetVersion: "4.0.0", eligibleTotal: 449, upgraded: 441, pending: 7, unknown: 1, percentage: 98.22,
  versions: [{ version: "4.0.0", count: 441 }, { version: "3.2.0", count: 7 }], scope: "registered-service-nodes" };
const scheduled = { activationHeight: 882300, targetProtocol: 17, targetVersion: "4.0.0", currentProtocol: 16,
  phase: "scheduled", blocksRemaining: 100, blocksSinceActivation: 0, observedAt: new Date(now).toISOString(), activationBlock: null };

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(ForkMonitor, {
    network: { height: 882200, hardFork: 16, targetSeconds: 180, targetVerified: true, latestBlockTimestamp: now / 1000 - 20, fork: scheduled },
    serviceNodes: { upgradeReadiness: readiness, total: 449, nodes: [] },
    observedAt: new Date(now).toISOString(), observationHeight: 882198,
    connection: "live", displayNow: now, openBlock() {}, openServiceNode() {}, ...overrides,
  }));
}

test("scheduled fork displays height, independently timed node support, and no activation claim", () => {
  const html = render();
  assert.match(html, /882,300/);
  assert.match(html, /98\.22/);
  assert.match(html, /5h 0m/);
  assert.match(html, /NODE DATA · #882,198/);
  assert.match(html, /Unknown version/);
  assert.doesNotMatch(html, /Pure PoS activated|100% success|Final voting result/);
});

test("post-fork activation waits for actual protocol evidence rather than height alone", () => {
  const network = { height: 882301, hardFork: 16, targetSeconds: 180, fork: { ...scheduled, phase: "unverified", blocksRemaining: 0 } };
  const html = render({ network });
  assert.match(html, /Verifying protocol activation/);
  assert.match(html, /Activation evidence pending/);
  assert.doesNotMatch(html, /Pure PoS activated|Protocol v17 observed/);
});

test("live adoption and saved pre-fork observations remain visibly separate after activation", () => {
  const network = { height: 882310, hardFork: 17, targetSeconds: 180, latestBlockTimestamp: now / 1000,
    fork: { ...scheduled, currentProtocol: 17, phase: "activated", activationBlock: { height: 882300, timestamp: now / 1000 - 1800, hash: "a".repeat(64), protocol: 17 } } };
  const html = render({ network, serviceNodes: { total: 449, nodes: [], upgradeReadiness: { ...readiness, upgraded: 449, pending: 0, unknown: 0, percentage: 100 },
    forkArchive: { available: true, exactClosingSnapshot: true, preFork: { height: 882299, observedAt: new Date(now - 3600000).toISOString(), source: "RPC", readiness } } } });
  assert.match(html, /Pure PoS activated/);
  assert.match(html, /Protocol v17 observed/);
  assert.match(html, /100\.00/);
  assert.match(html, /CURRENT NODE UPGRADE RATE/);
  assert.match(html, /Latest block age/);
  assert.ok(html.indexOf("ON-CHAIN RESULT") < html.indexOf("CURRENT NODE UPGRADE RATE"));
  assert.match(html, /98\.22% · 441 \/ 449 nodes/);
  assert.match(html, /Last pre-fork block observation/);
  assert.doesNotMatch(html, /Final voting result|100% success/);
});

test("missing or stale data never displays a fabricated zero-percent tally or countdown", () => {
  const empty = render({ network: null, serviceNodes: null, observedAt: null });
  assert.match(empty, /Awaiting chain data/);
  assert.doesNotMatch(empty, /0\.00|NaN|Invalid Date/);
  const stale = render({ connection: "offline" });
  assert.match(stale, /Last verified/);
  assert.match(stale, /Awaiting estimate/);
});

test("version classification and duration formatting handle malformed and future releases", () => {
  assert.equal(upgradeVersionStatus("4.0.0"), "upgraded");
  assert.equal(upgradeVersionStatus("4.1.0"), "upgraded");
  assert.equal(upgradeVersionStatus("5.0.0"), "upgraded");
  assert.equal(upgradeVersionStatus("3.2.0"), "pending");
  assert.equal(upgradeVersionStatus("0.0.0"), "unknown");
  assert.equal(upgradeVersionStatus("4"), "unknown");
  assert.equal(forkDuration(null), "Awaiting estimate");
  assert.equal(forkDuration(1), "Under 1 min");
  assert.equal(forkDuration(86400), "1d 0h");
});

test("homepage summary keeps activation data and links to statistics without repeating node controls", () => {
  const html = render({ summaryOnly: true });
  assert.match(html, /882,300/);
  assert.match(html, /98\.22/);
  assert.match(html, /href="\/statistics#network-upgrade"/);
  assert.doesNotMatch(html, /Needs attention|Export record|fork-node-table|How this is measured/);
});
