import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../worker/page-cache.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("page-cache.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const compiled = ts.transpileModule(ast.statements.filter((node) => !ts.isImportDeclaration(node))
  .map((node) => node.getFullText(ast)).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function harness() {
  let now = Date.parse("2026-10-21T17:00:00Z"), sequence = 0, renders = 0;
  const timers = new Map(), stored = new Map(), jobs = [];
  class ClockDate extends Date { static now() { return now; } }
  const cache = { async match(request) { return stored.get(request.url)?.clone(); }, async put(request, response) { stored.set(request.url, response); } };
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, { module: testModule, exports: testModule.exports, URL, Request, Response, Headers, Date: ClockDate,
    EXPLORER_RELEASE_VERSION: "v-test", caches: { default: cache },
    setTimeout(callback, ms) { const id = ++sequence; timers.set(id, { callback, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); } });
  const ctx = { waitUntil(job) { jobs.push(job); } };
  let producer = async () => ({ response: new Response(`verified page ${renders}`, { headers: { "content-type": "text/html" } }), cacheable: true });
  return { cache, stored, jobs, get renders() { return renders; }, setProducer(fn) { producer = fn; },
    request(path = "/", headers = {}) { return testModule.exports.cachedExplorerPage(new Request(`https://explorer.test${path}`, { headers }), ctx, () => { renders++; return producer(); }); },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); } await settle(); },
  };
}

test("verified HTML displays immediately during a slow background rebuild", async () => {
  const h = harness();
  assert.equal(await (await h.request()).text(), "verified page 1");
  await Promise.all(h.jobs);
  await h.advance(5000);
  const release = gate();
  h.setProducer(async () => { await release.promise; return { response: new Response("updated", { headers: { "content-type": "text/html" } }), cacheable: true }; });
  const marker = Symbol("blocked");
  const response = await Promise.race([h.request(), settle().then(() => marker)]);
  assert.notEqual(response, marker);
  assert.equal(await response.text(), "verified page 1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("x-judecoin-page-created-at"), false);
  release.resolve(); await Promise.all(h.jobs);
  assert.equal(await (await h.request()).text(), "updated");
});

test("empty or incomplete HTML is never cached as a successful first paint", async () => {
  const h = harness();
  h.setProducer(async () => ({ response: new Response("Awaiting data", { headers: { "content-type": "text/html" } }), cacheable: false }));
  await h.request(); await h.request();
  assert.equal(h.stored.size, 0);
  assert.equal(h.renders, 2);
});

test("menu, cursor and page-size keys remain separate while query order is canonical", async () => {
  const h = harness();
  for (const path of ["/", "/statistics", "/service-nodes", "/blocks?pageSize=10", "/blocks?pageSize=50", "/transactions?pageSize=50&cursor=abc"]) await h.request(path);
  assert.equal(h.stored.size, 6);
  await h.request("/transactions?cursor=abc&pageSize=50");
  assert.equal(h.stored.size, 6);
  for (const key of h.stored.keys()) assert.ok(key.includes("/__explorer-pages/v-test/"));
});

test("HTML cache never answers server-component navigation requests", async () => {
  const h = harness();
  await h.request();
  for (const [path, headers] of [["/", { rsc: "1" }], ["/", { accept: "text/x-component" }], ["/?_rsc=token", {}]]) {
    const response = await h.request(path, headers);
    assert.notEqual(await response.text(), "verified page 1");
  }
  assert.equal(h.stored.size, 1);
});

test("expired HTML and cached error pages cannot be served as fresh verified data", async () => {
  const h = harness();
  await h.request(); await h.advance(20000);
  assert.equal(await (await h.request()).text(), "verified page 2");
  h.setProducer(async () => ({ response: new Response("unavailable", { status: 503, headers: { "content-type": "text/html" } }), cacheable: true }));
  await h.advance(20000); await h.request();
  const cached = [...h.stored.values()][0];
  assert.equal(await cached.clone().text(), "verified page 2");
});

test("blocked cache reads and writes do not block the rendered response", async () => {
  const h = harness();
  h.cache.match = () => new Promise(() => {});
  h.cache.put = () => new Promise(() => {});
  const pending = h.request();
  await settle(); await h.advance(250);
  assert.equal(await (await pending).text(), "verified page 1");
});

test("concurrent visitors share the same background render", async () => {
  const h = harness(), release = gate();
  h.setProducer(async () => { await release.promise; return { response: new Response("shared", { headers: { "content-type": "text/html" } }), cacheable: true }; });
  const a = h.request(), b = h.request(); await settle();
  assert.equal(h.renders, 1);
  release.resolve();
  assert.equal(await (await a).text(), "shared"); assert.equal(await (await b).text(), "shared");
});

test("background refresh replaces a scheduled-fork page with the verified activation result", async () => {
  const h = harness();
  h.setProducer(async () => ({ response: new Response("Activation scheduled · v16", { headers: { "content-type": "text/html" } }), cacheable: true }));
  await h.request();
  await h.advance(5000);
  h.setProducer(async () => ({ response: new Response("Pure PoS activated · v17 · saved pre-fork observation", { headers: { "content-type": "text/html" } }), cacheable: true }));
  assert.match(await (await h.request()).text(), /Activation scheduled/);
  await Promise.all(h.jobs);
  assert.match(await (await h.request()).text(), /Pure PoS activated · v17 · saved pre-fork observation/);
});
