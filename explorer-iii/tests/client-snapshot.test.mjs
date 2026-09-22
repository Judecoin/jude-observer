import { readProductionSource } from "./helpers/production-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const pageSource = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
const exportedHelpers = [
  "sameChainSelection",
  "isValidChainSnapshot",
  "isValidServiceNodesSnapshot",
  "isProvisionalSnapshot",
  "readClientSnapshot",
  "rememberChainSnapshot",
  "rememberServiceNodesSnapshot",
].join(", ");

function loadClientSnapshotHelpers(windowValue = undefined) {
  const instrumentedSource = `${pageSource}\nexport { ${exportedHelpers} };\n`;
  const compiled = ts.transpileModule(instrumentedSource, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "app/page.tsx",
  }).outputText;
  const testModule = { exports: {} };
  const context = {
    console,
    exports: testModule.exports,
    module: testModule,
    require(specifier) {
      if (specifier === "react") return {};
      if (specifier === "react/jsx-runtime") {
        return { Fragment: Symbol("Fragment"), jsx() {}, jsxs() {} };
      }
      throw new Error(`Unexpected test import: ${specifier}`);
    },
  };
  if (windowValue !== undefined) context.window = windowValue;
  vm.runInNewContext(compiled, context, { filename: "app/page.compiled.cjs" });
  return testModule.exports;
}

function serviceNode(index, { active = true, funded = true } = {}) {
  return {
    publicKey: `node-${index}`,
    active,
    funded,
    contributed: funded ? 23_600_000_000_000 : 5_900_000_000_000,
    requirement: 23_600_000_000_000,
    registeredAt: 800_000 + index,
    lastRewardAt: 860_000 + index,
    lastUptimeProof: 1_750_000_000 + index,
    version: "3.2.0",
    unlocking: false,
    unlockAt: 0,
    contributors: 1,
    maxContributors: 9,
    operatorFee: 10,
  };
}

function serviceNodesSnapshot({
  height = 867_200,
  fetchedAt = new Date(Date.now() - 1_000).toISOString(),
} = {}) {
  const nodes = [
    serviceNode(1),
    serviceNode(2, { active: false, funded: false }),
  ];
  return {
    live: true,
    height,
    fetchedAt,
    serviceNodes: {
      total: 2,
      active: 1,
      funded: 1,
      exiting: 0,
      decommissioned: 0,
      stakingRequirement: 23_600_000_000_000,
      totalContributed: 29_500_000_000_000,
      page: 0,
      pageSize: 2,
      awaitingNodes: [{
        publicKey: "node-2",
        contributors: 1,
        maxContributors: 9,
        contributed: 5_900_000_000_000,
        requirement: 23_600_000_000_000,
        contributionRequired: 17_700_000_000_000,
        contributionOpen: 17_700_000_000_000,
        reservedRemaining: 0,
        registeredAt: 800_002,
        lastRewardAt: 860_002,
        unlockAt: 0,
      }],
      nodes,
      unlockingNodes: [],
      decommissionedNodes: [],
    },
  };
}

function chainSnapshot({
  height = 867_200,
  fetchedAt = new Date(Date.now() - 1_000).toISOString(),
  blockPage = 0,
  transactionPage = 0,
  pageSize = 5,
  transactionScanSize = 160,
  quorumPage = 0,
  quorumPageSize = 5,
} = {}) {
  const serviceSnapshot = serviceNodesSnapshot({ height, fetchedAt });
  return {
    live: true,
    source: "test",
    node: "test-node",
    fetchedAt,
    network: {
      height,
      difficulty: 1_000_000,
      targetSeconds: 180,
      hashrate: 5_555,
      hardFork: 16,
      protocol: "3",
      blockSizeMedian: 300_000,
      blockSizeLimit: 600_000,
      latestBlockTimestamp: Math.floor(Date.now() / 1_000),
      synced: true,
    },
    blocks: [],
    transactions: [],
    transactionPool: { available: true, count: 0, totalBytes: 0, transactions: [] },
    pagination: { blockPage, transactionPage, pageSize, transactionScanSize },
    serviceNodesHeight: height,
    serviceNodes: serviceSnapshot.serviceNodes,
    quorums: {
      source: "test",
      type: "Service Node testing",
      quorumType: 0,
      trusted: true,
      page: quorumPage,
      pageSize: quorumPageSize,
      hasOlder: true,
      truncated: false,
      records: [],
      unavailable: [],
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("same chain selection keeps the newer verified snapshot", () => {
  const { rememberChainSnapshot, sameChainSelection } = loadClientSnapshotHelpers();
  const newer = chainSnapshot({ height: 867_220, fetchedAt: "2026-09-20T12:02:00.000Z" });
  const older = chainSnapshot({ height: 867_210, fetchedAt: "2026-09-20T12:01:00.000Z" });

  assert.equal(sameChainSelection(newer, older), true);
  assert.equal(rememberChainSnapshot(newer).network.height, 867_220);
  const retained = rememberChainSnapshot(older);
  assert.equal(retained.network.height, 867_220);
  assert.equal(retained.fetchedAt, newer.fetchedAt);
});

test("a different chain selection is accepted without returning rows from the old page", () => {
  const { rememberChainSnapshot, sameChainSelection } = loadClientSnapshotHelpers();
  const firstPage = chainSnapshot({ height: 867_220, blockPage: 0 });
  const secondPage = chainSnapshot({
    height: 867_210,
    fetchedAt: "2026-09-20T12:01:00.000Z",
    blockPage: 1,
  });

  assert.equal(rememberChainSnapshot(firstPage).pagination.blockPage, 0);
  assert.equal(sameChainSelection(firstPage, secondPage), false);
  const accepted = rememberChainSnapshot(secondPage);
  assert.equal(accepted.pagination.blockPage, 1);
  assert.equal(accepted.network.height, 867_210);

  const changedTransactionPage = chainSnapshot({ transactionPage: 1 });
  const changedQuorumPage = chainSnapshot({ quorumPage: 1 });
  assert.equal(sameChainSelection(firstPage, changedTransactionPage), false);
  assert.equal(sameChainSelection(firstPage, changedQuorumPage), false);
});

test("Service Node snapshot validation enforces totals and derived counts", () => {
  const { isValidServiceNodesSnapshot } = loadClientSnapshotHelpers();
  const valid = serviceNodesSnapshot();
  assert.equal(isValidServiceNodesSnapshot(valid), true);

  const wrongTotal = clone(valid);
  wrongTotal.serviceNodes.total = 3;
  assert.equal(isValidServiceNodesSnapshot(wrongTotal), false);

  const wrongActive = clone(valid);
  wrongActive.serviceNodes.active = 2;
  assert.equal(isValidServiceNodesSnapshot(wrongActive), false);

  const wrongFunded = clone(valid);
  wrongFunded.serviceNodes.funded = 2;
  assert.equal(isValidServiceNodesSnapshot(wrongFunded), false);

  const wrongAwaiting = clone(valid);
  wrongAwaiting.serviceNodes.awaitingNodes = [];
  assert.equal(isValidServiceNodesSnapshot(wrongAwaiting), false);

  const wrongExiting = clone(valid);
  wrongExiting.serviceNodes.exiting = 1;
  assert.equal(isValidServiceNodesSnapshot(wrongExiting), false);

  const wrongDecommissioned = clone(valid);
  wrongDecommissioned.serviceNodes.decommissioned = 1;
  assert.equal(isValidServiceNodesSnapshot(wrongDecommissioned), false);

  const duplicateKeys = clone(valid);
  duplicateKeys.serviceNodes.nodes[1].publicKey = duplicateKeys.serviceNodes.nodes[0].publicKey;
  assert.equal(isValidServiceNodesSnapshot(duplicateKeys), false);
});

test("Service Node snapshot validation rejects malformed node and awaiting rows", () => {
  const { isValidServiceNodesSnapshot } = loadClientSnapshotHelpers();
  const valid = serviceNodesSnapshot();

  const missingNodeField = clone(valid);
  delete missingNodeField.serviceNodes.nodes[0].version;
  assert.equal(isValidServiceNodesSnapshot(missingNodeField), false);

  const invalidNodeInteger = clone(valid);
  invalidNodeInteger.serviceNodes.nodes[0].lastUptimeProof = -1;
  assert.equal(isValidServiceNodesSnapshot(invalidNodeInteger), false);

  const incompleteAwaitingRow = clone(valid);
  delete incompleteAwaitingRow.serviceNodes.awaitingNodes[0].contributionRequired;
  assert.equal(isValidServiceNodesSnapshot(incompleteAwaitingRow), false);
});

test("an older Service Node snapshot cannot replace a newer verified snapshot", () => {
  const { rememberServiceNodesSnapshot } = loadClientSnapshotHelpers();
  const newer = serviceNodesSnapshot({ height: 867_220, fetchedAt: "2026-09-20T12:02:00.000Z" });
  const olderHeight = serviceNodesSnapshot({ height: 867_219, fetchedAt: "2026-09-20T12:03:00.000Z" });
  const olderAtSameHeight = serviceNodesSnapshot({ height: 867_220, fetchedAt: "2026-09-20T12:01:00.000Z" });

  assert.equal(rememberServiceNodesSnapshot(newer).height, 867_220);
  assert.equal(rememberServiceNodesSnapshot(olderHeight).fetchedAt, newer.fetchedAt);
  assert.equal(rememberServiceNodesSnapshot(olderAtSameHeight).fetchedAt, newer.fetchedAt);
});

test("reading malformed or blocked localStorage never throws", () => {
  const malformedWindow = { localStorage: { getItem: () => "{not-json" } };
  const malformedHelpers = loadClientSnapshotHelpers(malformedWindow);
  assert.doesNotThrow(() => malformedHelpers.readClientSnapshot("snapshot", malformedHelpers.isValidServiceNodesSnapshot));
  assert.equal(malformedHelpers.readClientSnapshot("snapshot", malformedHelpers.isValidServiceNodesSnapshot), null);

  const blockedWindow = { localStorage: { getItem() { throw new Error("SecurityError"); } } };
  const blockedHelpers = loadClientSnapshotHelpers(blockedWindow);
  assert.doesNotThrow(() => blockedHelpers.readClientSnapshot("snapshot", blockedHelpers.isValidServiceNodesSnapshot));
  assert.equal(blockedHelpers.readClientSnapshot("snapshot", blockedHelpers.isValidServiceNodesSnapshot), null);
});

test("client restore accepts only a fully valid Service Node object", () => {
  const valid = serviceNodesSnapshot();
  const invalid = clone(valid);
  invalid.serviceNodes.nodes.pop();
  const storageValues = new Map([
    ["valid", JSON.stringify(valid)],
    ["invalid", JSON.stringify(invalid)],
    ["wrong-kind", JSON.stringify(chainSnapshot())],
  ]);
  const windowValue = { localStorage: { getItem: (key) => storageValues.get(key) ?? null } };
  const { isValidServiceNodesSnapshot, readClientSnapshot } = loadClientSnapshotHelpers(windowValue);

  const restored = readClientSnapshot("valid", isValidServiceNodesSnapshot);
  assert.ok(restored);
  assert.equal(restored.height, valid.height);
  assert.equal(restored.serviceNodes.nodes.length, 2);
  assert.equal(readClientSnapshot("invalid", isValidServiceNodesSnapshot), null);
  assert.equal(readClientSnapshot("wrong-kind", isValidServiceNodesSnapshot), null);
  assert.equal(readClientSnapshot("missing", isValidServiceNodesSnapshot), null);
});

test("client restore rejects a snapshot older than six hours", () => {
  const expired = serviceNodesSnapshot({
    fetchedAt: new Date(Date.now() - 6 * 60 * 60 * 1_000 - 5_000).toISOString(),
  });
  const windowValue = { localStorage: { getItem: () => JSON.stringify(expired) } };
  const { isValidServiceNodesSnapshot, readClientSnapshot } = loadClientSnapshotHelpers(windowValue);

  assert.equal(isValidServiceNodesSnapshot(expired), true);
  assert.equal(readClientSnapshot("expired", isValidServiceNodesSnapshot), null);
});

test("client restore rejects a snapshot more than one minute in the future", () => {
  const future = serviceNodesSnapshot({
    fetchedAt: new Date(Date.now() + 60_000 + 5_000).toISOString(),
  });
  const windowValue = { localStorage: { getItem: () => JSON.stringify(future) } };
  const { isValidServiceNodesSnapshot, readClientSnapshot } = loadClientSnapshotHelpers(windowValue);

  assert.equal(isValidServiceNodesSnapshot(future), true);
  assert.equal(readClientSnapshot("future", isValidServiceNodesSnapshot), null);
});

test("client restore rejects a snapshot above the maximum chain height", () => {
  const tooHigh = serviceNodesSnapshot({ height: 100_000_001 });
  const windowValue = { localStorage: { getItem: () => JSON.stringify(tooHigh) } };
  const { isValidServiceNodesSnapshot, readClientSnapshot } = loadClientSnapshotHelpers(windowValue);

  assert.equal(isValidServiceNodesSnapshot(tooHigh), true);
  assert.equal(readClientSnapshot("too-high", isValidServiceNodesSnapshot), null);
});

test("a provisional high cached height cannot poison the first normal live RPC snapshot", () => {
  const cached = serviceNodesSnapshot({
    height: 99_999_999,
    fetchedAt: new Date(Date.now() - 1_000).toISOString(),
  });
  const windowValue = {
    localStorage: {
      getItem: () => JSON.stringify(cached),
      setItem() {},
    },
  };
  const {
    isProvisionalSnapshot,
    isValidServiceNodesSnapshot,
    readClientSnapshot,
    rememberServiceNodesSnapshot,
  } = loadClientSnapshotHelpers(windowValue);
  const restored = readClientSnapshot("poison", isValidServiceNodesSnapshot);
  assert.ok(restored);
  assert.equal(restored.height, 99_999_999);
  assert.equal(isProvisionalSnapshot(restored), true);



  assert.equal(rememberServiceNodesSnapshot(restored), restored);
  const live = serviceNodesSnapshot({
    height: 867_250,
    fetchedAt: new Date().toISOString(),
  });
  const accepted = rememberServiceNodesSnapshot(live);
  assert.equal(isProvisionalSnapshot(live), false);
  assert.equal(accepted, live);
  assert.equal(accepted.height, 867_250);
});
