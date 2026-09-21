import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile(
  "worker/index.ts",
  workerSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function functionDeclaration(name) {
  const declaration = sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `missing function ${name}`);
  return declaration;
}

function functionSource(name) {
  return functionDeclaration(name).getText(sourceFile);
}

function calledFunctionNames(declaration) {
  const names = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) names.push(node.expression.text);
    ts.forEachChild(node, visit);
  }
  visit(declaration);
  return names;
}

function loadIntegrityHelpers() {
  const instrumented = [
    functionSource("classifyTransaction"),
    functionSource("verifiedChainTransactionDetails"),
    functionSource("requireSynchronizedPoolQuorum"),
    "module.exports = { verifiedChainTransactionDetails, requireSynchronizedPoolQuorum };",
  ].join("\n\n");
  const compiled = ts.transpileModule(instrumented, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "worker-integrity-helpers.ts",
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule,
    exports: testModule.exports,
    console,
    Set,
    Map,
    Number,
    String,
    Error,
    JSON,
  }, { filename: "worker-integrity-helpers.cjs" });
  return testModule.exports;
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function transactionDetail(hash, parsedOverrides = {}, overrides = {}) {
  return {
    tx_hash: hash,
    size: 321,
    as_json: JSON.stringify({
      type: 0,
      vin: [{ key: { k_image: "1" } }],
      vout: [{ target: { key: "2" } }, { target: { key: "3" } }],
      rct_signatures: { txnFee: 0 },
      ...parsedOverrides,
    }),
    ...overrides,
  };
}

test("accepts a complete requested transaction set without changing successful counts", () => {
  const { verifiedChainTransactionDetails } = loadIntegrityHelpers();
  const details = verifiedChainTransactionDetails(
    [HASH_A, HASH_B],
    [
      transactionDetail(HASH_A),
      transactionDetail(HASH_B, { vin: [{}, {}, {}], vout: [{}], rct_signatures: { txnFee: 17 } }),
    ],
  );

  assert.equal(details.size, 2);
  assert.deepEqual(
    { fee: details.get(HASH_A).fee, inputs: details.get(HASH_A).inputs, outputs: details.get(HASH_A).outputs },
    { fee: 0, inputs: 1, outputs: 2 },
  );
  assert.deepEqual(
    { fee: details.get(HASH_B).fee, inputs: details.get(HASH_B).inputs, outputs: details.get(HASH_B).outputs },
    { fee: 17, inputs: 3, outputs: 1 },
  );
});

test("rejects a partial get_transactions response instead of fabricating zero fields", () => {
  const { verifiedChainTransactionDetails } = loadIntegrityHelpers();
  assert.throws(
    () => verifiedChainTransactionDetails([HASH_A, HASH_B], [transactionDetail(HASH_A)]),
    /omitted 1 requested transaction detail/i,
  );
});

test("accepts protocol RCTTypeNull transactions whose serialized fee is intentionally absent", () => {
  const { verifiedChainTransactionDetails } = loadIntegrityHelpers();
  const details = verifiedChainTransactionDetails([HASH_A], [transactionDetail(HASH_A, {
    type: 1, vin: [], vout: [], rct_signatures: { type: 0 },
  })]);
  assert.equal(details.get(HASH_A).fee, 0);
  assert.equal(details.get(HASH_A).inputs, 0);
  assert.equal(details.get(HASH_A).outputs, 0);
  assert.equal(details.get(HASH_A).txType, "state-change");
});

test("rejects transaction details without parsed vin and vout arrays", () => {
  const { verifiedChainTransactionDetails } = loadIntegrityHelpers();
  assert.throws(
    () => verifiedChainTransactionDetails([HASH_A], [transactionDetail(HASH_A, { vin: null })]),
    /incomplete transaction fields/i,
  );
  assert.throws(
    () => verifiedChainTransactionDetails([HASH_A], [transactionDetail(HASH_A, { vout: null })]),
    /incomplete transaction fields/i,
  );
  assert.throws(
    () => verifiedChainTransactionDetails([HASH_A], [transactionDetail(HASH_A, { rct_signatures: {} })]),
    /incomplete transaction fee fields/i,
  );
});

test("requires two synchronized pools before a pool snapshot can be available", () => {
  const { requireSynchronizedPoolQuorum } = loadIntegrityHelpers();
  assert.throws(() => requireSynchronizedPoolQuorum(0), /at least two synchronized/i);
  assert.throws(() => requireSynchronizedPoolQuorum(1), /at least two synchronized/i);
  assert.doesNotThrow(() => requireSynchronizedPoolQuorum(2));
  assert.doesNotThrow(() => requireSynchronizedPoolQuorum(3));
});

test("AST wires both integrity guards into the live worker fallback paths", () => {
  const chainCalls = calledFunctionNames(functionDeclaration("chainSnapshot"));
  const poolCalls = calledFunctionNames(functionDeclaration("transactionPoolSnapshot"));
  assert.ok(chainCalls.includes("verifiedChainTransactionDetails"));
  assert.ok(poolCalls.includes("requireSynchronizedPoolQuorum"));

  const chainCache = functionSource("cachedChainResponse");
  assert.match(chainCache, /refreshed\.ok \|\| !cached \? refreshed : noStoreResponse\(cached\)/);

  const poolResponse = functionSource("createTransactionPoolLiveResponse");
  assert.match(poolResponse, /available:\s*false/);
  assert.match(poolResponse, /},\s*503\)/);
});
