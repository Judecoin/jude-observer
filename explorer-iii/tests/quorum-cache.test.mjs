import assert from "node:assert/strict";
import test from "node:test";

test("isolates quorum cache tips and fails over semantic RPC errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const stored = new Map();
  const cache = {
    async match(request) {
      const response = stored.get(request instanceof Request ? request.url : String(request));
      return response?.clone();
    },
    async put(request, response) {
      stored.set(request instanceof Request ? request.url : String(request), response.clone());
    },
  };
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: cache } });

  let rpcCalls = 0;
  let semanticFailures = 0;
  const rpcCallsByNode = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.endsWith("/json_rpc")) throw new Error(`Unexpected test fetch: ${url}`);
    const payload = JSON.parse(String(init.body || "{}"));
    if (payload.method !== "get_quorum_state") throw new Error(`Unexpected RPC method: ${payload.method}`);
    rpcCalls += 1;
    const hostname = new URL(url).hostname;
    rpcCallsByNode.set(hostname, (rpcCallsByNode.get(hostname) || 0) + 1);
    if (hostname === "node1.judecoin.com") {
      semanticFailures += 1;
      return new Response(JSON.stringify({ result: { status: "BUSY", untrusted: true, quorums: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const endHeight = Number(payload.params?.end_height ?? 1000);
    const startHeight = Number(payload.params?.start_height ?? endHeight);
    const quorums = Array.from({ length: endHeight - startHeight + 1 }, (_, index) => ({
      height: startHeight + index,
      quorum: {
        validators: Array.from({ length: 10 }, (__, keyIndex) => `validator-${keyIndex}`),
        workers: Array.from({ length: 50 }, (__, keyIndex) => `worker-${keyIndex}`),
      },
    }));
    return new Response(JSON.stringify({ result: { status: "OK", untrusted: false, quorums } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("quorum-cache-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
    const background = [];
    const ctx = { waitUntil(promise) { background.push(promise); }, passThroughOnException() {} };

    const olderResponse = await worker.fetch(new Request("http://localhost/api/quorums?page=0&pageSize=5&tip=100"), env, ctx);
    const older = await olderResponse.json();
    assert.equal(olderResponse.status, 200);
    assert.equal(older.height, 100);
    assert.equal(older.records.length, 5);



    const newerResponse = await worker.fetch(new Request("http://localhost/api/quorums?page=0&pageSize=5&tip=1000"), env, ctx);
    const newer = await newerResponse.json();
    assert.equal(newerResponse.status, 200);
    assert.equal(newer.height, 1000);
    assert.equal(newer.records.length, 5);

    assert.ok(stored.has("http://localhost/api/quorums?page=0&pageSize=5&tip=100"));
    assert.ok(stored.has("http://localhost/api/quorums?page=0&pageSize=5&tip=1000"));
    assert.equal(rpcCalls, 6);

    const latestResponse = await worker.fetch(new Request("http://localhost/api/quorums?page=0&pageSize=5&latest=1"), env, ctx);
    const latest = await latestResponse.json();
    assert.equal(latestResponse.status, 200);
    assert.equal(latest.height, 1000);
    assert.equal(latest.records[0].validators.length, 10);
    assert.equal(latest.records[0].workers.length, 50);
    assert.equal(rpcCalls, 9);
    assert.equal(semanticFailures, 3);
    assert.equal(rpcCallsByNode.get("node1.judecoin.com"), 3);
    assert.equal(rpcCallsByNode.get("node.judecoin.info"), 3);
    assert.equal(rpcCallsByNode.get("67.230.167.187"), 3);

    const callsBeforeInvalidRequests = rpcCalls;
    const futureResponse = await worker.fetch(new Request("http://localhost/api/quorums?page=0&pageSize=5&tip=100000001"), env, ctx);
    assert.equal(futureResponse.status, 400);
    const malformedResponse = await worker.fetch(new Request("http://localhost/api/quorums?page=0&pageSize=5&tip=101abc"), env, ctx);
    assert.equal(malformedResponse.status, 400);
    const oversizedPageResponse = await worker.fetch(new Request("http://localhost/api/quorums?page=10001&pageSize=5&tip=1000000"), env, ctx);
    assert.equal(oversizedPageResponse.status, 400);
    const malformedPageResponse = await worker.fetch(new Request("http://localhost/api/quorums?page=1junk&pageSize=5&tip=1000"), env, ctx);
    assert.equal(malformedPageResponse.status, 400);
    const pagePastTipResponse = await worker.fetch(new Request("http://localhost/api/quorums?page=21&pageSize=5&tip=100"), env, ctx);
    assert.equal(pagePastTipResponse.status, 400);
    assert.equal(rpcCalls, callsBeforeInvalidRequests);
    assert.equal(background.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
    else delete globalThis.caches;
  }
});
