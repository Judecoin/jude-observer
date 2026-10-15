import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readProductionSource } from "./helpers/production-source.mjs";

const source = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
const compiled = ts.transpileModule(`${source}\nexport { IdentifierCell, ExplorerView, useExplorer };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const identifier = "0123456789abcdef".repeat(4);

function findElements(tree, predicate) {
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

function leafText(tree) {
  if (Array.isArray(tree)) return tree.map(leafText).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree?.props ? leafText(tree.props.children) : "";
}

function createHarness(clipboard) {
  const state = [];
  const timers = new Map();
  const clearedTimers = [];
  const listeners = new Map();
  const frames = new Map();
  let cursor = 0;
  let effects = [];
  let nextTimer = 1;
  let nextFrame = 1;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useMemo(callback) { return callback(); },
    useEffect(callback) { effects.push(callback); },
    useId() { return "unit-ui-control"; },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, console,
    navigator: { clipboard },
    window: {
      addEventListener(name, listener) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(listener);
      },
      removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
      requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
    },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); clearedTimers.push(id); },
    require(specifier) {
      if (specifier === "react") return hooks;
      if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("Fragment") };
      throw new Error(`Unexpected UI-control import: ${specifier}`);
    },
  });
  const { IdentifierCell, ExplorerView, useExplorer } = testModule.exports;
  const RenderIdentifier = () => {
    cursor = 0; effects = [];
    return IdentifierCell({ value: identifier, label: "transaction hash" });
  };
  const RenderView = (overrides = {}) => {
    cursor = 0; effects = [];
    return ExplorerView({ ...useExplorer({}), ...overrides });
  };
  return { RenderIdentifier, RenderView, timers, clearedTimers, listeners, effects: () => effects,
    flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); },
  };
}

function copyButton(tree) {
  const buttons = findElements(tree, (element) => element.type === "button" && element.props.className?.startsWith("copy-identifier"));
  assert.equal(buttons.length, 1);
  return buttons[0];
}

test("copy waits for successful clipboard writing and copies the full public identifier", async () => {
  let complete;
  const written = [];
  const harness = createHarness({ writeText(value) { written.push(value); return new Promise((resolve) => { complete = resolve; }); } });
  const initial = harness.RenderIdentifier();
  assert.equal(initial.props.title, identifier);
  assert.ok(leafText(initial).length < identifier.length, "The visible preview may be shortened");
  let stopped = 0;
  const copying = copyButton(initial).props.onClick({ stopPropagation() { stopped += 1; } });
  assert.equal(stopped, 1);
  assert.deepEqual(written, [identifier]);
  const pending = harness.RenderIdentifier();
  assert.doesNotMatch(copyButton(pending).props.className, /copied/);
  assert.doesNotMatch(leafText(pending), /copied to clipboard/);
  complete();
  await copying;
  const copied = harness.RenderIdentifier();
  assert.match(copyButton(copied).props.className, /copied/);
  assert.equal(copyButton(copied).props.title, "Copied");
  assert.match(leafText(copied), /transaction hash copied to clipboard/);
  assert.equal(harness.timers.size, 1);
  [...harness.timers.values()][0]();
  assert.doesNotMatch(copyButton(harness.RenderIdentifier()).props.className, /copied/);
});

test("clipboard rejection or unavailable browser capability never reports success", async () => {
  for (const clipboard of [{ writeText: async () => { throw new Error("Permission denied"); } }, undefined]) {
    const harness = createHarness(clipboard);
    await copyButton(harness.RenderIdentifier()).props.onClick({ stopPropagation() {} });
    const failed = harness.RenderIdentifier();
    assert.match(copyButton(failed).props.className, /unavailable/);
    assert.notEqual(copyButton(failed).props.title, "Copied");
    assert.doesNotMatch(leafText(failed), /copied to clipboard/);
    assert.match(leafText(failed), /Clipboard unavailable.*Open details to view the full transaction hash/);
  }
});

test("copy click and keyboard actions stay isolated from row detail actions and clean up timers", async () => {
  const harness = createHarness({ writeText: async () => {} });
  const initial = harness.RenderIdentifier();
  const cleanup = harness.effects()[0]();
  const button = copyButton(initial);
  let rowDetailsOpened = 0;
  let propagated = false;
  const event = () => ({ stopPropagation() { propagated = true; } });
  for (const key of ["Enter", " "]) {
    propagated = false;
    button.props.onKeyDown({ ...event(), key });
    if (!propagated) rowDetailsOpened += 1;
  }
  propagated = false;
  await button.props.onClick(event());
  if (!propagated) rowDetailsOpened += 1;
  assert.equal(rowDetailsOpened, 0);
  assert.equal(button.props.type, "button");
  assert.equal(harness.timers.size, 1);
  cleanup();
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.clearedTimers.length, 1);
});

test("identifier copy buttons remain pointer targets inside every clickable ledger row", async () => {
  const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const rowClass of ["transaction-row-link", "block-row-link", "service-node-row-link"]) {
    const inheritedPointerSuppression = rules.some(([, selector, declarations]) =>
      selector.split(",").some((part) => part.trim() === `.${rowClass} .detail-link`)
      && /(?:^|;)\s*pointer-events\s*:\s*none\b/.test(declarations));
    assert.equal(inheritedPointerSuppression, false,
      `${rowClass} must not hide the copy button from pointer hit testing`);
  }
  const copyRule = rules.filter(([, selector]) =>
    selector.split(",").some((part) => part.trim() === ".copy-identifier"))
    .map(([, , declarations]) => declarations).join(";");
  assert.match(copyRule, /(?:^|;)\s*pointer-events\s*:\s*auto\b/);
});

test("Control and Command K focus the original search after closing details and clearing inert state", () => {
  const harness = createHarness();
  const actions = [];
  const tree = harness.RenderView({ closeDetail: () => actions.push("close") });
  const inputs = findElements(tree, (element) => element.type === "input" && element.props["aria-label"] === "Search the blockchain");
  assert.equal(inputs.length, 1);
  inputs[0].props.ref.current = { focus() { actions.push("focus"); } };
  const register = harness.effects().find((effect) => effect.toString().includes("focusSearch"));
  assert.ok(register, "Missing global search shortcut effect");
  const cleanup = register();
  assert.equal(harness.listeners.get("keydown").size, 1);
  const listener = [...harness.listeners.get("keydown")][0];
  for (const modifiers of [{ ctrlKey: true, metaKey: false }, { ctrlKey: false, metaKey: true }]) {
    listener({ key: "K", ...modifiers, preventDefault() { actions.push("prevent"); } });
    harness.flushFrames();
  }
  assert.deepEqual(actions, ["prevent", "close", "focus", "prevent", "close", "focus"]);
  listener({ key: "k", ctrlKey: false, metaKey: false, preventDefault() { throw new Error("Plain K must retain normal typing"); } });
  listener({ key: "x", ctrlKey: true, metaKey: false, preventDefault() { throw new Error("Other shortcuts must remain available"); } });
  assert.equal(actions.length, 6);
  cleanup();
  assert.equal(harness.listeners.get("keydown").size, 0);

  const detailHarness = createHarness();
  const deferredActions = [];
  const closeDetail = () => deferredActions.push("close");
  const openTree = detailHarness.RenderView({
    closeDetail,
    detail: { fullPage: true, kind: "block", title: "Block Details", rows: [], sections: [] },
  });
  const originalSearch = findElements(openTree, (element) => element.type === "input" && element.props["aria-label"] === "Search the blockchain")[0];
  assert.ok(originalSearch);
  originalSearch.props.ref.current = { focus() { deferredActions.push("focus"); } };
  const openBackground = findElements(openTree, (element) => element.props?.className === "workspace-content")[0];
  assert.equal(openBackground.props.inert, true);
  const registerDeferred = detailHarness.effects().find((effect) => effect.toString().includes("focusSearch"));
  const cleanupDeferred = registerDeferred();
  [...detailHarness.listeners.get("keydown")][0]({ key: "k", ctrlKey: true, metaKey: false, preventDefault() { deferredActions.push("prevent"); } });
  detailHarness.flushFrames();
  assert.deepEqual(deferredActions, ["prevent", "close"], "Search cannot receive focus while its ancestor remains inert");
  cleanupDeferred();
  const closedTree = detailHarness.RenderView({ closeDetail, detail: null });
  const closedBackground = findElements(closedTree, (element) => element.props?.className === "workspace-content")[0];
  assert.equal(closedBackground.props.inert, undefined);
  const focusAfterRender = detailHarness.effects().find((effect) => effect.toString().includes("searchFocusRequested.current = false"));
  assert.ok(focusAfterRender);
  const cleanupFocus = focusAfterRender();
  detailHarness.flushFrames();
  assert.deepEqual(deferredActions, ["prevent", "close", "focus"]);
  if (typeof cleanupFocus === "function") cleanupFocus();
  assert.equal(detailHarness.listeners.get("keydown").size, 0);
});


test("transaction output amounts preserve confidentiality and distinguish missing values from zero", () => {
  const harness = createHarness();
  const tree = harness.RenderView({ detail: {
    title: "Transaction Details", kind: "transaction", fullPage: true, rows: [],
    outputs: [
      { index: 0, key: "a", unlockHeight: 0, confidential: false },
      { index: 1, key: "b", unlockHeight: 0, confidential: false, amount: 0 },
      { index: 2, key: "c", unlockHeight: 0, confidential: true, amount: 123000000000 },
    ],
  } });
  const rows = findElements(tree, (element) => element.props?.className === "detail-output-row");
  assert.equal(rows.length, 3);
  assert.doesNotMatch(leafText(tree), /UNLOCK TIME \/ HEIGHT/);
  assert.match(leafText(rows[0]), /Not reported/);
  assert.doesNotMatch(leafText(rows[0]), /0 JUDE/);
  assert.match(leafText(rows[1]), /0 JUDE/);
  assert.match(leafText(rows[2]), /Confidential/);
  assert.doesNotMatch(leafText(rows[2]), /123/);
});


test("detail output lock columns are shown only for real locks and empty sections are omitted", () => {
  const harness = createHarness();
  const empty = harness.RenderView({ detail: { title: "Transaction Details", kind: "transaction", fullPage: true, rows: [], outputs: [], inputs: [] } });
  assert.equal(findElements(empty, (element) => ["detail-outputs", "detail-inputs"].includes(element.props?.className)).length, 0);
  const locked = harness.RenderView({ detail: { title: "Transaction Details", kind: "transaction", fullPage: true, rows: [], outputs: [
    { index: 0, key: "a", unlockHeight: 881234, confidential: true },
    { index: 1, key: "b", unlockHeight: 0, confidential: true },
  ] } });
  assert.match(leafText(locked), /UNLOCK TIME \/ HEIGHT/);
  const rows = findElements(locked, (element) => element.props?.className === "detail-output-row");
  assert.match(leafText(rows[0]), /881,234/);
  assert.equal(leafText(rows[1]).trim().endsWith("—"), true);
});
