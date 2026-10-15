import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  availableChainTransactionDetails,
  classifyTransaction,
  verifiedChainTransactionDetails,
} from "../worker/transactions.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/service-node-state-transactions.json", import.meta.url), "utf8"));
const HASH = "a".repeat(64);

function detail(parsed, extra = {}) {
  return { tx_hash: HASH, size: 473, as_json: JSON.stringify(parsed), extra };
}

test("real Judecoin state-change RPC records survive transaction validation without RingCT fields", () => {
  const expected = ["decommission", "recommission", "ip-change", "deregistration"];
  const hashes = fixture.transactions.map((transaction) => transaction.tx_hash);
  const verified = verifiedChainTransactionDetails(hashes, fixture.transactions);
  const available = availableChainTransactionDetails(hashes, fixture.transactions);
  assert.equal(verified.size, expected.length);
  assert.equal(available.size, expected.length);
  fixture.transactions.forEach((transaction, index) => {
    const parsed = JSON.parse(transaction.as_json);
    assert.equal(parsed.rct_signatures, undefined, "fixture retains the daemon's omitted RingCT field");
    assert.deepEqual(verified.get(transaction.tx_hash), {
      fee: 0, inputs: 0, outputs: 0, size: transaction.size, txType: expected[index],
    });
    assert.deepEqual(available.get(transaction.tx_hash), verified.get(transaction.tx_hash));
  });
});

test("state classification supports the daemon's structured extra and keeps an unknown state explicit", () => {
  for (const [state, expected] of [
    ["dereg", "deregistration"], ["deregister", "deregistration"], ["deregistration", "deregistration"],
    ["decom", "decommission"], ["decommission", "decommission"],
    ["recom", "recommission"], ["recommission", "recommission"],
    ["ip", "ip-change"], ["ip_change", "ip-change"], ["ip_change_penalty", "ip-change"],
  ]) {
    assert.equal(classifyTransaction({ type: 1 }, { extra: { sn_state_change: { type: state } } }), expected);
    assert.equal(classifyTransaction({ type: 1 }, { sn_state_change: { type: state.toUpperCase() } }), expected);
  }
  assert.equal(classifyTransaction({ type: 1 }, { extra: { sn_state_change: { type: "  decom  " } } }), "decommission");
  assert.equal(classifyTransaction({ type: 0 }, { extra: { sn_state_change: { type: "future-state" } } }), "state-change");
  assert.equal(classifyTransaction({ type: 1 }), "state-change");
});

test("registration takes precedence over its first contribution and other transaction classes remain distinct", () => {
  assert.equal(classifyTransaction({ type: 3 }, { extra: { sn_registration: {}, sn_contributor: "wallet" } }), "registration");
  assert.equal(classifyTransaction({ type: 3 }, { extra: { sn_contributor: "wallet" } }), "contribution");
  assert.equal(classifyTransaction({ type: 2 }), "unlock");
  assert.equal(classifyTransaction({ type: 0 }, { extra: { key_image_unlock: {} } }), "unlock");
  assert.equal(classifyTransaction({ type: 0, vin: [{ gen: { height: 100 } }] }), "block-reward");
  assert.equal(classifyTransaction({ type: 0 }), "transfer");
  assert.equal(classifyTransaction({ type: 3 }), "state-change", "unavailable stake metadata must not invent registration/contribution");
});

test("non-spending unlock transactions may omit RingCT; fee-bearing transactions still require a fee", () => {
  const administrative = { type: 2, vin: [], vout: [] };
  assert.equal(verifiedChainTransactionDetails([HASH], [detail(administrative)]).get(HASH).fee, 0);
  for (const parsed of [
    { type: 0, vin: [], vout: [] },
    { type: 3, vin: [], vout: [] },
    { type: 1, vin: [{}], vout: [] },
    { type: 1, vin: [], vout: [{}] },
    { ...administrative, rct_signatures: {} },
  ]) {
    assert.throws(() => verifiedChainTransactionDetails([HASH], [detail(parsed)]), /incomplete transaction fee fields/);
  }
});

test("partial transaction validation skips only malformed/duplicate entries and keeps valid state events", () => {
  const valid = fixture.transactions[0];
  const duplicate = fixture.transactions[1];
  const malformed = fixture.transactions[2];
  const requested = [valid.tx_hash.toUpperCase(), duplicate.tx_hash, malformed.tx_hash, HASH];
  const details = availableChainTransactionDetails(requested, [
    valid, duplicate, duplicate, { ...malformed, as_json: "{" },
  ]);
  assert.equal(details.size, 1);
  assert.equal(details.get(valid.tx_hash).txType, "decommission");
  assert.equal(details.has(duplicate.tx_hash), false);
  assert.equal(details.has(malformed.tx_hash), false);
  assert.equal(details.has(HASH), false);
});

test("large transaction batches use a bounded number of hash lookups", () => {
  let hashReads = 0;
  const records = Array.from({ length: 100 }, (_, index) => {
    const hash = index.toString(16).padStart(64, "0");
    return {
      get tx_hash() { hashReads += 1; return hash; },
      size: 473, extra: { sn_state_change: { type: "decom" } },
      as_json: JSON.stringify({ type: 1, vin: [], vout: [] }),
    };
  });
  const hashes = Array.from({ length: 100 }, (_, index) => index.toString(16).padStart(64, "0"));
  const details = availableChainTransactionDetails(hashes, records);
  assert.equal(details.size, 100);
  assert.ok(hashReads <= records.length * 3, "transaction lookup work must grow linearly with batch size");
});
