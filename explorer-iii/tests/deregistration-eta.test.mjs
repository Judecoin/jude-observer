import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadModule(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(code, {
    module: testModule, exports: testModule.exports, AbortController, console, setTimeout, clearTimeout,
    require(name) {
      assert.ok(name in dependencies, `Unexpected module: ${name}`);
      return dependencies[name];
    },
    ...globals,
  });
  return testModule.exports;
}

const formatters = await loadModule("../app/explorer/formatters.ts");
const { createServiceNodeDetail } = await loadModule("../app/explorer/service-node-detail.ts", { "./formatters": formatters });
const network = {
  height: 100, targetSeconds: 180, targetVerified: true, latestBlockTimestamp: 1_800_000_000, synced: true,
};
const key = "a".repeat(64);
const deregistered = {
  publicKey: key, historical: true, registrationHeight: 80,
  unlockHeight: 110, unlockHeightVerified: true, sourceHeight: 100, contributions: 2,
};
const rows = (detail) => Object.fromEntries(detail.sections.flatMap((section) => section.rows).map((row) => [row.label, row.value]));

test("deregistered locked stake includes both remaining time and an estimated UTC expiry", () => {
  const result = rows(createServiceNodeDetail(deregistered, network, 100));
  assert.equal(result.STATUS, "Deregistered — stake locked");
  assert.equal(result["BLOCKS REMAINING"], "10");
  assert.equal(result["ESTIMATED TIME REMAINING"], "30 min");
  assert.equal(result["ESTIMATED UNLOCK TIME (UTC)"], formatters.estimatedBlockDate(100, 110, 180, network.latestBlockTimestamp));
  assert.equal(result["ESTIMATED UNLOCK TIME (UTC)"], "2027-01-15 08:30:00 UTC");
  assert.equal(formatters.utcTimestamp(0), "1970-01-01 00:00:00 UTC");
  assert.equal(formatters.utcTimestamp(1_800_000_000), "2027-01-15 08:00:00 UTC");
  const originalTimeZone = process.env.TZ;
  try {
    for (const timeZone of ["UTC", "Pacific/Honolulu", "Asia/Shanghai"]) {
      process.env.TZ = timeZone;
      assert.equal(formatters.utcTimestamp(1_800_000_000), "2027-01-15 08:00:00 UTC", timeZone);
    }
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
  for (const invalid of [NaN, Infinity, -Infinity, undefined, null, "1800000000", 8.64e12 + 1]) {
    assert.equal(formatters.utcTimestamp(invalid), "Not reported", `Invalid absolute timestamp: ${invalid}`);
  }
  const active = rows(createServiceNodeDetail({ ...deregistered, historical: false, active: true, funded: true, lastUptimeProof: 1_800_000_000 }, network, 100));
  assert.equal(active["LAST UPTIME PROOF"], "2027-01-15 08:00:00 UTC");
});

test("a newer Service Node height changes remaining blocks without mixing height and timestamp anchors", () => {
  const estimate = formatters.serviceNodeUnlockEstimate(110, network, 104);
  assert.equal(estimate.remainingBlocks, 6);
  assert.equal(estimate.wait, "18 min");
  assert.equal(estimate.date, formatters.estimatedBlockDate(100, 110, 180, network.latestBlockTimestamp));
  assert.notEqual(estimate.date, formatters.estimatedBlockDate(104, 110, 180, network.latestBlockTimestamp));
});

test("reached unlock heights have no invented future or actual release date", () => {
  const result = rows(createServiceNodeDetail(deregistered, { ...network, height: 110 }, 100));
  assert.equal(result.STATUS, "Deregistered — unlock height reached");
  assert.equal(result["STAKE STATUS"], "Unlock height reached");
  assert.ok(!("ESTIMATED UNLOCK TIME (UTC)" in result));
  const estimate = formatters.serviceNodeUnlockEstimate(110, network, 110);
  assert.equal(estimate.date, null);
  assert.equal(estimate.remainingBlocks, 0);
});

test("archived schedules do not claim that stake is currently locked or assign an expiry", () => {
  const result = rows(createServiceNodeDetail({ ...deregistered, unlockHeightVerified: false }, network, 100));
  assert.equal(result.STATUS, "Deregistered — historical record");
  assert.match(result["STAKE STATUS"], /current lock not verified/);
  assert.ok(!("ESTIMATED UNLOCK TIME (UTC)" in result));
});

test("missing or unverified protocol timing never fabricates an ETA", () => {
  for (const overrides of [
    { targetVerified: false }, { targetVerified: undefined }, { synced: false },
    { targetSeconds: 0 }, { targetSeconds: NaN }, { height: 0 }, { latestBlockTimestamp: 0 },
  ]) {
    assert.equal(formatters.serviceNodeUnlockEstimate(110, { ...network, ...overrides }), null);
    const result = rows(createServiceNodeDetail(deregistered, { ...network, ...overrides }, 100));
    assert.ok(!("ESTIMATED UNLOCK TIME (UTC)" in result));
  }
  assert.equal(formatters.serviceNodeUnlockEstimate(110, null), null);
});

test("active nodes pending voluntary unlock receive the same verified estimate", () => {
  const result = rows(createServiceNodeDetail({ ...deregistered, historical: false, active: true, funded: true }, network, 100));
  assert.equal(result.STATUS, "Pending Unlock");
  assert.equal(result["ESTIMATED TIME REMAINING"], "30 min");
});

test("a node opened before the network snapshot arrives gains its ETA after the next render", async () => {
  const state = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect() {},
    useMemo(callback) { return callback(); },
  };
  const { useDetails } = await loadModule("../app/explorer/hooks/use-details.tsx", {
    react: hooks,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "../formatters": formatters,
    "../components/shared": { TxTypeBadge() {} },
    "../service-node-detail": { createServiceNodeDetail },
    "../detail-search": { lookupPublicIdentifier() {} },
  }, {
    window: { history: { pushState() {} } },
    fetch: async () => Response.json(deregistered),
  });
  const Harness = (liveNetwork) => {
    cursor = 0;
    return useDetails({ liveNetwork, serviceNodeHeight: 0, query: "", setMessage() {}, setSearchLoading() {} });
  };
  await Harness(null).openServiceNode(key, false);
  assert.ok(!("ESTIMATED UNLOCK TIME (UTC)" in rows(Harness(null).detail)));
  const next = rows(Harness(network).detail);
  assert.equal(next["ESTIMATED TIME REMAINING"], "30 min");
  assert.ok(next["ESTIMATED UNLOCK TIME (UTC)"].endsWith(" UTC"));
});
