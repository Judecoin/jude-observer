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

function loadClientSnapshotHelpers(windowValue = undefined, reactHooks = {}, extraExports = [], extraGlobals = {}) {
  const instrumentedSource = `${pageSource}\nexport { ${[exportedHelpers, ...extraExports].join(", ")} };\n`;
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
    setTimeout, clearTimeout,
    ...extraGlobals,
    exports: testModule.exports,
    module: testModule,
    require(specifier) {
      if (specifier === "react") return reactHooks;
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

function createExplorerHarness({ stored = {}, browser = {}, globals = {}, route = {} } = {}) {
  const storage = new Map(Object.entries(stored));
  const state = [];
  let cursor = 0;
  let effects = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useMemo(callback) { return callback(); },
    useEffect(callback) { effects.push(callback); },
  };
  const window = { ...browser, localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  const { useExplorer } = loadClientSnapshotHelpers(window, hooks, ["useExplorer"], globals);
  const Render = () => { cursor = 0; effects = []; return useExplorer(route); };
  return { Render, getEffects: () => effects, storage };
}

function restorePageSizeSettings(stored = {}) {
  const { Render, getEffects, storage } = createExplorerHarness({ stored });
  const initial = Render();
  // Exercise the browser preference effects while leaving independent live
  // feeds idle. API, refresh, and snapshot behavior have separate tests.
  const restore = getEffects().find((effect) => effect.toString().includes("page-sizes") && effect.toString().includes("getItem"));
  assert.ok(restore, "Missing browser page-size restore effect");
  restore();
  const restored = Render();
  const persist = getEffects().find((effect) => effect.toString().includes("page-sizes") && effect.toString().includes("setItem"));
  assert.ok(persist, "Missing browser page-size persistence effect");
  persist();
  return { initial, restored, storage };
}

test("a fresh browser uses ten homepage records while retaining specialized ledger defaults", () => {
  const { initial, restored, storage } = restorePageSizeSettings();
  for (const settings of [initial, restored]) {
    assert.equal(settings.blockPageSize, 10);
    assert.equal(settings.transactionPageSize, 10);
    assert.equal(settings.homepageBlockLedger.pageSize, 10);
    assert.equal(settings.homepageTransactionLedger.pageSize, 10);
    assert.equal(settings.homepageServiceNodePageSize, 10);
    assert.equal(settings.quorumPageSize, 10);
    assert.equal(settings.serviceNodePageSize, 50);
    assert.equal(settings.deregisteredNodePageSize, 20);
  }
  assert.deepEqual(JSON.parse(storage.get("jude-explorer-page-sizes:v3")), { blocks: 10, transactions: 10, quorums: 10 });
});

test("homepage Service Node pages cover the complete live list independently and clamp an out-of-range page", () => {
  const verified = serviceNodesSnapshot();
  const nodes = Array.from({ length: 23 }, (_, index) => serviceNode(index));
  Object.assign(verified.serviceNodes, { nodes, total: 23, active: 23, funded: 23, awaitingNodes: [],
    totalContributed: nodes.reduce((sum, node) => sum + node.contributed, 0) });
  const harness = createExplorerHarness({ stored: { "judecoin:verified-service-nodes:v1": JSON.stringify(verified) } });
  harness.Render();
  const restore = harness.getEffects().find((effect) => effect.toString().includes("const restoredNetwork"));
  assert.ok(restore); restore();
  let view = harness.Render();
  const allKeys = [];
  assert.equal(view.homepageServiceNodePageSize, 10);
  assert.equal(view.homepageServiceNodeLastPage, 2);
  for (let page = 0; page < 3; page++) {
    view.setHomepageServiceNodePage(page);
    view = harness.Render();
    assert.equal(view.homepageServiceNodes.length, page === 2 ? 3 : 10);
    allKeys.push(...view.homepageServiceNodes.map((node) => node.publicKey));
    assert.equal(view.homepageBlockLedger.page, 0);
    assert.equal(view.homepageTransactionLedger.page, 0);
    assert.equal(view.serviceNodePage, 0, "The standalone Service Nodes selection stays independent");
  }
  assert.deepEqual([...allKeys].sort(), nodes.map((node) => node.publicKey).sort());
  view.setHomepageServiceNodePageSize(20); view.setHomepageServiceNodePage(0);
  view = harness.Render();
  assert.equal(view.homepageServiceNodes.length, 20);
  assert.equal(view.homepageServiceNodeLastPage, 1);
  view.setHomepageServiceNodePage(4); harness.Render();
  const clamp = harness.getEffects().find((effect) => effect.toString().includes("homepageServiceNodePage > homepageServiceNodeLastPage"));
  assert.ok(clamp); clamp();
  view = harness.Render();
  assert.equal(view.homepageServiceNodePage, 1);
  assert.equal(view.homepageServiceNodes.length, 3);
});

test("the redesigned homepage replaces the old automatic five-row preference", () => {
  const oldPreference = JSON.stringify({ blocks: 5, transactions: 5, quorums: 5 });
  for (const oldKey of ["jude-explorer-page-sizes", "jude-explorer-page-sizes:v2"]) {
    const { restored, storage } = restorePageSizeSettings({ [oldKey]: oldPreference });
    assert.equal(restored.blockPageSize, 10);
    assert.equal(restored.transactionPageSize, 10);
    assert.equal(restored.quorumPageSize, 10);
    assert.equal(storage.get(oldKey), oldPreference);
    assert.deepEqual(JSON.parse(storage.get("jude-explorer-page-sizes:v3")), { blocks: 10, transactions: 10, quorums: 10 });
  }
});

test("manual current-version page sizes persist and invalid values return to ten", () => {
  const current = { blocks: 25, transactions: 5, quorums: 20 };
  const { restored, storage } = restorePageSizeSettings({ "jude-explorer-page-sizes:v3": JSON.stringify(current) });
  assert.equal(restored.blockPageSize, 25);
  assert.equal(restored.transactionPageSize, 5);
  assert.equal(restored.quorumPageSize, 20);
  assert.deepEqual(JSON.parse(storage.get("jude-explorer-page-sizes:v3")), current);
  for (const badPreference of ["invalid JSON", JSON.stringify({ blocks: 0, transactions: -1, quorums: 8 })]) {
    const { restored: fallback } = restorePageSizeSettings({ "jude-explorer-page-sizes:v3": badPreference });
    assert.equal(fallback.blockPageSize, 10);
    assert.equal(fallback.transactionPageSize, 10);
    assert.equal(fallback.quorumPageSize, 10);
  }
});

const selectedBlock = {
  hash: "a".repeat(64), timestamp: 1_750_000_000, orphan: false, transactions: 0,
  size: 200, difficulty: 1_000, majorVersion: 16, minorVersion: 0,
  confirmations: 1, reward: 10, minerTransaction: {
    hash: "b".repeat(64), version: 2, size: 100, ringCtType: 0,
    unlockHeight: 0, outputs: [], raw: {},
  },
};

function detailNavigationHarness(fetch, route = {}, reduceMotion = false) {
  const actions = [];
  const location = { hash: "", assign: (url) => {
    assert.equal(harness.Render().detail, null);
    assert.equal(harness.Render().detailPending, null);
    actions.push({ action: "assign", url });
  } };
  const history = {
    pushState(_state, _unused, hash) { location.hash = hash; },
    replaceState(_state, _unused, hash) { location.hash = hash; actions.push({ action: "history", hash }); },
  };
  const document = { getElementById(id) {
    return { scrollIntoView(options) {
      const current = harness.Render();
      assert.equal(current.detail, null, "Resolved detail must close before target scroll");
      assert.equal(current.detailPending, null, "Pending detail must close before target scroll");
      actions.push({ action: "scroll", id, behavior: options.behavior, block: options.block });
    } };
  } };
  const harness = createExplorerHarness({
    browser: { location, history, matchMedia(query) {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return { matches: reduceMotion };
    } }, globals: { AbortController, fetch, document }, route,
  });
  return { ...harness, actions, location };
}

test("a homepage shortcut closes resolved details before scrolling and respects reduced motion", async () => {
  for (const reduceMotion of [false, true]) {
    const { Render, actions, location } = detailNavigationHarness(async () => ({ ok: true, json: async () => selectedBlock }), {}, reduceMotion);
    await Render().openBlock(123);
    assert.equal(Render().detail.title, "Block Details");
    Render().openSection("transactions");
    assert.equal(Render().detail, null);
    assert.equal(location.hash, "#transactions");
    assert.deepEqual(actions.filter((entry) => entry.action === "scroll"), [{ action: "scroll", id: "transactions", behavior: reduceMotion ? "auto" : "smooth", block: "start" }]);
  }
});

test("a navigation shortcut cancels pending details and a late read cannot reopen the overlay", async () => {
  let finishRead;
  let signal;
  const { Render, actions, location } = detailNavigationHarness((_url, options) => {
    signal = options.signal;
    return new Promise((resolve) => { finishRead = resolve; });
  });
  const pendingRead = Render().openBlock(123);
  assert.equal(Render().detailPending.title, "Block Details");
  assert.equal(signal.aborted, false);
  Render().openSection("quorums");
  assert.equal(signal.aborted, true);
  assert.equal(Render().detailPending, null);
  assert.equal(location.hash, "#quorums");
  assert.ok(actions.some((entry) => entry.action === "scroll" && entry.id === "quorums"));
  finishRead({ ok: true, json: async () => selectedBlock });
  await pendingRead;
  assert.equal(Render().detail, null);
  assert.equal(Render().detailPending, null);
});

test("navigation shortcuts from Service Nodes and Statistics close details before returning to the home section", async () => {
  for (const route of [{ serviceNodesOnly: true }, { statisticsOnly: true }]) {
    const { Render, actions } = detailNavigationHarness(async () => ({ ok: true, json: async () => selectedBlock }), route);
    await Render().openBlock(123);
    assert.equal(Render().detail.title, "Block Details");
    Render().openSection("blocks");
    assert.equal(Render().detail, null);
    assert.deepEqual(actions.filter((entry) => entry.action === "assign"), [{ action: "assign", url: "/#blocks" }]);
    assert.equal(actions.filter((entry) => entry.action === "scroll").length, 0);
  }
});

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

test("decoded details replace a same-height header preview regardless of completion timestamps", () => {
  const { rememberChainSnapshot } = loadClientSnapshotHelpers();
  const overview = { ...chainSnapshot({ fetchedAt: "2026-09-20T12:02:00.000Z" }), pendingDetails: true };
  const full = chainSnapshot({ fetchedAt: "2026-09-20T12:01:00.000Z" });
  assert.equal(rememberChainSnapshot(overview), overview);
  assert.equal(rememberChainSnapshot(full), full);
  const lateOverview = { ...overview, fetchedAt: "2026-09-20T12:03:00.000Z" };
  assert.equal(rememberChainSnapshot(lateOverview), full);
});

test("a late header overview preserves any same-height decoded data even when some other details failed", () => {
  const { rememberChainSnapshot } = loadClientSnapshotHelpers();
  const partial = { ...chainSnapshot({ fetchedAt: "2026-09-20T12:01:00.000Z" }), pendingDetails: true };
  const overview = { ...chainSnapshot({ fetchedAt: "2026-09-20T12:02:00.000Z" }), pendingDetails: true, headerOnly: true };
  assert.equal(rememberChainSnapshot(partial), partial);
  assert.equal(rememberChainSnapshot(overview), partial);
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

test("browser Back cancels a pending detail read and its late body cannot reopen the listing overlay", async () => {
  const listeners = new Map();
  let finish, signal;
  const location = { hash: "" };
  const harness = createExplorerHarness({
    browser: { location, history: { state: { ledger: { cursor: "pinned" } }, pushState(_state, _unused, hash) { location.hash = hash; } },
      addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } },
    globals: { AbortController, fetch: async (_url, options) => { signal = options.signal; return { ok: true, json: () => new Promise((resolve) => { finish = resolve; }) }; } },
  });
  harness.Render();
  const subscribe = harness.getEffects().find((effect) => effect.toString().includes("const openHashTarget"));
  assert.ok(subscribe);
  const cleanup = subscribe();
  const pending = harness.Render().openBlock(123);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.Render().detailPending.kind, "block");
  location.hash = "";
  listeners.get("popstate")();
  assert.equal(signal.aborted, true);
  assert.equal(harness.Render().detailPending, null);
  finish(selectedBlock);
  await pending;
  assert.equal(harness.Render().detail, null);
  cleanup();
});

test("SSR bootstrap exposes all available feeds before effects and keeps hydration ages and page-size selections stable", () => {
  const renderedAt = Date.parse("2026-10-15T08:00:00Z");
  let currentTime = renderedAt + 120_000;
  class ClientClock extends Date { static now() { return currentTime; } }
  const fetchedAt = new Date(renderedAt).toISOString();
  const height = 867_200;
  const timestamp = renderedAt / 1000 - 90;
  const chain = chainSnapshot({ height, fetchedAt, pageSize: 10, transactionScanSize: 320, quorumPageSize: 10 });
  chain.blocks = Array.from({ length: 10 }, (_, index) => ({ height: height - index, timestamp: timestamp - index * 180, hash: (index + 1).toString(16).padStart(64, "0"), txs: 0, size: 100, difficulty: 100, fee: 0, reward: 896, inputs: 0, outputs: 2 }));
  chain.transactions = Array.from({ length: 10 }, (_, index) => ({ hash: (index + 100).toString(16).padStart(64, "0"), block: height - index, timestamp: timestamp - index * 180, size: 100, confirmations: index + 1, fee: 0, reward: 0, inputs: 1, outputs: 1, txType: "transfer" }));
  const ledger = { live: true, fetchedAt, source: "Judecoin mainnet", node: "seed", height, anchorHeight: height, anchorHash: chain.blocks[0].hash, pageSize: 10, nextCursor: "next", hasMore: true, scanLimited: false, scannedBlocks: 10, position: 0 };
  const quorums = { ...chain.quorums, live: true, trusted: true, fetchedAt, height, records: [{ height, validators: ["a".repeat(64)], workers: ["b".repeat(64)] }] };
  const initialData = { renderedAt, chain, network: { live: true, fetchedAt, source: "Judecoin mainnet", node: "seed", network: chain.network }, serviceNodes: serviceNodesSnapshot({ height, fetchedAt }), quorums,
    transactionPool: { available: true, count: 1, totalBytes: 100, transactions: [{ hash: "c".repeat(64), receivedAt: timestamp, txType: "transfer", fee: 0, size: 100, inputs: 1, outputs: 1 }] },
    blocks: { ...ledger, rows: chain.blocks, totalRecords: height + 1 }, transactions: { ...ledger, rows: chain.transactions, totalRecords: 130_563 }, ledgerRequest: null };
  const storedPreference = JSON.stringify({ blocks: 25, transactions: 25, quorums: 25 });
  const harness = createExplorerHarness({ route: { initialData }, stored: { "jude-explorer-page-sizes:v3": storedPreference }, globals: { Date: ClientClock } });
  const first = harness.Render();
  assert.equal(first.connection, "live"); assert.equal(first.liveNetwork.height, height); assert.equal(first.snapshot, chain);
  assert.equal(first.homepageBlocks.length, 10); assert.equal(first.homepageTransactions.length, 10); assert.equal(first.homepageServiceNodes.length, 2);
  assert.equal(first.latestQuorum.height, height); assert.equal(first.transactionPool.count, 1);
  assert.equal(first.homepageBlockLedger.loading, false); assert.equal(first.homepageTransactionLedger.loading, false);
  assert.equal(first.homepageBlocks[0].age, "00:01:30"); assert.equal(first.displayNow, renderedAt);
  currentTime = renderedAt + 300_000;
  const hydration = harness.Render();
  assert.equal(hydration.homepageBlocks[0].age, first.homepageBlocks[0].age);
  const preferences = harness.getEffects().find((effect) => effect.toString().includes("page-sizes") && effect.toString().includes("getItem"));
  preferences();
  harness.Render();
  const persist = harness.getEffects().find((effect) => effect.toString().includes("page-sizes") && effect.toString().includes("setItem"));
  persist();
  assert.equal(harness.Render().quorumPageSize, 10); assert.equal(harness.Render().latestQuorum.height, height);
  assert.equal(harness.storage.get("jude-explorer-page-sizes:v3"), storedPreference);
  const mounted = harness.getEffects().find((effect) => effect.toString().includes("setHydrated(true)"));
  mounted();
  const live = harness.Render(); assert.equal(live.displayNow, currentTime); assert.equal(live.homepageBlocks[0].age, "00:06:30");
  assert.equal(live.homepageBlockLedger.data.rows.length, 10);
});

test("overview-only homepage chart refresh keeps SSR rows visible and never starts a full chain request", async () => {
  const calls = [], timers = new Map(), cleanups = [];
  let timerId = 0;
  let current = chainSnapshot({ height: 100, pageSize: 10, transactionScanSize: 320 });
  let nextHeight = 101;
  const functions = loadClientSnapshotHelpers({ localStorage: { getItem() { return null; }, setItem() {} }, setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } }, {
    useEffect(run) { cleanups.push(run()); },
  }, ["useChainRefresh"], { URLSearchParams, AbortController,
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    fetch: async (url) => { calls.push(url); return Response.json({ ...chainSnapshot({ height: nextHeight, pageSize: 10, transactionScanSize: 320 }), pendingDetails: true, headerOnly: true }); } });
  functions.useChainRefresh({ serviceNodesOnly: false, pageSizePreferencesLoaded: true, overviewOnly: true, successPollDelayMs: 30_000,
    highestKnownHeightRef: { current: 100 }, snapshot: current, knownChainHeight: 100, blockPage: 0, transactionPage: 0, blockPageSize: 10, transactionPageSize: 10,
    snapshotParams(_overrides, tip) { return new URLSearchParams({ blockPageSize: "10", transactionPageSize: "10", tip: String(tip) }); },
    setSnapshot(update) { current = update(current); }, setServiceNodesLive() {}, setConnection() {},
  });
  assert.equal(current.network.height, 100, "The initial real snapshot remains available during background reads");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.network.height, 101); assert.equal(calls.length, 1); assert.ok(calls[0].includes("overview=1"));
  const scheduled = [...timers.values()]; assert.equal(scheduled.length, 1); assert.equal(scheduled[0].delay, 30_000);
  timers.clear(); nextHeight = 102; scheduled[0].callback();
  assert.equal(current.network.height, 101);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.network.height, 102); assert.equal(calls.length, 2); assert.ok(calls.every((url) => url.includes("overview=1")));
  for (const cleanup of cleanups) cleanup?.();
});
