import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readProductionSource } from "./helpers/production-source.mjs";

const source = await readProductionSource(new URL("../app/explorer/snapshot-validation.ts", import.meta.url));
const compiled = ts.transpileModule(`${source}\nexport { isValidUpgradeReadiness, isValidForkArchive, isValidForkSnapshot, isValidNetworkPreview, isValidServiceNodesSnapshot };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const validationModule = { exports: {} };
vm.runInNewContext(compiled, { exports: validationModule.exports, module: validationModule, Date });
const { isValidUpgradeReadiness, isValidForkArchive, isValidForkSnapshot, isValidNetworkPreview, isValidServiceNodesSnapshot } = validationModule.exports;
const observedAt = new Date(Date.now() - 1_000).toISOString();

function readiness() {
  return {
    targetVersion: "4.0.0", eligibleTotal: 4, upgraded: 2, pending: 1, unknown: 1, percentage: 50,
    versions: [{ version: "4.0.0", count: 2 }, { version: "3.2.0", count: 1 }], scope: "registered-service-nodes",
  };
}

function archive() {
  return {
    available: true, exactClosingSnapshot: false,
    preFork: { height: 882_298, observedAt, source: "Judecoin service-node RPC", readiness: readiness() },
  };
}

function preview(height = 882_299, protocol = 16) {
  const network = {
    height, difficulty: 1, targetSeconds: 180, latestBlockTimestamp: Math.floor(Date.now() / 1000),
    hashrate: 1, hardFork: protocol, protocol: String(protocol), blockSizeMedian: 300_000, blockSizeLimit: 600_000, synced: true,
  };
  return { live: true, fetchedAt: observedAt, network };
}

function fork(height = 882_299, protocol = 16) {
  const reached = height >= 882_300;
  return {
    activationHeight: 882_300, targetProtocol: 17, targetVersion: "4.0.0", currentProtocol: protocol,
    phase: reached && protocol >= 17 ? "activated" : reached ? "unverified" : "scheduled",
    blocksRemaining: Math.max(0, 882_300 - height), blocksSinceActivation: Math.max(0, height - 882_300),
    estimatedActivationAt: reached ? null : new Date(Date.parse(observedAt) + 180_000).toISOString(), observedAt,
    activationBlock: reached ? { height: 882_300, hash: "a".repeat(64), timestamp: Math.floor(Date.now() / 1000), protocol } : null,
  };
}

function serviceSnapshot() {
  return {
    live: true, height: 882_299, fetchedAt: observedAt,
    serviceNodes: {
      total: 0, active: 0, funded: 0, exiting: 0, decommissioned: 0,
      totalContributed: 0, stakingRequirement: 0, nodes: [], awaitingNodes: [], unlockingNodes: [], decommissionedNodes: [],
    },
  };
}

test("historical client snapshots remain valid when new fork fields are absent", () => {
  assert.equal(isValidNetworkPreview(preview()), true);
  assert.equal(isValidServiceNodesSnapshot(serviceSnapshot()), true);
});

test("node readiness keeps unknown versions in denominator and verifies version distribution", () => {
  assert.equal(isValidUpgradeReadiness(readiness(), 4), true);
  assert.equal(isValidUpgradeReadiness(readiness(), 3), false);
  for (const change of [
    { percentage: 66.67 }, { upgraded: 3 }, { unknown: -1 }, { eligibleTotal: Number.MAX_SAFE_INTEGER + 1 },
    { targetVersion: "3.2.0" }, { scope: "active-service-nodes" }, { versions: null },
    { versions: [{ version: "4.0.0", count: 3 }] },
    { versions: [{ version: "4.0.0", count: 1 }, { version: "4.0.0", count: 1 }, { version: "3.2.0", count: 1 }] },
    { versions: [{ version: "0.0.0", count: 2 }, { version: "3.2.0", count: 1 }] },
    { versions: [{ version: "04.0.0", count: 2 }, { version: "3.2.0", count: 1 }] },
  ]) assert.equal(isValidUpgradeReadiness({ ...readiness(), ...change }), false, JSON.stringify(change));
});

test("empty readiness has no invented percentage and malformed optional node fields are rejected", () => {
  const snapshot = serviceSnapshot();
  const emptyReadiness = { ...readiness(), eligibleTotal: 0, upgraded: 0, pending: 0, unknown: 0, percentage: null, versions: [] };
  snapshot.serviceNodes.upgradeReadiness = emptyReadiness;
  assert.equal(isValidServiceNodesSnapshot(snapshot), true);
  assert.equal(isValidUpgradeReadiness({ ...emptyReadiness, percentage: 0 }), false);
  snapshot.serviceNodes.upgradeReadiness = readiness();
  assert.equal(isValidServiceNodesSnapshot(snapshot), false);
  delete snapshot.serviceNodes.upgradeReadiness;
  snapshot.serviceNodes.forkArchive = { available: true, preFork: { readiness: {} }, exactClosingSnapshot: false };
  assert.equal(isValidServiceNodesSnapshot(snapshot), false);
});

test("archive validation preserves genuine older observations and rejects false closing claims", () => {
  assert.equal(isValidForkArchive(archive()), true);
  assert.equal(isValidForkArchive({ available: false, preFork: null, exactClosingSnapshot: false }), true);
  assert.equal(isValidForkArchive({ ...archive(), exactClosingSnapshot: true }), false);
  const closing = archive();
  closing.preFork.height = 882_299;
  closing.exactClosingSnapshot = true;
  assert.equal(isValidForkArchive(closing), true);
  for (const height of [882_300, -1, 1.5]) {
    const invalid = archive(); invalid.preFork.height = height;
    assert.equal(isValidForkArchive(invalid), false);
  }
  for (const date of ["not-a-date", new Date(Date.now() + 120_000).toISOString()]) {
    const invalid = archive(); invalid.preFork.observedAt = date;
    assert.equal(isValidForkArchive(invalid), false);
  }
  assert.equal(isValidForkArchive({ ...archive(), available: false }), false);
  assert.equal(isValidForkArchive({ available: true, exactClosingSnapshot: false }), false);
});

test("activation requires observed target block evidence, not simply reaching height", () => {
  for (const [height, protocol] of [[882_299, 16], [882_300, 16], [882_300, 17], [882_350, 17]]) {
    const data = preview(height, protocol);
    data.network.fork = fork(height, protocol);
    assert.equal(isValidNetworkPreview(data), true);
  }
  const data = preview(882_300, 17);
  const evidence = fork(882_300, 17);
  assert.equal(isValidForkSnapshot({ ...evidence, activationBlock: null }, data.network), false);
  assert.equal(isValidForkSnapshot({ ...evidence, phase: "unverified", activationBlock: null }, data.network), true);
  for (const change of [{ hash: "invalid" }, { height: 882_301 }, { protocol: 16 }, { timestamp: 0 }]) {
    assert.equal(isValidForkSnapshot({ ...evidence, activationBlock: { ...evidence.activationBlock, ...change } }, data.network), false);
  }
});

test("malformed optional network evidence cannot pass the old network validator", () => {
  const data = preview();
  const evidence = fork();
  data.network.fork = evidence;
  assert.equal(isValidNetworkPreview(data), true);
  for (const change of [
    { phase: "activated" }, { currentProtocol: 17 }, { targetProtocol: 18 }, { activationHeight: 1 },
    { blocksRemaining: -1 }, { blocksSinceActivation: 1 }, { observedAt: "yesterday" },
    { estimatedActivationAt: "tomorrow" }, { activationBlock: {} },
  ]) assert.equal(isValidNetworkPreview({ ...data, network: { ...data.network, fork: { ...evidence, ...change } } }), false, JSON.stringify(change));
  assert.equal(isValidNetworkPreview({ ...data, network: { ...data.network, fork: null } }), false);
});
