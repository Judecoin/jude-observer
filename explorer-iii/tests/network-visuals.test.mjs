import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as constants from "../app/explorer/constants.ts";
import * as model from "../app/explorer/network-visual-model.ts";
import * as formatters from "../app/explorer/formatters.ts";

const { getBlockIntervals, getIntervalPlot, quorumMemberPositions } = model;
const source = await readFile(new URL("../app/explorer/components/network-visuals.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const nativeRequire = createRequire(import.meta.url);
function loadOverview(shallow = false) {
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports,
    require(specifier) {
      if (specifier === "../constants") return constants;
      if (specifier === "../formatters") return formatters;
      if (specifier === "../network-visual-model") return model;
      if (specifier === "../constants") return constants;
      if (specifier === "react" && shallow) return { ...nativeRequire("react"), useId: () => "unit-network-overview" };
      return nativeRequire(specifier);
    },
  });
  return testModule.exports;
}
const { NetworkOverview } = loadOverview();
const { NetworkOverview: InspectNetworkOverview } = loadOverview(true);
const block = (height, timestamp) => ({ height, timestamp });
const blocks = [block(100, 1_800_000_000), block(101, 1_800_000_180), block(102, 1_800_000_420)];
const network = {
  height: 102, targetSeconds: 180, targetVerified: true, latestBlockTimestamp: 1_800_000_420,
  synced: true, difficulty: 1_000, hashrate: 10, hardFork: 16, protocol: "3",
  blockSizeMedian: 100, blockSizeLimit: 200,
};
const validators = ["a".repeat(64), "b".repeat(64)];
const workers = ["c".repeat(64), "d".repeat(64), "e".repeat(64)];
const quorum = { height: 102, validators, workers };

function props(overrides = {}) {
  return {
    network, serviceNodes: { active: 3, total: 4 },
    snapshot: { blocks, pagination: { blockPage: 0 } }, latestQuorum: quorum,
    connection: "live", blockPage: 0, openBlock() {}, openServiceNode() {},
    ...overrides,
  };
}

function elements(tree, predicate) {
  const found = [];
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    if (predicate(value)) found.push(value);
    visit(value.props?.children);
  }
  visit(tree);
  return found;
}

test("block intervals use only sorted consecutive heights and exact observed timestamps", () => {
  const input = [blocks[2], blocks[0], blocks[1]];
  const before = structuredClone(input);
  assert.deepEqual(getBlockIntervals(input), [
    { height: 101, previousHeight: 100, timestamp: 1_800_000_180, elapsedSeconds: 180 },
    { height: 102, previousHeight: 101, timestamp: 1_800_000_420, elapsedSeconds: 240 },
  ]);
  assert.deepEqual(input, before, "Normalization must not reorder the caller's snapshot");
  assert.deepEqual(getBlockIntervals([]), []);
  assert.deepEqual(getBlockIntervals([blocks[0]]), []);
});

test("gaps, invalid timestamps, and ambiguous duplicate heights never invent interval history", () => {
  assert.deepEqual(getBlockIntervals([block(100, 1000), block(102, 1360)]), []);
  assert.deepEqual(getBlockIntervals([
    block(100, 1000), block(101, 1180), block(101, 1190), block(102, 1400), block(103, 1500),
  ]), [{ height: 103, previousHeight: 102, timestamp: 1500, elapsedSeconds: 100 }]);
  for (const timestamp of [0, -1, undefined, null, NaN, Infinity, 1000.5]) {
    assert.deepEqual(getBlockIntervals([block(100, 1000), block(101, timestamp), block(102, 1360)]), [], `Invalid timestamp: ${timestamp}`);
  }
  for (const height of [-1, NaN, Infinity, 100.5]) {
    assert.deepEqual(getBlockIntervals([block(height, 1000), block(101, 1180)]), []);
  }
  assert.deepEqual(getBlockIntervals([block(100, 1000), block(101, 900)]), []);
  assert.deepEqual(getBlockIntervals([block(100, 1000), block(101, 1000)]), [
    { height: 101, previousHeight: 100, timestamp: 1000, elapsedSeconds: 0 },
  ]);
});

test("interval chart coordinates and arithmetic mean reflect samples without fake empty values", () => {
  const intervals = getBlockIntervals(blocks);
  const plot = getIntervalPlot(intervals, 180);
  assert.equal(plot.meanSeconds, 210);
  assert.equal(plot.maximumSeconds, 240);
  assert.equal(plot.targetSeconds, 180);
  assert.equal(plot.targetY, 25);
  assert.equal(plot.bars.length, 2);
  for (const bar of plot.bars) {
    for (const coordinate of [bar.x, bar.width, bar.y, bar.barHeight]) {
      assert.ok(Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 100);
    }
    assert.ok(bar.x + bar.width <= 100);
    assert.equal(bar.barHeight, (bar.elapsedSeconds / plot.maximumSeconds) * 100);
  }
  const empty = getIntervalPlot([], null);
  assert.equal(empty.meanSeconds, null);
  assert.equal(empty.targetY, null);
  assert.deepEqual(empty.bars, []);
  assert.ok(Number.isFinite(empty.maximumSeconds) && empty.maximumSeconds >= 1);
});

test("invalid target times and malformed elapsed samples cannot produce misleading chart references", () => {
  for (const target of [0, -1, NaN, Infinity, undefined, null]) {
    const plot = getIntervalPlot(getBlockIntervals(blocks), target);
    assert.equal(plot.targetSeconds, null);
    assert.equal(plot.targetY, null);
    assert.equal(plot.meanSeconds, 210);
  }
  const malformed = getIntervalPlot([
    { height: 1, previousHeight: 0, timestamp: 1000, elapsedSeconds: -1 },
    { height: 2, previousHeight: 1, timestamp: 1000, elapsedSeconds: NaN },
    { height: 3, previousHeight: 2, timestamp: 1000, elapsedSeconds: Infinity },
  ], 180);
  assert.deepEqual(malformed.bars, []);
  assert.equal(malformed.meanSeconds, null);
});

test("quorum member positions retain exactly the reported keys, roles, and counts", () => {
  for (const [keys, role] of [[validators, "validator"], [workers, "worker"], [[], "validator"]]) {
    const members = quorumMemberPositions(keys, role);
    assert.equal(members.length, keys.length);
    assert.deepEqual(members.map((member) => member.publicKey), keys);
    members.forEach((member, index) => {
      assert.equal(member.index, index);
      assert.equal(member.role, role);
      assert.ok(Number.isFinite(member.x) && member.x >= 0 && member.x <= 440);
      assert.ok(Number.isFinite(member.y) && member.y >= 0 && member.y <= 270);
    });
  }
});

test("network overview identifies historical page samples and suppresses mismatched page data", () => {
  const historical = renderToStaticMarkup(React.createElement(NetworkOverview, props({
    blockPage: 2, snapshot: { blocks, pagination: { blockPage: 2 } },
  })));
  assert.match(historical, /Selected block page/);
  assert.match(historical, /Historical consecutive block intervals/);
  assert.doesNotMatch(historical, /sample mean/);
  assert.doesNotMatch(historical, /verified intervals|Block Intervals · Seconds/);
  assert.doesNotMatch(historical, /Recent block intervals/);
  const mismatched = InspectNetworkOverview(props({ blockPage: 2 }));
  assert.equal(elements(mismatched, (element) => element.type === "button" && element.props.className?.includes("interval-bar-button")).length, 0);
  const empty = renderToStaticMarkup(React.createElement(NetworkOverview, props({
    network: null, serviceNodes: null, snapshot: null, latestQuorum: null,
  })));
  assert.match(empty, /Block intervals appear after this page is verified\./);
  assert.match(empty, /No verified membership sample/);
  assert.doesNotMatch(empty, /verified intervals|sample mean|100\.0% active|NaN|Infinity/);
});

test("every plotted bar opens its actual block and every visible quorum dot opens its reported node", () => {
  const openedBlocks = [];
  const openedNodes = [];
  const tree = InspectNetworkOverview(props({
    openBlock: (height) => openedBlocks.push(height),
    openServiceNode: (key) => openedNodes.push(key),
  }));
  const bars = elements(tree, (element) => element.type === "button" && element.props.className?.includes("interval-bar-button"));
  assert.equal(bars.length, 2);
  bars.forEach((bar) => bar.props.onClick());
  assert.deepEqual(openedBlocks, [101, 102]);
  const dots = elements(tree, (element) => element.type === "g" && element.props.className?.startsWith("orbit-member "));
  assert.equal(dots.length, validators.length + workers.length);
  dots.forEach((dot, index) => {
    const key = [...validators, ...workers][index];
    assert.ok(dot.key.includes(key));
    assert.ok(dot.props["aria-label"].includes(key));
    assert.equal(dot.props.role, "button");
    assert.equal(dot.props.tabIndex, 0);
    dot.props.onClick();
    let prevented = 0;
    for (const keyboardKey of ["Enter", " "]) dot.props.onKeyDown({ key: keyboardKey, preventDefault() { prevented += 1; } });
    dot.props.onKeyDown({ key: "Escape", preventDefault() { throw new Error("Unrelated key should not activate a node"); } });
    assert.equal(prevented, 2);
  });
  assert.deepEqual(openedNodes, [...validators, ...workers].flatMap((key) => [key, key, key]));
  const html = renderToStaticMarkup(tree);
  assert.match(html, /2 validators and 3 nodes under test/);
  assert.match(html, /75\.0% active/);
  assert.doesNotMatch(html, /geograph|peer links|geolocation|worldwide locations/i);
});

test("a chart reference line requires a verified protocol target", () => {
  const tree = InspectNetworkOverview(props({ network: { ...network, targetVerified: false } }));
  assert.equal(elements(tree, (element) => element.props?.className === "interval-target").length, 0);
});
