import assert from "node:assert/strict";
import test from "node:test";

const bridge = await import("../worker/bootstrap-context.ts");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const seed = (name) => ({ fetchedAt: "2026-10-15T12:00:00.000Z", requestMarker: name });

test("bootstrap data is absent outside its request and synchronous completion restores the caller", () => {
  assert.equal(bridge.readExplorerBootstrap(), undefined);
  const initial = seed("one");
  const result = bridge.runWithExplorerBootstrap(initial, () => {
    assert.equal(bridge.readExplorerBootstrap(), initial);
    return "rendered";
  });
  assert.equal(result, "rendered");
  assert.equal(bridge.readExplorerBootstrap(), undefined);
});

test("concurrent asynchronous page renders keep their own bootstrap after interleaved waits", async () => {
  const seeds = [seed("home"), seed("transactions"), seed("statistics")];
  const started = seeds.map(deferred);
  const release = seeds.map(deferred);
  const finished = [];
  const renders = seeds.map((initial, index) => bridge.runWithExplorerBootstrap(initial, async () => {
    assert.equal(bridge.readExplorerBootstrap(), initial);
    started[index].resolve();
    await release[index].promise;
    assert.equal(bridge.readExplorerBootstrap(), initial);
    await Promise.resolve();
    assert.equal(bridge.readExplorerBootstrap(), initial);
    finished.push(initial.requestMarker);
    return initial;
  }));
  await Promise.all(started.map((entry) => entry.promise));
  assert.equal(bridge.readExplorerBootstrap(), undefined);
  for (const index of [2, 0, 1]) {
    release[index].resolve();
    assert.equal(await renders[index], seeds[index]);
    assert.equal(bridge.readExplorerBootstrap(), undefined);
  }
  assert.deepEqual(finished, ["statistics", "home", "transactions"]);
});

test("nested renders restore the outer request after an asynchronous inner render", async () => {
  const outer = seed("outer");
  const inner = seed("inner");
  await bridge.runWithExplorerBootstrap(outer, async () => {
    assert.equal(bridge.readExplorerBootstrap(), outer);
    await bridge.runWithExplorerBootstrap(inner, async () => {
      await Promise.resolve();
      assert.equal(bridge.readExplorerBootstrap(), inner);
    });
    assert.equal(bridge.readExplorerBootstrap(), outer);
  });
  assert.equal(bridge.readExplorerBootstrap(), undefined);
});

test("a thrown or rejected render cannot leak its bootstrap into the next request", async () => {
  assert.throws(() => bridge.runWithExplorerBootstrap(seed("throws"), () => {
    throw new Error("render failed");
  }), /render failed/);
  assert.equal(bridge.readExplorerBootstrap(), undefined);
  await assert.rejects(bridge.runWithExplorerBootstrap(seed("rejects"), async () => {
    await Promise.resolve();
    throw new Error("async render failed");
  }), /async render failed/);
  assert.equal(bridge.readExplorerBootstrap(), undefined);
  const next = seed("next");
  await bridge.runWithExplorerBootstrap(next, async () => {
    await Promise.resolve();
    assert.equal(bridge.readExplorerBootstrap(), next);
  });
  assert.equal(bridge.readExplorerBootstrap(), undefined);
});

test("separate module instances share the request bridge while keeping concurrent requests isolated", async () => {
  const other = await import("../worker/bootstrap-context.ts?separate-rsc-instance");
  const first = seed("worker");
  const second = seed("rsc");
  const releaseFirst = deferred();
  const releaseSecond = deferred();
  const a = bridge.runWithExplorerBootstrap(first, async () => {
    assert.equal(other.readExplorerBootstrap(), first);
    await releaseFirst.promise;
    assert.equal(other.readExplorerBootstrap(), first);
  });
  const b = other.runWithExplorerBootstrap(second, async () => {
    assert.equal(bridge.readExplorerBootstrap(), second);
    await releaseSecond.promise;
    assert.equal(bridge.readExplorerBootstrap(), second);
  });
  assert.equal(bridge.readExplorerBootstrap(), undefined);
  assert.equal(other.readExplorerBootstrap(), undefined);
  releaseSecond.resolve();
  await b;
  releaseFirst.resolve();
  await a;
  assert.equal(bridge.readExplorerBootstrap(), undefined);
  assert.equal(other.readExplorerBootstrap(), undefined);
});
