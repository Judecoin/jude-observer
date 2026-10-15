import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as constants from "../app/explorer/constants.ts";
import * as formatters from "../app/explorer/formatters.ts";

const source = await readFile(new URL("../app/explorer/components/ledger-tables.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const nativeRequire = createRequire(import.meta.url);
const testModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: testModule, exports: testModule.exports,
  require(specifier) {
    if (specifier === "../constants") return constants;
    if (specifier === "../formatters") return formatters;
    if (specifier === "./shared") return {};
    return nativeRequire(specifier);
  },
});
const { LedgerPagination } = testModule.exports;

function elements(tree, predicate) {
  const found = [];
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!React.isValidElement(value)) return;
    if (predicate(value)) found.push(value);
    visit(value.props.children);
  }
  visit(tree);
  return found;
}

function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ").replace(/\s+/g, " ").trim();
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.isValidElement(tree) ? text(tree.props.children) : "";
}

function only(tree, predicate) {
  const found = elements(tree, predicate);
  assert.equal(found.length, 1);
  return found[0];
}

function renderPager(label, overrides = {}) {
  const ledger = {
    data: { totalRecords: 180, position: 0, hasMore: true },
    loading: false, error: "", page: 0, pageSize: 20, totalPages: 9,
    cursor: null, canPrevious: false,
    previous() {}, next() {}, latest() {}, changePageSize() {},
    ...overrides,
  };
  const tree = LedgerPagination({ ledger, label, latestHref: label === "Blocks" ? "/blocks" : "/transactions" });
  const html = renderToStaticMarkup(tree);
  const status = only(tree, (element) => element.props.className === "page-status");
  const previous = only(tree, (element) => element.type === "button" && element.props["aria-label"] === `Previous ${label.toLowerCase()} page`);
  const next = only(tree, (element) => element.type === "button" && element.props["aria-label"] === `Next ${label.toLowerCase()} page`);
  return { tree, html, status, previous, next };
}

test("Blocks and Transactions render verified page totals and correct endpoint controls", () => {
  for (const label of ["Blocks", "Transactions"]) {
    for (const fixture of [
      { page: 0, pageSize: 20, totalPages: 9, canPrevious: false, hasMore: true },
      { page: 1, pageSize: 10, totalPages: 18, canPrevious: true, hasMore: true },
      { page: 8, pageSize: 20, totalPages: 9, canPrevious: true, hasMore: false },
    ]) {
      const { page, pageSize, totalPages, canPrevious, hasMore } = fixture;
      const rendered = renderPager(label, { page, pageSize, totalPages, canPrevious, data: { totalRecords: 180, position: page * pageSize, hasMore } });
      assert.equal(text(rendered.status), `Page ${page + 1} of ${totalPages}`);
      assert.equal(rendered.status.props["aria-label"], `${label} page ${page + 1} of ${totalPages}`);
      assert.equal(rendered.previous.props.disabled, !canPrevious);
      assert.equal(rendered.next.props.disabled, !hasMore);
      assert.ok(rendered.html.includes(`<option value="${pageSize}" selected="">${pageSize}</option>`));
    }
  }
});

test("a verified empty ledger remains one page with both directions disabled", () => {
  for (const label of ["Blocks", "Transactions"]) {
    const rendered = renderPager(label, { totalPages: 1, data: { totalRecords: 0, position: 0, hasMore: false } });
    assert.equal(text(rendered.status), "Page 1 of 1");
    assert.equal(rendered.previous.props.disabled, true);
    assert.equal(rendered.next.props.disabled, true);
    assert.doesNotMatch(rendered.html, /NaN|Infinity|Page 0|of 0/);
  }
});

test("unverified totals show loading or unavailable without inventing a page count", () => {
  for (const label of ["Blocks", "Transactions"]) {
    for (const fixture of [
      { loading: true, error: "", expected: "Awaiting data" },
      { loading: false, error: "Transaction history is unavailable", expected: "Unavailable" },
    ]) {
      const rendered = renderPager(label, { totalPages: null, data: null, ...fixture });
      assert.equal(text(rendered.status), fixture.expected);
      assert.equal(rendered.status.props["aria-live"], "polite");
      assert.doesNotMatch(text(rendered.status), /Page|\bof\b|—|NaN|Infinity/);
      assert.equal(rendered.previous.props.disabled, true);
      assert.equal(rendered.next.props.disabled, true);
    }
    const refreshing = renderPager(label, { loading: true });
    assert.equal(text(refreshing.status), "Page 1 of 9", "A refresh keeps the verified total visible");
    assert.equal(refreshing.previous.props.disabled, true);
    assert.equal(refreshing.next.props.disabled, true);
  }
});

test("enabled pager actions call their handlers and retain the original SVG and styling hooks", () => {
  for (const label of ["Blocks", "Transactions"]) {
    const calls = [];
    const rendered = renderPager(label, {
      page: 1, cursor: "older-page", canPrevious: true,
      previous: () => calls.push("previous"), next: () => calls.push("next"),
      latest: () => calls.push("latest"), changePageSize: (size) => calls.push(["size", size]),
    });
    assert.equal(rendered.previous.props.disabled, false);
    assert.equal(rendered.next.props.disabled, false);
    rendered.previous.props.onClick();
    rendered.next.props.onClick();
    const latest = only(rendered.tree, (element) => element.type === "a");
    assert.equal(latest.props.href, label === "Blocks" ? "/blocks" : "/transactions");
    latest.props.onClick({ preventDefault() { calls.push("preventDefault"); } });
    const select = only(rendered.tree, (element) => element.type === "select");
    select.props.onChange({ target: { value: "50" } });
    assert.deepEqual(calls, ["previous", "next", "preventDefault", "latest", ["size", 50]]);

    for (const className of ["table-pagination", "pager", "page-navigation", "page-status", "page-size-control", "page-size-chevron"]) {
      only(rendered.tree, (element) => element.props.className === className);
    }
    const paths = elements(rendered.tree, (element) => element.type === "path").map((element) => element.props.d);
    assert.deepEqual(paths, ["m14 6-6 6 6 6", "m10 6 6 6-6 6", "m6 9 6 6 6-6"]);
    assert.equal(text(only(rendered.tree, (element) => element.type === "label")).split(" ")[0], "Rows");
    assert.equal(elements(rendered.tree, (element) => element.props.style != null).length, 0, "Pager font and sizing stay controlled by the existing stylesheet");
  }
});
