import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../scripts/sync-deregistered-nodes.mjs", import.meta.url), "utf8");
const parsed = ts.createSourceFile("sync-deregistered-nodes.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Set(["headerRange", "transactionRequests", "queuedBatches", "activeBatches", "drainBatches", "prefetchTransactions", "reader"]);
const readerSource = parsed.statements.filter((statement) => {
  if (ts.isFunctionDeclaration(statement)) return declarations.has(statement.name?.text);
  if (ts.isVariableStatement(statement)) return declarations.has(statement.declarationList.declarations[0].name.getText(parsed));
  return false;
}).map((statement) => statement.getText(parsed)).join("\n");

function fixture({ failTransactions = false } = {}) {
  const headers = Array.from({ length: 501 }, (_, height) => ({
    height, hash: (height + 1000).toString(16).padStart(64, "0"), num_txes: 1,
    tx_hashes: [height.toString(16).padStart(64, "0")],
  }));
  const state = { headerRequests: [], transactionRequests: 0, active: 0, maximum: 0 };
  const context = vm.createContext({
    source: { node: "http://node.example:16061" },
    validateHeaders(values, start, end) { assert.equal(values.length, end - start + 1); },
    jsonRpc: async (method, params) => {
      state.headerRequests.push({ method, params });
      return { headers: headers.filter((header) => header.height >= params.start_height && header.height <= params.end_height) };
    },
    request: async (node, path, body) => {
      assert.equal(node, "http://node.example:16061");
      assert.equal(path, "/get_transactions");
      assert.equal(body.prune, true);
      assert.ok(body.txs_hashes.length <= 100);
      state.transactionRequests += 1;
      state.active += 1;
      state.maximum = Math.max(state.maximum, state.active);
      await new Promise((resolve) => setImmediate(resolve));
      state.active -= 1;
      if (failTransactions) throw new Error("RPC unavailable");
      return { txs: body.txs_hashes.map((hash) => ({
        tx_hash: hash, block_height: Number.parseInt(hash, 16), in_pool: false, extra: {},
      })) };
    },
  });
  vm.runInContext(`${readerSource}\nglobalThis.readerUnderTest = reader;`, context);
  return { headers, state, reader: context.readerUnderTest };
}

test("stake-index sync reuses split header ranges and bounds independent transaction RPC concurrency", async () => {
  const f = fixture();
  await f.reader.headers(0, 500);
  await f.reader.headers(0, 250);
  const hashes = f.headers.flatMap((header) => header.tx_hashes);
  const transactions = await f.reader.transactions(hashes);
  assert.equal(transactions.length, hashes.length);
  assert.equal(f.state.headerRequests.length, 1);
  assert.equal(f.state.headerRequests[0].params.fill_pow_hash, false);
  assert.equal(f.state.transactionRequests, 6);
  assert.ok(f.state.maximum > 1 && f.state.maximum <= 4);
  await f.reader.transactions(hashes.slice(0, 200));
  assert.equal(f.state.transactionRequests, 6, "already verified RPC results are reused");
});

test("stake-index sync propagates failed prefetched RPC batches to the validating scanner", async () => {
  const f = fixture({ failTransactions: true });
  await f.reader.headers(0, 500);
  await assert.rejects(f.reader.transactions(f.headers.flatMap((header) => header.tx_hashes)), /RPC unavailable/);
});
