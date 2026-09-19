import assert from "node:assert/strict";
import test from "node:test";
import { createDeregistrationTracker, resolveDeregisteredNodes, scanStakeRange } from "../worker/deregistration.ts";

const hash = (value) => value.toString(16).padStart(64, "0");
const oldKey = hash(1);
const newKey = hash(2);
const oldImage = hash(10);
const newImage = hash(20);
const secondImage = hash(21);
const seed = () => ({ version: 1, scannedThrough: 100, registrations: { [oldKey]: 80 }, stakes: [{ publicKey: oldKey, keyImage: oldImage }] });
const header = (height, txs = []) => ({ height, hash: hash(height + 1000), num_txes: txs.length, tx_hashes: txs });
const transaction = (height, key, image, registration = true) => ({
  tx_hash: hash(height), block_height: height, in_pool: false,
  extra: { sn_pubkey: key, sn_registration: registration ? {} : undefined, locked_key_images: [image] },
});

function fixture() {
  const state = { height: 101, blacklist: [{ key_image: oldImage, unlock_height: 200 }], txs: [], offline: false, missing: false };
  const reader = {
    get height() { return state.height; },
    blacklist: async () => structuredClone(state.blacklist),
    headers: async (start, end) => Array.from({ length: end - start + 1 }, (_, index) => {
      const height = start + index;
      return header(height, state.txs.filter((tx) => tx.block_height === height).map((tx) => tx.tx_hash));
    }),
    transactions: async (hashes) => state.missing ? [] : state.txs.filter((tx) => hashes.includes(tx.tx_hash)),
  };
  return { state, reader, open: async () => { if (state.offline) throw new Error("Offline"); return reader; } };
}

test("adds a newly registered and deregistered node without rebuilding", async () => {
  const f = fixture();
  const tracker = createDeregistrationTracker(seed(), f.open);
  assert.equal((await tracker.read(true)).total, 1);
  f.state.height = 102;
  f.state.txs.push(transaction(102, newKey, newImage));
  f.state.blacklist.push({ key_image: newImage, unlock_height: 250 });
  const result = await tracker.read(true);
  assert.equal(result.live, true);
  assert.equal(result.total, 2);
  assert.equal(result.indexedThrough, 102);
  assert.equal(tracker.find(newKey).registeredAt, 102);
});

test("removes expired stake and does not restore bundled historical records", async () => {
  const f = fixture();
  const tracker = createDeregistrationTracker(seed(), f.open);
  assert.equal((await tracker.read(true)).total, 1);
  f.state.height = 200;
  assert.equal((await tracker.read(true)).total, 0);
  f.state.blacklist = [];
  assert.equal((await tracker.read(true)).total, 0);
  assert.equal(tracker.find(oldKey).unlockedAt, 200);
});

test("counts nodes rather than contribution key images", () => {
  const index = seed();
  index.stakes.push({ publicKey: oldKey, keyImage: secondImage });
  const { nodes } = resolveDeregisteredNodes(index, [
    { key_image: oldImage, unlock_height: 200 },
    { key_image: secondImage, unlock_height: 210 },
    { key_image: secondImage, unlock_height: 210 },
  ], 101);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].contributions, 2);
  assert.equal(nodes[0].unlockedAt, 210);
});

test("does not publish an incomplete count when a new key image is unresolved", async () => {
  const f = fixture();
  f.state.blacklist.push({ key_image: newImage, unlock_height: 250 });
  const result = await createDeregistrationTracker(seed(), f.open).read();
  assert.equal(result.total, null);
  assert.equal(result.live, false);
  assert.equal(result.status, "syncing");
  assert.equal(result.unresolvedKeyImages, 1);
});

test("does not substitute an old count when the live source fails", async () => {
  const f = fixture();
  const tracker = createDeregistrationTracker(seed(), f.open);
  assert.equal((await tracker.read(true)).total, 1);
  f.state.offline = true;
  const result = await tracker.read(true);
  assert.equal(result.total, null);
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.nodes, []);
  f.state.offline = false;
  assert.equal((await tracker.read(true)).total, 1);
});

test("missing transactions do not advance the index and are retried", async () => {
  const f = fixture();
  f.state.txs.push(transaction(101, newKey, newImage));
  f.state.blacklist.push({ key_image: newImage, unlock_height: 250 });
  f.state.missing = true;
  const tracker = createDeregistrationTracker(seed(), f.open);
  const incomplete = await tracker.read(true);
  assert.equal(incomplete.total, null);
  assert.equal(incomplete.indexedThrough, 100);
  f.state.missing = false;
  const complete = await tracker.read(true);
  assert.equal(complete.total, 2);
  assert.equal(complete.indexedThrough, 101);
});

test("missing transaction hashes do not silently skip a nonempty block", async () => {
  const f = fixture();
  f.reader.headers = async () => [{ height: 101, hash: hash(1101), num_txes: 1 }];
  await assert.rejects(scanStakeRange(seed(), f.reader, 101), /Missing block transaction hashes/);
});

test("partial header responses cannot advance a checkpoint", async () => {
  const f = fixture();
  f.reader.headers = async () => [header(101)];
  await assert.rejects(scanStakeRange(seed(), f.reader, 102), /Incomplete block headers/);
});

test("an empty valid blacklist produces zero", async () => {
  const f = fixture();
  f.state.blacklist = [];
  const result = await createDeregistrationTracker(seed(), f.open).read();
  assert.equal(result.total, 0);
  assert.equal(result.live, true);
});

test("malformed blacklist responses are unavailable rather than zero", async () => {
  const f = fixture();
  f.state.blacklist = undefined;
  const result = await createDeregistrationTracker(seed(), f.open).read();
  assert.equal(result.total, null);
  assert.equal(result.status, "unavailable");
});

test("resumes a saved checkpoint after a Worker cold start", async () => {
  const f = fixture();
  f.state.txs.push(transaction(101, newKey, newImage));
  f.state.blacklist.push({ key_image: newImage, unlock_height: 250 });
  let saved;
  const storage = { load: async () => saved, save: async (value) => { saved = structuredClone(value); } };
  await createDeregistrationTracker(seed(), f.open, storage).read();
  const tracker = createDeregistrationTracker(seed(), f.open, storage);
  const result = await tracker.read();
  assert.equal(result.total, 2);
  assert.equal(result.indexedThrough, 101);
  assert.equal(tracker.find(newKey).registeredAt, 101);
});

test("a long backlog is scanned in bounded ranges over successive polls", async () => {
  const f = fixture();
  f.state.height = 5101;
  f.state.txs.push(transaction(5101, newKey, newImage));
  f.state.blacklist.push({ key_image: newImage, unlock_height: 6000 });
  const tracker = createDeregistrationTracker(seed(), f.open);
  const first = await tracker.read(true);
  assert.equal(first.indexedThrough, 4100);
  assert.equal(first.total, null);
  const second = await tracker.read(true);
  assert.equal(second.indexedThrough, 5101);
  assert.equal(second.total, 1);
});

test("parallel reads share one refresh", async () => {
  const f = fixture();
  let calls = 0;
  const tracker = createDeregistrationTracker(seed(), async () => { calls += 1; return f.open(); });
  const results = await Promise.all([tracker.read(), tracker.read(), tracker.read()]);
  assert.equal(calls, 1);
  assert.ok(results.every((result) => result.total === 1));
});

test("rechecks an altered checkpoint block after a reorganization", async () => {
  const f = fixture();
  f.state.txs.push(transaction(101, newKey, newImage));
  f.state.blacklist.push({ key_image: newImage, unlock_height: 250 });
  const tracker = createDeregistrationTracker(seed(), f.open);
  assert.equal((await tracker.read(true)).total, 2);
  const originalHeaders = f.reader.headers;
  f.reader.headers = async (start, end) => (await originalHeaders(start, end)).map((item) => ({ ...item, hash: hash(9999) }));
  f.state.txs = [];
  f.state.blacklist = [{ key_image: oldImage, unlock_height: 200 }];
  assert.equal((await tracker.read(true)).total, 1);
  assert.equal(tracker.find(newKey), undefined);
});

test("cache write failures do not prevent fresh data", async () => {
  const f = fixture();
  const storage = { load: async () => { throw new Error("Cache unavailable"); }, save: async () => { throw new Error("Cache unavailable"); } };
  assert.equal((await createDeregistrationTracker(seed(), f.open, storage).read()).total, 1);
});
