import { readProductionSource } from "./helpers/production-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const pageSource = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
const sourceFile = ts.createSourceFile("app/page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const home = sourceFile.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "Home");
assert.ok(home?.body);

function findNode(predicate) {
  let found;
  function visit(node) {
    if (found) return;
    if (predicate(node)) { found = node; return; }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return found;
}

function functionSource(name) {
  const declaration = findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing ${name}`);
  return declaration.getText(sourceFile);
}

function effectSource(marker) {
  const effect = findNode((node) => ts.isCallExpression(node)
    && node.expression.getText(sourceFile) === "useEffect"
    && node.arguments[0].getText(sourceFile).includes(marker));
  assert.ok(effect, `Missing effect ${marker}`);
  return effect.arguments[0].getText(sourceFile);
}

const formatterSource = sourceFile.statements.filter((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some((declaration) => [
    "compactNumberFormatter", "judeNumberFormatter", "atomicJudeNumberFormatter", "feeJudeNumberFormatter",
  ].includes(declaration.name.getText(sourceFile)))).map((node) => node.getText(sourceFile)).join("\n");

function loadFunctions(names, context = {}, prefix = "") {
  const compiled = ts.transpileModule([
    prefix,
    ...names.map(functionSource),
    `module.exports = { ${names.join(", ")} };`,
  ].join("\n"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "client-performance.tsx",
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, console, AbortController,
    Response, DOMException, AggregateError, Error, setTimeout, clearTimeout,
    require(name) {
      assert.equal(name, "react/jsx-runtime");
      return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    },
    ...context,
  });
  return testModule.exports;
}

const formatters = loadFunctions(["compact", "jude", "atomicJude"], {}, formatterSource);

test("reused number formatters preserve exact release formatting, including zero and atomic fractions", () => {
  const values = [0, -0, 1, -1, 439, 23_600, 867_181, 10_384_000, 41_556_443.39474392,
    123_456_789, 23_600_000_000_000, Number.MAX_SAFE_INTEGER, NaN, Infinity];
  for (const value of values) {
    assert.equal(formatters.compact(value), new Intl.NumberFormat("en-US").format(value));
    assert.equal(formatters.jude(value), new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value / 1_000_000_000));
    assert.equal(formatters.atomicJude(value), new Intl.NumberFormat("en-US", { maximumFractionDigits: 9 }).format(value / 1_000_000_000));
  }
});

const HASH = "a".repeat(64);
const payloads = {
  block: {
    hash: HASH, timestamp: 1_750_000_000, orphan: false, transactions: 0, size: 200,
    difficulty: 1_000, majorVersion: 16, minorVersion: 0, confirmations: 1, reward: 10,
    minerTransaction: { hash: HASH, version: 2, size: 100, ringCtType: 0, unlockHeight: 0, outputs: [], raw: {} },
  },
  transaction: {
    hash: HASH, confirmations: 1, blockHeight: 867_181, timestamp: 1_750_000_000,
    size: 200, fee: 0, txType: "transfer", version: 2, inputs: [], outputs: [], unlockTime: 0, raw: {},
  },
  "service-node": {
    publicKey: HASH, active: true, funded: true, totalContributed: 23_600_000_000_000,
    stakingRequirement: 23_600_000_000_000, contributors: [], decommissionCount: 0, raw: {},
  },
};

function detailHarness(kind, query = HASH, responseData = payloads[kind]) {
  const observed = { calls: [], history: [], details: [], messages: [], pending: [] };
  const successfulResponse = Response.json(responseData);
  const functions = loadFunctions([
    "cancelSearch", "beginDetailRequest", "resolveDetailRequest", "readPublicDetail", "openBlock", "openTransaction", "openServiceNode", "search",
    "lookupPublicIdentifier", "createServiceNodeDetail", "serviceNodeUnlockEstimate", "estimatedBlockWait", "estimatedBlockDate", "utcTimestamp",
    "compact", "jude", "atomicJude", "feeJude", "difficulty", "bytes", "inOut",
  ], {
    query,
    liveNetwork: null,
    serviceNodeHeight: 0,
    detailAbortController: { current: null },
    detailRequestId: { current: 0 },
    searchRequestId: { current: 0 },
    searchAbortController: { current: null },
    setServiceNodeRecord() {},
    setDetailPending: (value) => observed.pending.push(value),
    setDetail: (value) => observed.details.push(value),
    setDetailRenderKey() {},
    setMessage: (value) => observed.messages.push(value),
    setSearchLoading() {},
    TxTypeBadge() {},
    window: { history: { pushState: (...args) => observed.history.push(args[2]) } },
    fetch: async (url) => {
      observed.calls.push(url);
      return url.startsWith(`/api/${kind}?`) ? successfulResponse : new Response("Not found", { status: 404 });
    },
  }, formatterSource);
  return { ...functions, observed, successfulResponse };
}

for (const [kind, expectedRequests, historyPrefix] of [
  ["block", 3, "block"], ["transaction", 3, "tx"], ["service-node", 3, "node"],
]) {
  test(`search reuses the successful ${kind} response without requesting it twice`, async () => {
    const harness = detailHarness(kind);
    await harness.search({ preventDefault() {} });
    assert.equal(harness.observed.calls.length, expectedRequests);
    assert.equal(harness.observed.calls.filter((url) => url.startsWith(`/api/${kind}?`)).length, 1);
    assert.equal(harness.successfulResponse.bodyUsed, true);
    assert.deepEqual(harness.observed.history, [`#${historyPrefix}-${HASH}`]);
    assert.equal(harness.observed.details.length, 1);
    assert.equal(harness.observed.details[0].kind, kind);
    assert.deepEqual(Array.from(harness.observed.details[0].rows), []);
    assert.equal(harness.observed.pending.at(-1), null);
    assert.equal(harness.observed.messages.at(-1), "");

    const fields = (detail) => Object.fromEntries(detail.sections.flatMap((section) => section.rows).map((row) => [row.label, row.value]));
    const initialDetail = harness.observed.details[0];
    const initialFields = fields(initialDetail);
    if (kind === "transaction") {
      for (const label of ["TRANSACTION PUBLIC KEY", "PAYMENT ID (ENCRYPTED)", "RINGCT", "INPUTS / OUTPUTS", "UNLOCK TIME / HEIGHT", "DOUBLE-SPEND FLAG", "EXTRA"]) {
        assert.ok(!(label in initialFields), `Absent transaction field should not occupy a row: ${label}`);
      }
      assert.equal(initialFields.FEE, "0.00000000 JUDE");
      assert.ok(!initialDetail.sections.some((section) => section.title === "Extra"));
      assert.equal(initialDetail.raw, "{}");

      const pool = detailHarness(kind, HASH, { ...payloads.transaction, inPool: true, confirmations: 0, blockHeight: 0, extra: " " });
      await pool.openTransaction(HASH, undefined, false);
      const poolFields = fields(pool.observed.details[0]);
      assert.equal(poolFields.FEE, "0.00000000 JUDE", "A real zero fee must remain visible");
      assert.equal(poolFields.CONFIRMATIONS, "0", "A pool transaction must retain its real zero confirmations");
      assert.equal(poolFields.STATUS, "Transaction Pool");
      assert.ok(!pool.observed.details[0].sections.some((section) => section.title === "Extra"));

      const reported = { ...payloads.transaction,
        publicKey: "b".repeat(64), paymentId: "0123456789abcdef", unlockTime: 1_000,
        ringCtType: 2, inputs: [{ type: "key" }], outputs: [{ index: 0, key: "output", confidential: true }],
        doubleSpendSeen: true, extra: "010203", raw: { unlock_time: 1_000 },
      };
      const rich = detailHarness(kind, HASH, reported);
      await rich.openTransaction(HASH, undefined, false);
      const richFields = fields(rich.observed.details[0]);
      assert.equal(richFields["TRANSACTION PUBLIC KEY"], reported.publicKey);
      assert.equal(richFields["PAYMENT ID (ENCRYPTED)"], reported.paymentId);
      assert.equal(richFields["UNLOCK TIME / HEIGHT"], "1,000");
      assert.equal(richFields.RINGCT, "Yes / type 2");
      assert.equal(richFields["INPUTS / OUTPUTS"], "1/1");
      assert.equal(richFields["DOUBLE-SPEND FLAG"], "Detected");
      assert.equal(richFields.EXTRA, "010203");
      assert.equal(rich.observed.details[0].raw, JSON.stringify(reported.raw, null, 2));
    } else if (kind === "block") {
      for (const label of ["TRANSACTION PUBLIC KEY", "RINGCT", "UNLOCK HEIGHT", "SERVICE NODE WINNER", "EXTRA"]) {
        assert.ok(!(label in initialFields), `Absent reward-transaction field should not occupy a row: ${label}`);
      }
      assert.ok(!initialDetail.sections.some((section) => section.title === "Extra"));
      const zero = detailHarness(kind, HASH, { ...payloads.block, reward: 0, confirmations: 0 });
      await zero.openBlock(867_181, false);
      const zeroFields = fields(zero.observed.details[0]);
      assert.equal(zeroFields["TOTAL BLOCK REWARD"], "0 JUDE");
      assert.equal(zeroFields.CONFIRMATIONS, "0");
      assert.equal(zero.observed.details[0].raw, "{}");

      const minerTransaction = { ...payloads.block.minerTransaction, publicKey: "b".repeat(64),
        serviceNodeWinner: "c".repeat(64), unlockHeight: 110, ringCtType: 2, extra: "010203", raw: { unlock_time: 110 } };
      const rich = detailHarness(kind, HASH, { ...payloads.block, minerTransaction });
      await rich.openBlock(867_181, false);
      const richFields = fields(rich.observed.details[0]);
      assert.equal(richFields["TRANSACTION PUBLIC KEY"], minerTransaction.publicKey);
      assert.equal(richFields["SERVICE NODE WINNER"], minerTransaction.serviceNodeWinner);
      assert.equal(richFields["UNLOCK HEIGHT"], "110");
      assert.equal(richFields.RINGCT, "Yes / type 2");
      assert.equal(richFields.EXTRA, "010203");
      assert.equal(rich.observed.details[0].raw, JSON.stringify(minerTransaction.raw, null, 2));
    }
  });
}

test("direct block selection still fetches once and preserves the optional history behavior", async () => {
  const harness = detailHarness("block");
  await harness.openBlock(867_181, false);
  assert.deepEqual(harness.observed.calls, ["/api/block?id=867181"]);
  assert.deepEqual(harness.observed.history, []);
  assert.equal(harness.observed.details[0].kind, "block");
});

test("a late handed-off response cannot overwrite a newer detail request", async () => {
  const harness = detailHarness("block");
  let finishOldBody;
  const oldBody = new Promise((resolve) => { finishOldBody = resolve; });
  const older = harness.openBlock(1, true, { ok: true, json: () => oldBody });
  await harness.openBlock(2, true, Response.json({ ...payloads.block, hash: "b".repeat(64) }));
  finishOldBody(payloads.block);
  await older;
  assert.equal(harness.observed.calls.length, 0);
  assert.equal(harness.observed.details.length, 1);
  assert.equal(harness.observed.details[0].sections[0].rows[0].value, "b".repeat(64));
});

for (const [marker, mode] of [
  ["const loadSnapshot = async", "chain"],
  ["const refreshSnapshotAtTip = async", "catch-up"],
  ["const refreshQuorums = async", "quorum"],
]) {
  test(`${mode} waits for restored page-size preferences before requesting the selected page`, () => {
    const compiled = ts.transpileModule(`module.exports = (${effectSource(marker)});`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    for (const ready of [false, true]) {
      const calls = [];
      const pending = new Promise(() => {});
      const testModule = { exports: {} };
      vm.runInNewContext(compiled, {
        module: testModule,
        serviceNodesOnly: false, statisticsOnly: false, overviewOnly: false, pageSizePreferencesLoaded: ready,
        snapshot: { network: { height: 100 } }, knownChainHeight: 101,
        snapshotParams: () => new URLSearchParams({ blockPageSize: "25" }),
        fetchSnapshot: () => pending,
        fetchSnapshotWithRetry: (params) => { calls.push(params.toString()); return pending; },
        fetchExplorerJson: (url) => { calls.push(url); return pending; },
        LIVE_REQUEST_TIMEOUT_MS: 45_000,
        TRANSACTION_POOL_REFRESH_DELAY_MS: 5_000,
        AbortController,
        quorumPage: 0, quorumPageSize: 25, highestKnownHeightRef: { current: 101 },
        quorumRefreshRef: { current: null }, QUORUM_REFRESH_DELAY_MS: 5_000,
        URLSearchParams,
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        window: { clearTimeout() {} },
      });
      const cleanup = testModule.exports();
      assert.equal(calls.length, ready ? 1 : 0);
      if (ready) {
        assert.match(calls[0], mode === "quorum" ? /pageSize=25/ : /blockPageSize=25/);
        cleanup();
      }
    }
  });
}
