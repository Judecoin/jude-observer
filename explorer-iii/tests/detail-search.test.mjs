import assert from "node:assert/strict";
import test from "node:test";
import { lookupPublicIdentifier } from "../app/explorer/detail-search.ts";

const HASH = "a".repeat(64);

function stalled(init) {
  return new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  });
}

test("a successful node search does not wait for stalled block and transaction probes", async (t) => {
  const calls = [];
  const signals = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(url);
    signals.push(init.signal);
    if (url.startsWith("/api/service-node?")) return Response.json({ publicKey: HASH });
    return stalled(init);
  });
  const result = await lookupPublicIdentifier(HASH);
  assert.equal(calls.length, 3);
  assert.equal(result.kind, "service-node");
  assert.deepEqual(await result.response.json(), { publicKey: HASH });
  assert.ok(signals[0].aborted && signals[1].aborted);
  assert.equal(signals[2].aborted, false);
});

test("all missing records produce an absent result", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  assert.equal(await lookupPublicIdentifier(HASH), null);
});

test("an unavailable endpoint is not reported as proof that a record does not exist", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => new Response("Unavailable", { status: url.startsWith("/api/transaction?") ? 503 : 404 }));
  await assert.rejects(lookupPublicIdentifier(HASH), /temporarily unavailable/);
});

test("search cancellation aborts every pending probe", async (t) => {
  const signals = [];
  t.mock.method(globalThis, "fetch", async (_, init) => {
    signals.push(init.signal);
    return stalled(init);
  });
  const controller = new AbortController();
  const result = lookupPublicIdentifier(HASH, controller.signal);
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.ok(signals.every((signal) => signal.aborted));
});

test("the request deadline releases a stalled search", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  t.mock.method(globalThis, "fetch", async (_, init) => {
    signals.push(init.signal);
    return stalled(init);
  });
  const result = lookupPublicIdentifier(HASH);
  t.mock.timers.tick(45_000);
  await assert.rejects(result, /temporarily unavailable/);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("the response body remains within the search deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (_, init) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: () => stalled(init),
  }));
  const result = lookupPublicIdentifier(HASH);
  await Promise.resolve();
  t.mock.timers.tick(45_000);
  await assert.rejects(result, /temporarily unavailable/);
});
