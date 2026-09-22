import assert from "node:assert/strict";
import test from "node:test";

const STAKING_REQUIREMENT = 23_600_000_000_000;

function serviceNode(index, { active = true, funded = true } = {}) {
  return {
    service_node_pubkey: index.toString(16).padStart(64, "0"),
    active,
    funded,
    staking_requirement: STAKING_REQUIREMENT,
    total_contributed: funded ? STAKING_REQUIREMENT : STAKING_REQUIREMENT / 2,
    registration_height: 500 + index,
    last_reward_block_height: 900 + index,
    last_uptime_proof: 1_700_000_000 + index,
    service_node_version: [1, 2, 3],
    requested_unlock_height: 0,
    contributors: [],
    portions_for_operator: 0,
    decommission_count: 0,
    earned_downtime_blocks: 0,
  };
}

function serviceNodes(count, inactiveIndex = -1) {
  return Array.from({ length: count }, (_, index) => serviceNode(index, {
    active: index !== inactiveIndex,
    funded: index !== inactiveIndex,
  }));
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}

async function withServiceNodeWorker(initialState, run) {
  const originalFetch = globalThis.fetch;
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const originalDateNow = Date.now;
  const stored = new Map();
  const state = {
    topHeight: initialState.topHeight,
    nodes: initialState.nodes,
    rpcDown: false,
  };
  let now = 1_000_000;

  const cache = {
    async match(request) {
      const key = request instanceof Request ? request.url : String(request);
      return stored.get(key)?.clone();
    },
    async put(request, response) {
      const key = request instanceof Request ? request.url : String(request);
      stored.set(key, response.clone());
    },
  };

  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: cache },
  });
  Date.now = () => now;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.hostname.endsWith("judecoin.com")
      && url.hostname !== "node.judecoin.info"
      && url.hostname !== "67.230.167.187") {
      throw new Error(`Unexpected test fetch: ${url}`);
    }
    if (state.rpcDown) throw new Error("Judecoin RPC unavailable");

    if (url.pathname === "/get_info") {
      return jsonResponse({
        status: "OK",
        mainnet: true,
        nettype: "mainnet",
        height: state.topHeight + 1,
      });
    }

    const payload = JSON.parse(String(init.body || "{}"));
    if (url.pathname === "/json_rpc" && payload.method === "get_service_nodes") {
      return jsonResponse({
        result: {
          status: "OK",
          service_node_states: state.nodes,
        },
      });
    }
    throw new Error(`Unexpected test RPC: ${url.pathname} ${payload.method || ""}`);
  };

  const background = [];
  const ctx = {
    waitUntil(promise) {
      background.push(Promise.resolve(promise));
    },
    passThroughOnException() {},
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set(
      "service-node-cache-test",
      `${process.pid}-${originalDateNow()}-${Math.random()}`,
    );
    const { default: worker } = await import(workerUrl.href);
    const env = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    };
    await run({
      worker,
      env,
      ctx,
      background,
      state,
      advance(milliseconds) {
        now += milliseconds;
      },
    });
  } finally {
    await Promise.allSettled(background);
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
    else delete globalThis.caches;
  }
}

async function fetchServiceNodes(worker, env, ctx, tip) {
  const response = await worker.fetch(
    new Request(`http://localhost/api/service-nodes-live?tip=${tip}`),
    env,
    ctx,
  );
  return { response, data: await response.json() };
}

test("reports all 439 RPC-active Service Nodes without an off-by-one loss", async () => {
  await withServiceNodeWorker({ topHeight: 1_000, nodes: serviceNodes(439) }, async ({ worker, env, ctx }) => {
    const { response, data } = await fetchServiceNodes(worker, env, ctx, 1_000);

    assert.equal(response.status, 200);
    assert.equal(data.live, true);
    assert.equal(data.height, 1_000);
    assert.equal(data.serviceNodes.total, 439);
    assert.equal(data.serviceNodes.active, 439);
    assert.equal(data.serviceNodes.funded, 439);
    assert.equal(data.serviceNodes.nodes.length, 439);
    assert.equal(data.serviceNodes.awaitingNodes.length, 0);
    assert.equal(
      data.serviceNodes.active,
      data.serviceNodes.nodes.filter((node) => node.active).length,
    );
  });
});

test("distinguishes 439 registered nodes from 438 active plus one awaiting contribution", async () => {
  await withServiceNodeWorker({ topHeight: 1_000, nodes: serviceNodes(439, 438) }, async ({ worker, env, ctx }) => {
    const { response, data } = await fetchServiceNodes(worker, env, ctx, 1_000);

    assert.equal(response.status, 200);
    assert.equal(data.serviceNodes.total, 439);
    assert.equal(data.serviceNodes.active, 438);
    assert.equal(data.serviceNodes.funded, 438);
    assert.equal(data.serviceNodes.nodes.length, 439);
    assert.equal(data.serviceNodes.awaitingNodes.length, 1);
    assert.equal(data.serviceNodes.total - data.serviceNodes.funded, 1);
    assert.equal(
      data.serviceNodes.active,
      data.serviceNodes.nodes.filter((node) => node.active).length,
    );
    assert.equal(
      data.serviceNodes.funded,
      data.serviceNodes.nodes.filter((node) => node.funded).length,
    );
    assert.equal(data.serviceNodes.awaitingNodes[0].publicKey, (438).toString(16).padStart(64, "0"));
  });
});

test("synchronously replaces a cached 438-node snapshot when the requested tip has 439", async () => {
  await withServiceNodeWorker({ topHeight: 1_000, nodes: serviceNodes(438) }, async ({
    worker, env, ctx, state, advance,
  }) => {
    const first = await fetchServiceNodes(worker, env, ctx, 1_000);
    assert.equal(first.response.status, 200);
    assert.equal(first.data.height, 1_000);
    assert.equal(first.data.serviceNodes.active, 438);




    advance(6_001);
    state.topHeight = 1_001;
    state.nodes = serviceNodes(439);

    const current = await fetchServiceNodes(worker, env, ctx, 1_001);
    assert.equal(current.response.status, 200);
    assert.equal(current.data.height, 1_001);
    assert.equal(current.data.serviceNodes.total, 439);
    assert.equal(current.data.serviceNodes.active, 439);
    assert.equal(current.data.serviceNodes.nodes.length, 439);
  });
});

test("returns the last verified Service Node snapshot when every RPC refresh fails", async () => {
  await withServiceNodeWorker({ topHeight: 1_000, nodes: serviceNodes(439) }, async ({
    worker, env, ctx, state, advance,
  }) => {
    const verified = await fetchServiceNodes(worker, env, ctx, 1_000);
    assert.equal(verified.response.status, 200);
    assert.equal(verified.data.serviceNodes.active, 439);

    advance(6_001);
    state.rpcDown = true;

    const fallback = await fetchServiceNodes(worker, env, ctx, 1_001);
    assert.equal(fallback.response.status, 200);
    assert.equal(fallback.data.live, true);
    assert.equal(fallback.data.height, 1_000);
    assert.equal(fallback.data.serviceNodes.total, 439);
    assert.equal(fallback.data.serviceNodes.active, 439);
    assert.equal(fallback.data.serviceNodes.nodes.length, 439);
  });
});
