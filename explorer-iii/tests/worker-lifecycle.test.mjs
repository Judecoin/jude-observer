import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const seed = JSON.parse(await read("../data/service-node-stake-index.json"));
const history = JSON.parse(await read("../data/deregistered-service-nodes.json"));
const workerSource = await read("../worker/index.ts");
const newKey = "e".repeat(64);
const newImage = "d".repeat(64);
const newTx = "c".repeat(64);

async function fixture() {
  const knownStake = seed.stakes[0];
  const state = {
    tip: seed.scannedThrough + 1, time: Date.now(), offline: false, rejectFirst: false, blockFailure: null,
    blacklist: [{ key_image: knownStake.keyImage, unlock_height: seed.scannedThrough + 100 }],
    calls: [],
  };
  const response = (data) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  const context = vm.createContext({
    Request, Response, URL, URLSearchParams, Headers, AbortController, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return state.time; } },
    fetch: async (input, init) => {
      if (state.offline) throw new Error("Unavailable");
      const url = new URL(input);
      state.calls.push({ host: url.hostname, path: url.pathname });
      if (url.pathname === "/get_info") return response({ status: "OK", height: state.tip + 1 });
      const body = JSON.parse(init.body);
      if (body.method === "get_block") {
        if (state.blockFailure && url.hostname === "node1.judecoin.com") return response(state.blockFailure);
        return response({ result: { status: "OK", block_header: {
          height: 100, hash: "a".repeat(64), timestamp: 1_700_000_000, num_txes: 0,
          block_size: 128, difficulty: 1000, major_version: 14,
        }, json: "{}" } });
      }
      if (url.pathname === "/get_transactions") return response({ status: "OK", txs: [{
        tx_hash: newTx, block_height: seed.scannedThrough + 1, in_pool: false,
        extra: { sn_pubkey: newKey, sn_registration: {}, locked_key_images: [newImage] },
      }] });
      if (body.method === "get_service_node_blacklisted_key_images") {
        if (state.rejectFirst && url.hostname === "node1.judecoin.com") return response({ error: { message: "Not available" } });
        return response({ result: { status: "OK", blacklist: state.blacklist } });
      }
      if (body.method === "get_block_headers_range") {
        const { start_height: start, end_height: end } = body.params;
        return response({ result: { status: "OK", headers: Array.from({ length: end - start + 1 }, (_, offset) => {
          const height = start + offset;
          const hashes = height === seed.scannedThrough + 1 ? [newTx] : [];
          return { height, hash: height.toString(16).padStart(64, "0"), num_txes: hashes.length, tx_hashes: hashes };
        }) } });
      }
      if (body.method === "get_service_nodes") return response({ result: { status: "OK", service_node_states: [] } });
      throw new Error(`Unexpected RPC method ${body.method}`);
    },
  });
  const workerUrl = new URL("../worker/index.ts", import.meta.url);
  const modules = new Map();
  const workerModule = new vm.SourceTextModule(stripTypeScriptTypes(workerSource), { context, identifier: workerUrl.href });
  modules.set(workerUrl.href, workerModule);
  await workerModule.link(async (specifier, parent) => {
    if (specifier.startsWith(".") && !specifier.endsWith(".json")) {
      const url = new URL(`${specifier}.ts`, parent.identifier);
      if (!modules.has(url.href)) {
        modules.set(url.href, readFile(url, "utf8").then((source) => (
          new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: url.href })
        )));
      }
      return modules.get(url.href);
    }
    let values;
    if (specifier.includes("deregistered-service-nodes.json")) values = { default: history };
    else if (specifier.includes("service-node-stake-index.json")) values = { default: seed };
    else if (specifier.includes("image-optimization")) values = { handleImageOptimization() {}, DEFAULT_DEVICE_SIZES: [], DEFAULT_IMAGE_SIZES: [] };
    else if (specifier.includes("app-router-entry")) values = { default: { fetch: async () => new Response("Not found", { status: 404 }) } };
    else throw new Error(`Unexpected module ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await workerModule.evaluate();
  const get = (path) => workerModule.namespace.default.fetch(new Request(`https://explorer.test${path}`), {}, { waitUntil() {} });
  return { state, get };
}

test("the Worker returns current rows without browser or edge response caching", async () => {
  const f = await fixture();
  const result = await f.get("/api/deregistered-service-nodes");
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const data = await result.json();
  assert.equal(data.total, 1);
  assert.equal(data.live, true);
  assert.notEqual(data.total, history.nodes.length);
});

test("the Worker updates the total and resolves a newly deregistered node detail", async () => {
  const f = await fixture();
  assert.equal((await (await f.get("/api/deregistered-service-nodes")).json()).total, 1);
  f.state.blacklist.push({ key_image: newImage, unlock_height: seed.scannedThrough + 200 });
  f.state.time += 31000;
  const updated = await (await f.get("/api/deregistered-service-nodes")).json();
  assert.equal(updated.total, 2);
  const result = await f.get(`/api/service-node?key=${newKey}`);
  assert.equal(result.status, 200);
  const detail = await result.json();
  assert.equal(detail.publicKey, newKey);
  assert.equal(detail.historical, true);
  assert.equal(detail.registrationHeight, seed.scannedThrough + 1);
});

test("an expired or cleared blacklist decreases the live total", async () => {
  const f = await fixture();
  await f.get("/api/deregistered-service-nodes");
  f.state.blacklist = [];
  f.state.time += 31000;
  const data = await (await f.get("/api/deregistered-service-nodes")).json();
  assert.equal(data.total, 0);
  assert.equal(data.nodes.length, 0);
});

test("a Worker outage cannot return the bundled count as live", async () => {
  const f = await fixture();
  f.state.offline = true;
  const response = await f.get("/api/deregistered-service-nodes");
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.live, false);
  assert.equal(result.total, null);
});

test("JSON RPC errors trigger failover to another configured node", async () => {
  const f = await fixture();
  f.state.rejectFirst = true;
  const response = await f.get("/api/deregistered-service-nodes");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 1);
  assert.ok(f.state.calls.some((call) => call.host === "node.judecoin.info"));
});

for (const [name, failure] of [
  ["JSON RPC error", { error: { message: "Unavailable" } }],
  ["RPC status", { status: "BUSY" }],
  ["nested RPC status", { result: { status: "BUSY" } }],
]) {
  test(`block lookup retries another node after an HTTP 200 ${name}`, async () => {
    const f = await fixture();
    f.state.blockFailure = failure;
    const response = await f.get("/api/block?id=100");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).height, 100);
    assert.ok(f.state.calls.some((call) => call.host === "node.judecoin.info"));
  });
}
