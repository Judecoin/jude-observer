import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const context = vm.createContext({ Request, Response, Headers, Date, setTimeout, clearTimeout });
const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const source = await readFile(url, "utf8");
  const sourceModule = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: url.href });
  modules.set(url.href, sourceModule);
  await sourceModule.link((specifier, parent) => load(new URL(`${specifier}.ts`, parent.identifier)));
  return sourceModule;
}
const archiveModule = await load(new URL("../worker/fork-archive.ts", import.meta.url));
await archiveModule.evaluate();
const { ForkArchive, attachForkArchive, validForkObservation } = archiveModule.namespace;
const { buildUpgradeReadiness, buildForkSnapshot, normalizeNodeVersion } = modules.get(new URL("../worker/fork.ts", import.meta.url).href).namespace;
const timestamp = new Date().toISOString();

test("version readiness keeps missing/malformed versions unknown and uses all registered nodes as denominator", () => {
  const readiness = buildUpgradeReadiness([[4, 0, 0], [3, 2, 0], [4, 1, 1], undefined, [], [0, 0, 0], [4, -1, 0]]);
  assert.equal(readiness.upgraded, 2);
  assert.equal(readiness.pending, 1);
  assert.equal(readiness.unknown, 4);
  assert.equal(readiness.eligibleTotal, 7);
  assert.equal(readiness.percentage, 28.57);
  assert.equal(buildUpgradeReadiness([]).percentage, null);
  assert.equal(normalizeNodeVersion([4, 0, 0, 7]), "4.0.0");
});

test("activation requires the exact boundary block and protocol evidence, not a clock or a height alone", () => {
  const scheduled = buildForkSnapshot(882299, 16, 180, timestamp);
  assert.equal(scheduled.phase, "scheduled");
  assert.equal(scheduled.blocksRemaining, 1);
  assert.equal(Date.parse(scheduled.estimatedActivationAt) - Date.parse(timestamp), 180000);
  assert.equal(buildForkSnapshot(882300, 17, 180, timestamp).phase, "unverified");
  const evidence = { height: 882300, hash: "a".repeat(64), timestamp: 1790000000, protocol: 17 };
  assert.equal(buildForkSnapshot(882301, 17, 180, timestamp, evidence).phase, "activated");
  assert.equal(buildForkSnapshot(882301, 16, 180, timestamp, evidence).phase, "unverified");
  assert.equal(buildForkSnapshot(882301, 17, 180, timestamp, { ...evidence, protocol: 16 }).phase, "unverified");
  assert.equal(buildForkSnapshot(882301, 17, 180, timestamp, { ...evidence, height: 882301 }).phase, "unverified");
  assert.equal(buildForkSnapshot(882301, 17, 180, timestamp, evidence).estimatedActivationAt, null);
});

function storageFixture() {
  const values = new Map();
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async transaction(callback) { return callback(storage); },
  };
  return { storage, values };
}
const observation = (height, overrides = {}) => ({
  height, observedAt: timestamp, source: "Judecoin service-node RPC",
  readiness: buildUpgradeReadiness([[4, 0, 0], [3, 2, 0], undefined]), ...overrides,
});
const post = (value) => new Request("https://archive.internal/", { method: "POST", body: JSON.stringify(value) });

test("durable history retains the last pre-fork observation across object instances and rejects later/live data", async () => {
  const { storage } = storageFixture();
  const archive = new ForkArchive({ storage });
  assert.equal((await archive.fetch(post(observation(882298)))).status, 200);
  const latest = await (await archive.fetch(post(observation(882299)))).json();
  assert.equal(latest.exactClosingSnapshot, true);
  assert.equal(latest.preFork.height, 882299);
  await archive.fetch(post(observation(882297)));
  assert.equal((await archive.fetch(post(observation(882300)))).status, 400);
  const restored = new ForkArchive({ storage });
  assert.equal((await (await restored.fetch(new Request("https://archive.internal/"))).json()).preFork.height, 882299);
});

test("empty or all-unknown observations cannot replace verified history; same-height degradation is ignored", async () => {
  const { storage } = storageFixture();
  const archive = new ForkArchive({ storage });
  const initial = observation(882299, { readiness: buildUpgradeReadiness([[4, 0, 0], [3, 2, 0], [4, 0, 0]]) });
  await archive.fetch(post(initial));
  const degraded = observation(882299, { observedAt: new Date(Date.parse(timestamp) + 1000).toISOString() });
  await archive.fetch(post(degraded));
  const data = await (await archive.fetch(new Request("https://archive.internal/"))).json();
  assert.equal(data.preFork.readiness.unknown, 0);
  assert.equal(validForkObservation(observation(882299, { readiness: buildUpgradeReadiness([]) })), false);
  assert.equal(validForkObservation(observation(882299, { readiness: buildUpgradeReadiness([undefined]) })), false);
  assert.equal(validForkObservation(observation(882299, { readiness: { ...initial.readiness, upgraded: 99 } })), false);
});

test("missing archive binding leaves service-node data usable and marks history unavailable", async () => {
  const snapshot = { live: true, height: 882299, fetchedAt: timestamp,
    serviceNodes: { upgradeReadiness: buildUpgradeReadiness([[4, 0, 0]]) } };
  const background = [];
  const response = await attachForkArchive(new Response(JSON.stringify(snapshot)), {}, { waitUntil(value) { background.push(value); } });
  const data = await response.json();
  assert.equal(data.live, true);
  assert.equal(data.serviceNodes.upgradeReadiness.upgraded, 1);
  assert.equal(data.serviceNodes.forkArchive.available, false);
  assert.equal(data.serviceNodes.forkArchive.preFork, null);
  await Promise.all(background);
});

test("service-node endpoint stores only server-built pre-fork data and reads history after activation", async () => {
  const { storage } = storageFixture();
  const archive = new ForkArchive({ storage });
  const env = { FORK_ARCHIVE: { idFromName() { return "event"; }, get() { return { fetch: (request) => archive.fetch(request) }; } } };
  const ctx = { waitUntil() {} };
  const snapshot = { live: true, height: 882299, fetchedAt: timestamp,
    serviceNodes: { upgradeReadiness: buildUpgradeReadiness([[4, 0, 0]]) } };
  const before = await (await attachForkArchive(new Response(JSON.stringify(snapshot)), env, ctx)).json();
  assert.equal(before.serviceNodes.forkArchive.preFork.height, 882299);
  const after = await (await attachForkArchive(new Response(JSON.stringify({ ...snapshot, height: 882301 })), env, ctx)).json();
  assert.equal(after.serviceNodes.forkArchive.preFork.height, 882299);
});
