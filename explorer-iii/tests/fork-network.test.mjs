import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const boundary = { height: 882300, hash: "a".repeat(64), timestamp: 1790000000, major_version: 17 };
const reply = (header = boundary) => ({ data: { result: { headers: [header] } } });

async function fixture(produce) {
  let now = Date.now();
  const calls = [];
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } }, setTimeout, clearTimeout,
  });
  const modules = new Map();
  async function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const source = await readFile(url, "utf8");
    const sourceModule = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: url.href });
    modules.set(url.href, sourceModule);
    await sourceModule.link((specifier, parent) => {
      if (specifier === "./rpc") return new vm.SyntheticModule(["cachedJsonRpc"], function () {
        this.setExport("cachedJsonRpc", (method, params) => {
          calls.push({ method, params });
          return Promise.resolve().then(() => produce(calls.length));
        });
      }, { context });
      return load(new URL(`${specifier}.ts`, parent.identifier));
    });
    return sourceModule;
  }
  const entry = await load(new URL("../worker/fork-network.ts", import.meta.url));
  await entry.evaluate();
  return { calls, advance(ms) { now += ms; },
    snapshot(height = 882301) { return entry.namespace.forkNetworkSnapshot(height, 17, 180, new Date(now).toISOString()); } };
}

test("a slow optional activation proof returns basic network metadata within one second and coalesces pending reads", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const f = await fixture(() => pending);
  const startedAt = performance.now();
  const snapshots = await Promise.all([f.snapshot(), f.snapshot()]);
  assert.ok(performance.now() - startedAt < 2000, "Optional historical proof must not inherit a 15-second RPC timeout");
  assert.equal(f.calls.length, 1);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.phase, "unverified");
    assert.equal(snapshot.currentProtocol, 17);
    assert.equal(snapshot.activationBlock, null);
  }
  release(reply());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f.snapshot()).phase, "activated");
  assert.equal(f.calls.length, 1, "A completed in-flight proof is reused on the next poll");
});

test("valid activation evidence is reused briefly and rechecked for reorganization after thirty seconds", async () => {
  const f = await fixture((attempt) => attempt === 1 ? reply() : reply({ ...boundary, major_version: 16, hash: "b".repeat(64) }));
  assert.equal((await f.snapshot()).phase, "activated");
  f.advance(29999);
  assert.equal((await f.snapshot()).phase, "activated");
  assert.equal(f.calls.length, 1);
  f.advance(2);
  const rechecked = await f.snapshot();
  assert.equal(rechecked.phase, "unverified");
  assert.equal(rechecked.activationBlock.protocol, 16);
  assert.equal(f.calls.length, 2);
});

test("rejected, malformed, orphaned and wrong-height proof headers fail closed without blocking network data", async () => {
  const cases = [
    () => Promise.reject(new Error("RPC down")),
    () => reply({ ...boundary, hash: "invalid" }),
    () => reply({ ...boundary, orphan_status: true }),
    () => reply({ ...boundary, height: 882301 }),
    () => reply({ ...boundary, timestamp: NaN }),
    () => reply({ ...boundary, major_version: NaN }),
  ];
  for (const produce of cases) {
    const f = await fixture(produce);
    const snapshot = await f.snapshot();
    assert.equal(snapshot.phase, "unverified");
    assert.equal(snapshot.activationBlock, null);
    assert.equal(snapshot.currentProtocol, 17);
  }
});

test("pre-fork metadata does not perform any activation history RPC", async () => {
  const f = await fixture(() => { throw new Error("Unexpected proof RPC"); });
  assert.equal((await f.snapshot(882299)).phase, "scheduled");
  assert.equal(f.calls.length, 0);
});
