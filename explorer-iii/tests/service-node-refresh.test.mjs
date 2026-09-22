import { readProductionSource } from "./helpers/production-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
const ast = ts.createSourceFile("app/page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helperNames = new Set([
  "isNonNegativeInteger", "isValidServiceNodesSnapshot", "isProvisionalSnapshot",
  "isNewerHeightSnapshot", "rememberServiceNodesSnapshot",
]);
const constantNames = new Set([
  "SERVICE_NODE_REFRESH_DELAY_MS", "SERVICE_NODE_CATCH_UP_RETRY_DELAY_MS",
  "SERVICE_NODE_REQUEST_TIMEOUT_MS", "HIDDEN_TAB_REFRESH_DELAY_MS",
  "TRANSACTION_POOL_REFRESH_DELAY_MS", "CLIENT_SERVICE_NODES_SNAPSHOT_KEY",
]);
const declarations = [];
let effectSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text)) declarations.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && constantNames.has(node.name.getText(ast))) {
    declarations.push(`const ${node.getText(ast)};`);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("const refreshServiceNodes =")) {
    effectSource = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effectSource, "Exercise the production Service Node refresh effect");
const compiled = ts.transpileModule(`
  ${declarations.join("\n")}
  const provisionalClientSnapshots = new WeakSet();
  let lastVerifiedServiceNodesSnapshot = null;
  globalThis.cleanup = (${effectSource})();
`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function snapshot(height, total, fetchedAt) {
  const nodes = Array.from({ length: total }, (_, index) => ({
    publicKey: index.toString(16).padStart(64, "0"), active: true, funded: true,
    contributed: 23_600_000_000_000, requirement: 23_600_000_000_000,
    registeredAt: 800_000, lastRewardAt: height, lastUptimeProof: 1_750_000_000,
    version: "3.2.0", unlocking: false, unlockAt: 0, contributors: 1, maxContributors: 9,
  }));
  return {
    live: true, height, fetchedAt,
    serviceNodes: {
      total, active: total, funded: total, exiting: 0, decommissioned: 0,
      stakingRequirement: 23_600_000_000_000,
      totalContributed: total * 23_600_000_000_000,
      nodes, awaitingNodes: [], unlockingNodes: [], decommissionedNodes: [],
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function refreshHarness(initialSnapshot, knownHeight = initialSnapshot.height) {
  let now = 0;
  let nextTimer = 0;
  let current = initialSnapshot;
  let updates = 0;
  const timers = new Map();
  const listeners = new Map();
  const requests = [];
  const highestKnownHeightRef = { current: knownHeight };
  const serviceNodeRefreshRef = { current: null };
  const context = {
    AbortController, highestKnownHeightRef, serviceNodeRefreshRef,
    document: {
      hidden: false,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
    },
    window: {
      setTimeout(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, { callback, due: now + delay });
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
    },
    fetch(endpoint, options) {
      const request = { endpoint, signal: options.signal, aborts: 0 };
      requests.push(request);
      return new Promise((resolve, reject) => {
        request.resolve = (data) => resolve({ ok: true, json: async () => data });
        options.signal.addEventListener("abort", () => {
          request.aborts += 1;
          reject(new Error("Request aborted"));
        }, { once: true });
      });
    },
    setServiceNodesLive(update) { current = update(current); updates += 1; },
    writeClientSnapshot() {},
  };
  vm.runInNewContext(compiled, context, { filename: "service-node-refresh.production.js" });
  return {
    requests, timers, listeners, highestKnownHeightRef, serviceNodeRefreshRef,
    get current() { return current; },
    get updates() { return updates; },
    remainingDelays() { return [...timers.values()].map((timer) => timer.due - now); },
    async resolve(index, data) { requests[index].resolve(data); await settle(); },
    async tick(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const pending = [...timers.entries()].filter(([, timer]) => timer.due <= end)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!pending) break;
        const [id, timer] = pending;
        now = timer.due;
        timers.delete(id);
        timer.callback();
        await settle();
      }
      now = end;
    },
    async cleanup() { context.cleanup(); await settle(); },
  };
}

test("a tip advance during an in-flight read fetches the new tip and updates data, height, and timestamp together", async (t) => {
  const old = snapshot(867_292, 439, "2026-09-20T23:18:00.000Z");
  const harness = refreshHarness(old, 867_293);
  t.after(() => harness.cleanup());
  assert.equal(harness.requests[0].endpoint, "/api/service-nodes-live?tip=867293");

  harness.highestKnownHeightRef.current = 867_294;
  harness.serviceNodeRefreshRef.current();
  assert.equal(harness.requests.length, 1, "Keep one full-list request in flight");

  const previousTip = snapshot(867_293, 440, "2026-09-20T23:21:07.000Z");
  await harness.resolve(0, previousTip);
  assert.strictEqual(harness.current, previousTip);
  assert.equal(harness.current.height, 867_293, "Never relabel old data with the new tip");
  assert.deepEqual(harness.remainingDelays(), [0], "Run the queued tip refresh immediately");
  await harness.tick(0);
  assert.equal(harness.requests[1].endpoint, "/api/service-nodes-live?tip=867294");

  const nextTip = snapshot(867_294, 441, "2026-09-20T23:24:00.000Z");
  await harness.resolve(1, nextTip);
  assert.strictEqual(harness.current, nextTip);
  assert.equal(harness.current.serviceNodes.active, 441);
  assert.equal(harness.current.height, 867_294);
  assert.equal(harness.current.fetchedAt, "2026-09-20T23:24:00.000Z");
  assert.deepEqual(harness.remainingDelays(), [15_000], "Successful reads clear their abort deadline");
});

test("a stalled browser read times out, retains the last verified snapshot, and retries successfully", async (t) => {
  const old = snapshot(867_293, 440, "2026-09-20T23:21:07.000Z");
  const harness = refreshHarness(old, 867_294);
  t.after(() => harness.cleanup());
  await harness.tick(119_999);
  assert.equal(harness.requests[0].signal.aborted, false);
  assert.strictEqual(harness.current, old);

  await harness.tick(1);
  assert.equal(harness.requests[0].signal.aborted, true);
  assert.equal(harness.requests[0].aborts, 1);
  assert.strictEqual(harness.current, old);
  assert.equal(harness.updates, 0);
  assert.deepEqual(harness.remainingDelays(), [5_000]);

  await harness.tick(5_000);
  assert.equal(harness.requests.length, 2);
  const fresh = snapshot(867_294, 440, "2026-09-20T23:24:00.000Z");
  await harness.resolve(1, fresh);
  assert.strictEqual(harness.current, fresh);
  assert.deepEqual(harness.remainingDelays(), [15_000]);
});

test("unmount aborts a pending read and removes deadlines, listeners, and future retries", async () => {
  const old = snapshot(867_293, 440, "2026-09-20T23:21:07.000Z");
  const harness = refreshHarness(old, 867_294);
  assert.equal(harness.timers.size, 1);
  await harness.cleanup();
  assert.equal(harness.requests[0].signal.aborted, true);
  assert.equal(harness.requests[0].aborts, 1);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.serviceNodeRefreshRef.current, null);
  await harness.tick(150_000);
  assert.equal(harness.requests.length, 1);
  assert.strictEqual(harness.current, old);
});

test("unmount after a successful read clears the scheduled heartbeat", async () => {
  const old = snapshot(867_293, 440, "2026-09-20T23:21:07.000Z");
  const harness = refreshHarness(old);
  await harness.resolve(0, snapshot(867_293, 440, "2026-09-20T23:22:00.000Z"));
  assert.deepEqual(harness.remainingDelays(), [15_000]);
  await harness.cleanup();
  assert.equal(harness.timers.size, 0);
  await harness.tick(150_000);
  assert.equal(harness.requests.length, 1);
});
