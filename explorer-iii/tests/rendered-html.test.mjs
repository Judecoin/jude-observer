import { readProductionSource } from "./helpers/production-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function render(path = "/", { cacheEntries = [], onUpstreamFetch } = {}) {
  const originalFetch = globalThis.fetch;
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const cache = new Map(cacheEntries);
  const jobs = [];
  const key = (request) => typeof request === "string" ? request : request.url;
  globalThis.fetch = async (...args) => {
    onUpstreamFetch?.(...args);
    throw new Error("Upstream unavailable in the isolated SSR fixture");
  };
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: {
    async match(request) { return cache.get(key(request))?.clone(); },
    async put(request, response) { cache.set(key(request), response.clone()); },
  } } });
  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil(job) { jobs.push(job); }, passThroughOnException() {} },
    );
    // Finish streamed SSR while the request's upstream/cache fixtures are active.
    const body = await response.arrayBuffer();
    await Promise.allSettled(jobs);
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
    else delete globalThis.caches;
  }
}

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceEffectContaining(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `missing source marker: ${marker}`);
  const start = source.lastIndexOf("useEffect(() => {", markerIndex);
  const nextEffect = source.indexOf("useEffect(() => {", markerIndex + marker.length);
  assert.ok(start >= 0, `missing effect containing: ${marker}`);
  return source.slice(start, nextEffect >= 0 ? nextEffect : source.length);
}

function cssRules(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@(?:import|charset)\s[^;]*;/g, "");
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selectors: match[1].split(",").map((part) => part.trim()), declarations: match[2] }));
}

function cssDeclarations(css, selector) {
  return cssRules(css)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.declarations).join(";");
}

function cssProperty(css, selector, property) {
  const declarations = cssDeclarations(css, selector);
  const values = [...declarations.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "g"))];
  const important = values.filter((match) => /!important\s*$/.test(match[1]));
  return (important.at(-1) ?? values.at(-1))?.[1].trim().replace(/!important$/, "").trim() ?? null;
}

function assertNoHiddenColumnRules(css, classes) {
  for (const rule of cssRules(css)) {
    if (!/(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/.test(rule.declarations)) continue;
    for (const selector of rule.selectors) {
      // Removing a generated label does not remove its real ledger field.
      if (/::?(?:before|after)\b/.test(selector)) continue;
      const isColumn = selector.includes(":nth-child") && classes.some((className) => selector.includes(`.${className}`));
      assert.equal(isColumn, false, `Ledger columns must remain visible: ${selector}`);
    }
  }
}

function firstHeading(html) {
  const heading = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i);
  assert.ok(heading, "Missing page title");
  return visibleText(heading[0]);
}

function sectionContainingId(html, id) {
  const marker = html.indexOf(`id="${id}"`);
  assert.ok(marker >= 0, `Missing section anchor: ${id}`);
  const start = html.lastIndexOf("<section", marker);
  assert.ok(start >= 0, `Missing section around: ${id}`);
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<\/?section\b[^>]*>/g)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, start + tag.index + tag[0].length);
  }
  assert.fail(`Unclosed section: ${id}`);
}

const fixtureHash = (value) => BigInt(value).toString(16).padStart(64, "0");
const fixtureCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const bootstrapKey = (kind, params = {}) => {
  const url = new URL(`/__explorer-bootstrap/v1/${kind}`, "http://localhost");
  url.search = new URLSearchParams(params).toString();
  return url.href;
};

function firstRenderFixture() {
  const height = 900;
  const timestamp = Math.floor(Date.now() / 1000) - 20;
  const common = { live: true, fetchedAt: new Date().toISOString(), source: "Judecoin mainnet fixture", node: "https://node.fixture" };
  const anchorHash = fixtureHash(10_000 + height);
  const nodes = Array.from({ length: 12 }, (_, index) => ({
    publicKey: fixtureHash(30_000 + index), active: true, funded: true,
    contributed: 23_600_000_000_000, requirement: 23_600_000_000_000,
    registeredAt: height - 100 - index, lastRewardAt: height - index, lastUptimeProof: timestamp,
    version: "3.2.0", unlocking: false, unlockAt: 0, contributors: 1, maxContributors: 4, operatorFee: 0,
  }));
  const serviceNodes = { ...common, height, serviceNodes: {
    total: nodes.length, active: nodes.length, funded: nodes.length, exiting: 0, decommissioned: 0,
    stakingRequirement: 23_600_000_000_000, totalContributed: nodes.length * 23_600_000_000_000,
    page: 0, pageSize: nodes.length, nodes, awaitingNodes: [], unlockingNodes: [], decommissionedNodes: [],
  } };
  const network = { ...common, network: {
    height, difficulty: 1_000, targetSeconds: 180, targetVerified: true, hashrate: 10,
    hardFork: 17, protocol: "3.2.0", txPoolSize: 0, blockSizeMedian: 400, blockSizeLimit: 200_000,
    coinbase: null, fees: null, minedSupply: 40_000_000_000_000_000, supplyHeight: height, supplySource: "fixture",
    latestBlockTimestamp: timestamp, latestBlockAgeSeconds: 20, synced: true,
  } };
  const quorums = { ...common, height, type: "Service Node Testing", quorumType: 0, trusted: true,
    page: 0, pageSize: 10, hasOlder: true, truncated: false,
    records: [{ height, validators: [nodes[0].publicKey], workers: [nodes[1].publicKey] }], unavailable: [],
  };
  const transactionPool = { available: true, fetchedAt: common.fetchedAt, count: 0, totalBytes: 0, transactions: [] };
  const cursor = (kind, pageSize, position) => fixtureCursor({
    version: kind === "transactions" ? 2 : 1, kind, anchorHeight: height, anchorHash,
    nextHeight: height - position, offset: 0,
    ...(kind === "transactions" ? { pageSize, position, totalRecords: 180 } : {}),
  });
  const ledger = (kind, pageSize, position = 0) => {
    const totalRecords = kind === "blocks" ? height + 1 : 180;
    const rows = Array.from({ length: Math.min(pageSize, totalRecords - position) }, (_, index) => {
      const rowHeight = height - position - index;
      return kind === "blocks" ? {
        height: rowHeight, timestamp: timestamp - (position + index) * 180,
        hash: fixtureHash(10_000 + rowHeight), txs: 1, size: 400, difficulty: 1_000,
        fee: 0, reward: 8_960_000_000, inputs: 0, outputs: 2,
      } : {
        hash: fixtureHash(20_000 + position + index), block: rowHeight,
        timestamp: timestamp - (position + index) * 180, size: 200, confirmations: position + index + 1,
        fee: 0, reward: 0, inputs: 2, outputs: 2, txType: "transfer",
      };
    });
    const hasMore = position + rows.length < totalRecords;
    return { ...common, height, anchorHeight: height, anchorHash, pageSize, rows,
      nextCursor: hasMore ? cursor(kind, pageSize, position + rows.length) : null, hasMore,
      scannedBlocks: rows.length, scanLimited: false, totalRecords, position,
    };
  };
  const blocks = ledger("blocks", 10);
  const transactions = ledger("transactions", 10);
  const chain = { ...network, blocks: blocks.rows, transactions: transactions.rows, transactionPool,
    pagination: { blockPage: 0, transactionPage: 0, pageSize: 10, transactionScanSize: 320 },
    serviceNodesHeight: height, serviceNodes: serviceNodes.serviceNodes, quorums,
  };
  const homeEntries = () => [
    [bootstrapKey("network"), network], [bootstrapKey("serviceNodes"), serviceNodes],
    [bootstrapKey("quorums", { pageSize: "10", latest: "1" }), quorums],
    [bootstrapKey("transactionPool"), transactionPool],
    [bootstrapKey("chain", { blockPage: "0", transactionPage: "0", blockPageSize: "10", transactionPageSize: "10" }), chain],
    [bootstrapKey("chain", { blockPage: "0", transactionPage: "0", blockPageSize: "10", transactionPageSize: "10", overview: "1" }), chain],
    [bootstrapKey("blocks", { pageSize: "10" }), blocks], [bootstrapKey("transactions", { pageSize: "10" }), transactions],
    [bootstrapKey("blocks", { pageSize: "50" }), ledger("blocks", 50)],
    [bootstrapKey("transactions", { pageSize: "50" }), ledger("transactions", 50)],
  ].map(([key, data]) => [key, Response.json(data)]);
  return { height, nodes, network, ledger, cursor, homeEntries };
}

test("the built worker renders warm mainnet data in the first homepage HTML before JavaScript", async () => {
  const fixture = firstRenderFixture();
  const fetches = [];
  const response = await render("/", { cacheEntries: fixture.homeEntries(), onUpstreamFetch: (url) => fetches.push(String(url)) });
  assert.equal(response.status, 200);
  const html = await response.text();
  const blocks = sectionContainingId(html, "blocks");
  const transactions = sectionContainingId(html, "transactions");
  const nodes = sectionContainingId(html, "home-service-nodes");
  assert.equal((blocks.match(/class="table-row block-row-link"/g) || []).length, 10);
  assert.equal((transactions.match(/class="table-row transaction-row-link"/g) || []).length, 10);
  assert.equal((nodes.match(/class="table-row service-node-row-link notranslate"/g) || []).length, 10);
  assert.match(blocks, /aria-label="Blocks page 1 of 91"/);
  assert.match(transactions, /aria-label="Transactions page 1 of 18"/);
  assert.ok(nodes.includes(fixture.nodes[0].publicKey));
  assert.ok(visibleText(html).includes(`CHAIN HEIGHT ${fixture.height}`));
  assert.doesNotMatch(visibleText(html), /Fetching|Awaiting service node data|Awaiting quorum records|Loading…/i);
  assert.deepEqual(fetches, [], "Fresh verified component caches must satisfy the initial render without RPC");
});

test("the built worker seeds standalone ledgers at 50 rows and honors each cursor and page-size query", async () => {
  for (const kind of ["blocks", "transactions"]) {
    for (const [pageSize, position] of [[50, 0], [20, 20]]) {
      const fixture = firstRenderFixture();
      const cursor = position ? fixture.cursor(kind, pageSize, position) : null;
      const params = { pageSize: String(pageSize), ...(cursor ? { cursor } : {}) };
      const data = fixture.ledger(kind, pageSize, position);
      const cacheEntries = [
        [bootstrapKey("network"), Response.json(fixture.network)],
        [bootstrapKey(kind, params), Response.json(data)],
      ];
      const query = position ? `?${new URLSearchParams({ ...params, page: "2" })}` : "";
      const fetches = [];
      const response = await render(`/${kind}${query}`, { cacheEntries, onUpstreamFetch: (url) => fetches.push(String(url)) });
      assert.equal(response.status, 200);
      const html = await response.text();
      const rowClass = kind === "blocks" ? "block" : "transaction";
      assert.equal((html.match(new RegExp(`class="table-row ${rowClass}-row-link"`, "g")) || []).length, pageSize);
      const label = kind === "blocks" ? "Blocks" : "Transactions";
      assert.ok(html.includes(`aria-label="${label} page ${position / pageSize + 1} of ${Math.ceil(data.totalRecords / pageSize)}"`));
      assert.ok(html.includes(`<option value="${pageSize}" selected="">${pageSize}</option>`));
      assert.ok(html.includes(data.rows[0].hash));
      assert.doesNotMatch(visibleText(html), /Fetching|Loading…|Unavailable/i);
      assert.deepEqual(fetches, [], `${kind} must read the component cache for its requested cursor and page size`);
    }
  }
});

test("server-renders the English-only release explorer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Judecoin Blockchain Explorer<\/title>/i);
  assert.equal(firstHeading(html), "Judecoin Blockchain Explorer");
  assert.match(html, /Latest Blocks/);
  assert.match(html, /Latest Transactions/);
  assert.match(html, /Service Node Testing Quorums/);
  assert.match(html, /Latest Service Nodes/);
  assert.equal((html.match(/class="table-pagination"/g) || []).length, 4);
  assert.doesNotMatch(html, /class="quorum-bottom-pager"/);
  assert.doesNotMatch(html, /class="language-toggle"/);
  assert.doesNotMatch(html, />中文<\/button>/);
  assert.match(html, /Page 1 of 1/);
  assert.equal((html.match(/<option value="10" selected="">10<\/option>/g) || []).length, 4);
  for (const id of ["blocks", "transactions", "home-service-nodes", "quorums"]) {
    const section = sectionContainingId(html, id);
    assert.equal((section.match(/class="table-pagination"/g) || []).length, 1, `${id} needs its own pagination`);
    assert.equal((section.match(/<option value="10" selected="">10<\/option>/g) || []).length, 1, `${id} defaults to 10 rows`);
    assert.match(section, /aria-label="Previous (?:blocks |transactions )?page"/i);
    assert.match(section, /aria-label="Next (?:blocks |transactions )?page"/i);
    assert.match(section, /aria-label="(?:Blocks |Transactions )?Rows per page"/i);
  }
  assert.doesNotMatch(html, />5<!-- --> rows<\/option>/);
  assert.match(html, /href="\/service-nodes"[^>]*aria-label="Service Nodes"/);
  assert.match(html, /href="\/statistics"[^>]*aria-label="Statistics"/);
});

test("standalone block and transaction routes provide dedicated searchable ledgers", async () => {
  for (const [path, title, tableClass] of [["/blocks", "Blocks", "blocks-table"], ["/transactions", "Transactions", "tx-table"]]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.equal(firstHeading(html), title, path);
    assert.match(html, new RegExp(`href="${path}"[^>]*aria-current="page"`));
    assert.match(html, /role="search"/);
    assert.match(html, new RegExp(tableClass));
    assert.match(html, /Rows per page/i);
    assert.equal((html.match(/<option value="50" selected="">50<\/option>/g) || []).length, 1, `${path} defaults to 50 rows`);
    assert.doesNotMatch(html, /Service Node Testing Quorums|Latest Service Nodes/);
  }
});

test("server-renders all three routes with honest empty states and no fabricated loading metrics", async () => {
  for (const path of ["/", "/service-nodes", "/statistics"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const text = visibleText(html);
    assert.doesNotMatch(text, /\bloading\b|\bN\/A\b|NaN|Infinity/i, path);
    assert.match(text, /\b0\b/, path);
  }
});

test("adds live Awaiting Contributions without a permanent loading panel", async () => {
  const [response, page, worker, css] = await Promise.all([
    render(),
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const html = await response.text();



  assert.doesNotMatch(html, /Awaiting Contributions/);
  assert.match(page, /Array\.isArray\(serviceNodes\?\.awaitingNodes\)/);
  assert.equal((page.match(/awaitingServiceNodeRows\.length > 0/g) || []).length, 2);
  assert.doesNotMatch(page, /api\/awaiting-service-nodes|Loading live awaiting-contribution data/);



  assert.match(worker, /awaitingNodes: mapAwaitingServiceNodes\(currentServiceNodeStates\)/);
  assert.match(worker, /\.filter\(\(node\) => !node\.funded\)/);
  assert.doesNotMatch(worker, /api\/awaiting-service-nodes|AWAITING_CACHE/);
  assert.match(css, /\.awaiting-live-table/);
  for (const heading of ["CONTRIBUTED (JUDE)", "STILL REQUIRED (JUDE)", "OPEN TO PUBLIC (JUDE)", "RESERVED REMAINING (JUDE)"]) {
    assert.ok(page.includes(heading), `Missing awaiting-contribution field: ${heading}`);
  }
});

test("never server-renders fabricated fallback chain data", async () => {
  const [response, page] = await Promise.all([render(), readProductionSource(new URL("../app/page.tsx", import.meta.url))]);
  const html = await response.text();
  assert.doesNotMatch(page, /fallbackBlocks|fallbackTransactions/);
  assert.doesNotMatch(html, /840164|2\.84 kH\/s|4\.82 G/);
  assert.match(html, /Fetching block records…/);
  assert.match(html, /Fetching transaction records…/);
  assert.doesNotMatch(visibleText(html), /\bloading\b|\bN\/A\b|NaN|Infinity/i);
  assert.doesNotMatch(html, /\bRPC\b/i);
  assert.match(page, /const homepageBlocks: Block\[\] = \(\(homepageBlockLedger\.data as BlocksPageSnapshot \| null\)\?\.rows \?\? \[\]\)\.map/);
  assert.match(page, /const homepageTransactions: Transaction\[\] = \(\(homepageTransactionLedger\.data as TransactionsPageSnapshot \| null\)\?\.rows \?\? \[\]\)\.map/);
  assert.match(page, /loadingMessage=\{!homepageBlockLedger\.data \? homepageBlockLedger\.error \|\| "Fetching block records…" : undefined\}/);
  assert.match(page, /loadingMessage=\{!homepageTransactionLedger\.data \? homepageTransactionLedger\.error \|\| "Fetching transaction records…"/);
});

test("renders an accurate statistics command center", async () => {
  const response = await render("/statistics");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(firstHeading(html), "Network Statistics");
  assert.doesNotMatch(html, /retrieved through read-only public Judecoin RPC endpoints/i);
  assert.match(html, /Service Node Status/);
  assert.match(html, /Service Node Staking/);
  assert.match(html, /TOTAL SERVICE NODE STAKE/);
  assert.match(html, /Recent Block Activity/);
  assert.match(html, /Chain Parameters/);
  assert.match(html, /Service Node Lifecycle/);
  assert.doesNotMatch(html, /Data Source|Chain Status/);
  assert.doesNotMatch(html, /NODE LIFECYCLE|CURRENT \+ INDEXED HISTORY|CHAIN ACTIVITY|PROTOCOL STATUS/);
  assert.doesNotMatch(html, /emission secured|Quorum trust|UNLOCKED BLOCK|Staking economy/i);
});

test("uses live current-chain Service Nodes while preserving locked deregistration history", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  assert.match(page, /statusTotal = currentServiceNodeTotal \+ lockedDeregisteredServiceNodeTotal/);
  assert.match(page, /activeServiceNodes = serviceNodes\?\.active \?\? 0/);
  assert.match(page, /serviceNodes\.total - serviceNodes\.funded/);
  assert.match(page, /\{"Unlocking · included in Active"\}/);
  assert.match(page, /\{"Awaiting contributions"\}/);
  assert.match(page, /\{"TOTAL SHOWN"\}/);
  assert.match(page, /\{"CURRENT SERVICE NODES"\}/);
  assert.match(page, /unlocking nodes remain included in Active/);
  assert.match(page, /\$\{offlineEnd\}% 100%/);
  assert.match(page, /Deregistered · Stake locked/);
});

test("uses total mined supply for the staking ratio and never fabricates 100 percent", async () => {
  const [page, worker] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
  ]);
  assert.match(page, /serviceNodes\.totalContributed \/ minedSupply/);
  assert.match(page, /% of total mined supply/);
  assert.match(page, /stakingRatio == null \? "—" : `\$\{stakingRatio\.toFixed\(2\)\}%`/);
  assert.match(page, /minedSupply == null \? "—" : atomicJude\(minedSupply\)/);
  assert.doesNotMatch(page, /fundingProgress|registered Service Node requirement/);
  assert.match(worker, /JUDECOIN_EMISSION_API/);
  assert.match(worker, /minedSupply: hasCurrentMinedSupply \? minedSupply : null/);
});

test("keeps the complete primary navigation and groups Statistics after Service Nodes", async () => {
  const [response, page] = await Promise.all([render(), readProductionSource(new URL("../app/page.tsx", import.meta.url))]);
  const html = await response.text();
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>") + 6);
  assert.match(nav, /aria-label="Primary navigation"/);
  assert.doesNotMatch(nav, /aria-label="Quorums"/);
  const destinations = ["Home", "Service Nodes", "Statistics", "Blocks", "Transactions"];
  let previous = -1;
  for (const destination of destinations) {
    const index = nav.indexOf(`aria-label="${destination}"`);
    assert.ok(index > previous, `Missing or misplaced navigation destination: ${destination}`);
    previous = index;
  }
  for (const href of ["/", "/service-nodes", "/statistics"]) assert.ok(nav.includes(`href="${href}"`));
  assert.match(nav, /aria-label="Home"[^>]*aria-current="page"/);
  for (const [route, destination] of [["/service-nodes", "Service Nodes"], ["/statistics", "Statistics"]]) {
    const routeHtml = await (await render(route)).text();
    assert.ok(new RegExp(`aria-label="${destination}"[^>]*aria-current="page"`).test(routeHtml));
  }
  assert.match(page, /<Link prefetch=\{true\}[^>]*href="\/service-nodes"/);
  assert.match(page, /<NavigationLabel>\{"Statistics"\}<\/NavigationLabel>/);
  const quorumIndex = page.indexOf('id="quorums"');
  const homeServiceNodesIndex = page.indexOf('id="home-service-nodes"');
  assert.ok(homeServiceNodesIndex >= 0 && quorumIndex > homeServiceNodesIndex);
  assert.ok(html.indexOf('id="blocks"') < html.indexOf('id="transactions"'));
  assert.ok(html.indexOf('id="transactions"') < html.indexOf('id="home-service-nodes"'));
  assert.ok(html.indexOf('id="home-service-nodes"') < html.indexOf('id="quorums"'));
  assert.match(page, /b\.lastRewardAt - a\.lastRewardAt/);
  const latestNodes = page.slice(page.indexOf("const homepageServiceNodes"), page.indexOf("useEffect", page.indexOf("const homepageServiceNodes")));
  assert.match(latestNodes, /\.slice\(homepageServiceNodePage \* homepageServiceNodePageSize/);
  assert.match(page, /homepageServiceNodePageSize, setHomepageServiceNodePageSize\] = useState\(10\)/);
  assert.match(page, /homepageServiceNodes\.map/);
  assert.match(page, /LAST REWARD BLOCK ↓/);
  assert.match(page, /Boolean\(serviceNodes\?\.decommissionedNodes\.length\)/);
});

test("preserves every network metric and keeps wide ledgers independently scrollable", async () => {
  const [page, css] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const field of ["block-size-card", "block-size-value", "block-size-limit"]) {
    assert.ok(page.includes(field), `Missing block-size field: ${field}`);
  }
  assert.match(page, /MEDIAN BLOCK WEIGHT/);
  assert.match(page, /<NetworkOverview network=\{liveNetwork\}/);
  assert.equal(cssProperty(css, ".table-card", "overflow-x"), "auto");
  assert.match(css, /@media\s*\(max-width:\s*\d+px\)/);
  assertNoHiddenColumnRules(css, ["table-head", "table-row"]);
});

test("keeps all eight network metrics in the approved visual between the original hero and ledgers", async () => {
  const [response, css] = await Promise.all([
    render(), readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const html = await response.text();
  assert.match(html, /Explore the Judecoin mainnet\./);
  assert.match(visibleText(html), /Validation without surveillance\./);
  assert.doesNotMatch(html, /class="privacy-note"/);
  const start = html.indexOf('<section class="network-overview shell');
  const end = html.indexOf("</section>", start);
  assert.ok(start >= 0 && end > start);
  const metrics = html.slice(start, end);
  const labels = [...metrics.matchAll(/<small>([\s\S]*?)<\/small>/g)].map((match) => visibleText(match[1]));
  for (const label of ["CHAIN HEIGHT", "NETWORK HASH RATE", "NETWORK DIFFICULTY", "TARGET BLOCK TIME", "LATEST BLOCK AGE", "ACTIVE SERVICE NODES", "MEDIAN BLOCK WEIGHT", "JUDE VERSION"]) {
    assert.equal(labels.filter((value) => value === label).length, 1, `Missing or duplicated network metric: ${label}`);
  }
  assert.match(metrics, /class="network-bento"/);
  assert.match(metrics, /class="chain-interval-section"/);
  assert.match(metrics, /class="quorum-orbit-visual/);
  assert.match(metrics, /Block intervals appear after this page is verified\./);
  assert.match(metrics, /No verified membership sample/);
  assert.ok(html.indexOf('class="hero shell"') < start);
  assert.ok(start < html.indexOf('id="blocks"'));
  assert.doesNotMatch(html, /class="[^"]*\b(?:nav-rail|workspace-bar)\b/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("paginates the Service Node list with 50 rows by default", async () => {
  const [response, page, worker] = await Promise.all([
    render("/service-nodes"),
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
  ]);
  const html = await response.text();
  assert.match(html, /<h2>Service Node Overview<\/h2>/);
  assert.match(html, /Search by node public key/);
  assert.match(page, /filteredServiceNodes/);
  assert.match(page, /TOTAL NODES:/);
  assert.match(page, /RESULTS:/);
  assert.doesNotMatch(page, /of \$\{compact\(snapshot\.serviceNodes\.nodes\.length\)\} nodes/);
  assert.ok(page.indexOf('className="service-node-search"') < page.indexOf('className="staking-stats"'));
  assert.match(html, /Page 1 of 1/);
  assert.match(html, /<option value="50" selected="">50<\/option>/);
  assert.match(page, /serviceNodePageSize, setServiceNodePageSize\] = useState\(50\)/);
  assert.match(page, /paginatedServiceNodes/);
  assert.match(page, /filteredServiceNodes\.slice\(serviceNodePage \* serviceNodePageSize/);
  assert.match(page, /setServiceNodePage\(0\)/);
  assert.doesNotMatch(worker, /\.slice\(serviceNodePage \* serviceNodePageSize/);
  assert.match(worker, /pageSize: currentServiceNodeStates\.length/);
  assert.match(page, /b\.lastRewardAt - a\.lastRewardAt\s*\|\| b\.registeredAt - a\.registeredAt/);
  assert.match(page, /LAST REWARD BLOCK ↓/);
  assert.match(worker, /Number\(b\.last_reward_block_height \|\| 0\) - Number\(a\.last_reward_block_height \|\| 0\)[\s\S]*Number\(b\.registration_height \|\| 0\) - Number\(a\.registration_height \|\| 0\)/);
  const serviceNodesPageStart = page.indexOf('serviceNodesOnly && <section');
  const decommissionedPanel = page.indexOf('className="decommissioned-live"', serviceNodesPageStart);
  const completeNodeTable = page.indexOf('className="table-card nodes-table"', serviceNodesPageStart);
  assert.ok(decommissionedPanel > serviceNodesPageStart && completeNodeTable > decommissionedPanel);
  assert.doesNotMatch(worker, /rank\(a\) - rank\(b\)/);
});

test("all six Service Node summaries protect unknown values and retain verified numeric zeros", async () => {
  const response = await render("/service-nodes");
  assert.equal(response.status, 200);
  const html = await response.text();
  const start = html.indexOf('<div class="staking-stats">');
  const end = html.indexOf("</div>", start);
  assert.ok(start >= 0 && end > start);
  const summary = html.slice(start, end + "</div>".length);
  const valuesFrom = (value) => [...value.matchAll(/<article(?: class="[^"]*")?><small>([^<]+)<\/small><strong class="notranslate" translate="no">([\s\S]*?)<\/strong>/g)]
    .map((match) => [match[1], visibleText(match[2])]);

  assert.deepEqual(valuesFrom(summary), [
    ["TOTAL SERVICE NODES", "—"],
    ["ACTIVE NODES", "—"],
    ["STAKING REQUIREMENT", "— JUDE"],
    ["TOTAL STAKED", "— JUDE"],
    ["UNLOCKING NODES", "—"],
    ["DECOMMISSIONED NODES", "—"],
  ]);
  assert.equal((summary.match(/class="notranslate" translate="no"/g) || []).length, 6);
  assert.doesNotMatch(visibleText(summary), /\bloading\b|\bN\/A\b|\b0\b/i);

  const source = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const compiled = ts.transpileModule(`${source}\nexport { ExplorerView };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, { module: testModule, exports: testModule.exports, require: createRequire(import.meta.url) });
  const verified = renderToStaticMarkup(React.createElement(testModule.exports.ExplorerView, {
    serviceNodesOnly: true, statisticsOnly: false, connection: "live", serviceNodeQuery: "",
    serviceNodes: { total: 0, active: 0, stakingRequirement: 0, totalContributed: 0, exiting: 0, decommissioned: 0, decommissionedNodes: [] },
    filteredServiceNodes: [], paginatedServiceNodes: [], awaitingServiceNodeRows: [],
    serviceNodePage: 0, serviceNodeLastPage: 0, serviceNodePageSize: 50,
  }));
  const verifiedStart = verified.indexOf('<div class="staking-stats">');
  const verifiedSummary = verified.slice(verifiedStart, verified.indexOf("</div>", verifiedStart) + "</div>".length);
  assert.deepEqual(valuesFrom(verifiedSummary), [
    ["TOTAL SERVICE NODES", "0"], ["ACTIVE NODES", "0"],
    ["STAKING REQUIREMENT", "0 JUDE"], ["TOTAL STAKED", "0 JUDE"],
    ["UNLOCKING NODES", "0"], ["DECOMMISSIONED NODES", "0"],
  ]);
  assert.equal((verifiedSummary.match(/class="notranslate" translate="no"/g) || []).length, 6);
});

test("paginates deregistration records at 20 rows while fetching the complete history", async () => {
  const [page, worker] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
  ]);
  assert.match(page, /deregisteredNodePageSize, setDeregisteredNodePageSize\] = useState\(20\)/);
  assert.match(page, /paginatedDeregisteredNodes/);
  assert.match(page, /deregisteredNodes\.slice\(deregisteredNodePage \* deregisteredNodePageSize/);
  assert.match(page, /deregisteredNodes\.length > 20/);
  assert.match(worker, /pageSize: deregisteredHistory\.nodes\.length/);
  assert.doesNotMatch(worker, /deregisteredNodes\.slice\(deregisteredNodePage \* deregisteredNodePageSize/);
});

test("searches blocks, transactions, and Service Node public keys", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  assert.match(page, /readPublicDetail\(`\/api\/block\?id=/);
  assert.match(page, /readPublicDetail\(`\/api\/transaction\?hash=/);
  assert.match(page, /readPublicDetail\(`\/api\/service-node\?key=/);
  assert.match(page, /#block-/);
  assert.match(page, /#tx-/);
  assert.match(page, /#node-/);
  assert.match(page, /aria-label=\{"Back"\}/);
});

test("uses live chain data, a constrained emission feed, freshness checks, and precise historical status", async () => {
  const [page, worker] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
  ]);
  assert.match(worker, /https:\/\/www\.judeblock\.net\/api\/emission/);
  assert.doesNotMatch(worker, /fetch\([^)]*judeblock\.net[^)]*\.text\(|DOMParser|querySelector/);
  assert.match(worker, /latestBlockAgeSeconds/);
  assert.match(worker, /synced: latestBlockAgeSeconds <= Math\.max\(900, targetSeconds \* 5\)/);
  assert.match(worker, /unlockingNodes:/);
  assert.match(page, /Locked until block/);
  assert.match(page, /STAKE UNLOCK HEIGHT/);
  assert.match(page, /SCHEDULED UNLOCK BLOCK/);
  assert.match(page, /BLOCKS REMAINING/);
  assert.match(page, /ESTIMATED TIME REMAINING/);
  assert.match(page, /ESTIMATED UNLOCK TIME \(UTC\)/);
  assert.match(page, /Pending Unlock/);
  assert.match(page, /Pending Unlock Service Node/);
  assert.match(page, /Staking and Scheduled Unlock/);
  assert.match(page, /Actual wall-clock timing may vary/);
  assert.doesNotMatch(page, /onClick=\{\(\) => openBlock\(node\.unlockAt\)\}/);


  assert.match(page, /if \(inputs == null && outputs == null\) return "N\/A"/);
  assert.match(page, /return `\$\{inputs \?\? "N\/A"\}\/\$\{outputs \?\? "N\/A"\}`/);
  assert.match(page, /data\.doubleSpendSeen === true \? \[{ label: "DOUBLE-SPEND FLAG", value: "Detected" }\] : \[\]/);
});

test("serves the last verified chain snapshot immediately while refreshing it in the background", async () => {
  const worker = await readProductionSource(new URL("../worker/index.ts", import.meta.url));
  assert.match(worker, /const CHAIN_CACHE_FRESH_MS = 5_000/);
  assert.match(worker, /const CHAIN_CACHE_STALE_MS = 300_000/);
  assert.match(worker, /const CHAIN_CACHE_TTL_SECONDS = 600/);
  assert.match(worker, /snapshot\.network\.height < requestedTip/);
  assert.match(worker, /cache\.match\(cacheKey\)/);
  assert.match(worker, /cache\.put\(cacheKey, stored\.clone\(\)\)/);
  assert.match(worker, /return noStoreResponse\(cached\)/);
  assert.match(worker, /ctx\.waitUntil\(refreshChainCache\(cache, cacheKey, url\)/);
  assert.match(worker, /serviceNodesHeight: null/);
  assert.match(worker, /serviceNodes: null/);
  assert.match(worker, /get_tx_hashes: true/);
  assert.match(worker, /Promise\.all\(\[[\s\S]*emissionSnapshotPromise,[\s\S]*transactionDetailsPromise,[\s\S]*legacyDetailsPromise/);
  assert.doesNotMatch(worker, /const quorumSnapshotPromise = quorumPageSnapshot/);
  assert.match(worker, /return capture\("chain", cachedChainResponse\(request, url, ctx\)\)/);
});

test("hides unavailable fields across service-node detail states", async () => {
  const [page, worker] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
  ]);
  const start = page.indexOf("function createServiceNodeDetail");
  const end = page.indexOf("function useDetails", start);
  const detail = page.slice(start, end);
  assert.match(detail, /data\.operatorAddress \? \[\{ label: "OPERATOR ADDRESS"/);
  assert.match(detail, /data\.historical \? \[\] : \[/);
  assert.match(detail, /protocolRows\.length \? \[\{ kicker: "PUBLIC NODE DATA"/);
  assert.match(detail, /const estimate = pendingUnlock && verifiedSchedule \? serviceNodeUnlockEstimate/);
  assert.match(page, /const displayedDetail = useMemo/);
  assert.doesNotMatch(detail, /Removed from current RPC state|Not retained in the current historical index|Awaiting current chain height|Awaiting network timing|Never \/ not provided|Node did not provide/);
  assert.match(worker, /publicEndpoint: node\.public_ip \? \[node\.public_ip, node\.quorumnet_port\]\.filter\(Boolean\)\.join\(":"\) : null/);
  const detailRoute = await readFile(new URL("../worker/routes/service-node.ts", import.meta.url), "utf8");
  assert.doesNotMatch(detailRoute, /publicEndpoint:.*Not published|version:.*Unknown/);
});

test("preserves authoritative transaction classification and multi-node pool validation", async () => {
  const worker = await readProductionSource(new URL("../worker/index.ts", import.meta.url));
  assert.match(worker, /function classifyTransaction/);
  assert.match(worker, /sn_state_change\?\.type/);
  assert.match(worker, /Promise\.allSettled\([\s\S]*get_transaction_pool/);
  assert.match(worker, /candidate\.height === synchronizedHeight/);
  assert.match(worker, /observation\.nodes\.length >= 2 && poolDetails\.has\(hash\)/);
  assert.doesNotMatch(worker, /rawExtra.*deregistration|extraBytes.*deregistration/i);
});

test("ships responsive metric grids and avoids machine-specific font paths", async () => {
  const [css, layout] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(cssDeclarations(css, ".metrics"), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(cssDeclarations(css, ".network-overview .network-metrics"), /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(cssProperty(css, ".network-overview .network-metrics", "grid-template-columns"), /^repeat\(2,\s*minmax\(0,\s*1fr\)\)$/);
  assert.match(cssDeclarations(css, ".nav-links"), /display:\s*(?:grid|flex)/);
  assert.equal(cssProperty(css, "body", "zoom"), "1", "The final mobile rules must neutralize the historical scaled layout");
  assert.doesNotMatch(layout, /next\/font|\/Users\//);
});

test("retains every homepage Service Node column and protects numeric metrics from translation", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const homeNodes = page.slice(page.indexOf('id="home-service-nodes"'), page.indexOf('<section className="quorum-section'));
  for (const heading of ["STATUS", "NODE PUBLIC KEY", "CONTRIBUTORS", "OPERATOR FEE (%)", "STAKE (JUDE)", "REGISTRATION HEIGHT", "LAST REWARD BLOCK ↓", "VERSION"]) {
    assert.ok(homeNodes.includes(heading), `Missing homepage Service Node heading: ${heading}`);
  }
  assert.match(page, /className="block-height notranslate" translate="no">\{network \? compact\(network\.height\) : "—"\}/);
  assert.match(page, /<NetworkOverview network=\{liveNetwork\}/);
  assert.match(page, /className="notranslate" translate="no">\{serviceNodes \? compact\(serviceNodes\.active\) : "—"\}/);
});

test("retries slow live snapshot requests without clearing previously loaded data", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  assert.match(page, /SNAPSHOT_RETRY_DELAYS_MS = \[0, 1_200, 3_000\]/);
  assert.match(page, /async function fetchSnapshotWithRetry/);
  assert.match(page, /return await fetchSnapshot\(params\)/);
  assert.match(page, /const data = overviewOnly \? await fetchSnapshot\(overviewParams\) : await fetchSnapshotWithRetry\(params, 1\)/);
  assert.match(page, /const params = snapshotParams\(\{\}, targetHeight\)/);
  assert.doesNotMatch(page, /catch[^}]*setSnapshot\(null\)/s);
});

test("keeps the complete Statistics page lifecycle information and timing explanation", async () => {
  const response = await render("/statistics");
  const text = visibleText(await response.text());
  for (const label of ["Service Node Status", "Service Node Staking", "Recent Block Activity", "Chain Parameters", "Service Node Lifecycle", "UNLOCKING", "DECOMMISSIONED", "DEREGISTRATION RECORDS"]) {
    assert.ok(text.includes(label), `Missing Statistics section: ${label}`);
  }
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  assert.match(page, /Estimates use verified unlock heights/);
  assert.match(page, /Historical schedules without a current verified lock have no expiry estimate/);
});

test("reserves space for the original fixed horizontal navigation", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.equal(cssProperty(css, ".nav", "position"), "fixed");
  assert.ok(parseFloat(cssProperty(css, "main", "padding-top")) > 0, "Page content must reserve navigation space");
  assert.doesNotMatch(css, /--rail-width|\.nav-rail|\.workspace-bar/);
  assert.ok(parseFloat(cssProperty(css, "html", "scroll-padding-top")) > 0, "Anchor scrolling needs a navigation offset");
});

test("loads fast network data and verified pool data independently", async () => {
  const [page, worker] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
  ]);
  const chainStart = worker.indexOf("async function chainSnapshot");
  const chainEnd = worker.indexOf("async function createChainResponse", chainStart);
  const chain = worker.slice(chainStart, chainEnd);

  assert.match(page, /fetchExplorerJson<NetworkPreview>\("\/api\/network", "Network overview unavailable"\)/);
  assert.match(page, /fetchExplorerJson<TransactionPoolSnapshot>\("\/api\/transaction-pool", "Transaction pool unavailable"\)/);
  assert.match(page, /const liveNetwork = !networkPreview/);
  assert.match(page, /\(isProvisionalSnapshot\(snapshot\) && !isProvisionalSnapshot\(networkPreview\)\)/);
  assert.match(page, /isProvisionalSnapshot\(snapshot\) === isProvisionalSnapshot\(networkPreview\) && isNewerHeightSnapshot\(/);
  assert.match(page, /snapshot\.network\.height, snapshot\.fetchedAt, networkPreview\.network\.height, networkPreview\.fetchedAt/);
  assert.match(page, /transactionPool\?\.available \? compact\(transactionPool\.count\) : "—"/);
  assert.match(worker, /async function networkPreviewSnapshot\(\)/);
  assert.match(worker, /async function transactionPoolSnapshot\(\)/);
  assert.match(worker, /url\.pathname === "\/api\/network"/);
  assert.match(worker, /url\.pathname === "\/api\/transaction-pool"/);
  assert.match(worker, /const NETWORK_CACHE_FRESH_MS = 3_000/);
  assert.match(worker, /const TRANSACTION_POOL_CACHE_FRESH_MS = 5_000/);
  assert.match(worker, /return capture\("network", cachedNetworkLiveResponse\(url, ctx\)\)/);
  assert.match(worker, /return capture\("transactionPool", cachedTransactionPoolLiveResponse\(url, ctx\)\)/);
  assert.match(chain, /transactionPool:\s*\{\s*available: false/);
  assert.doesNotMatch(chain, /get_transaction_pool/);
});

test("loads and preserves verified testing-quorum data independently", async () => {
  const [response, page, worker] = await Promise.all([
    render(),
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
  ]);
  const html = await response.text();
  const quorumSection = page.slice(page.indexOf('<section className="quorum-section'), page.indexOf('<section className="privacy-panel'));

  assert.match(page, /fetchExplorerJson<QuorumSnapshot>\(`\/api\/quorums\?\$\{params\}`/);
  assert.match(page, /else if \(quorumPage === 0\) params\.set\("latest", "1"\)/);
  assert.match(page, /Math\.min\(10000, Math\.floor\(liveNetwork\.height \/ quorumPageSize\)\)/);
  assert.match(page, /setQuorumLiveSnapshot/);
  const refreshStart = page.indexOf("const refreshQuorums = async");
  const refreshEnd = page.indexOf("const requestRefresh =", refreshStart);
  const refresh = page.slice(refreshStart, refreshEnd);
  const failedRefresh = refresh.slice(refresh.indexOf("} catch {"), refresh.indexOf("} finally {"));
  assert.match(failedRefresh, /nextDelay = QUORUM_REFRESH_DELAY_MS/);
  assert.doesNotMatch(failedRefresh, /setQuorumLiveSnapshot|lastVerifiedQuorumSnapshot\s*=/);
  assert.match(page, /quorumRefreshRef\.current\?\.\(\)/);
  assert.match(page, /const QUORUM_REFRESH_DELAY_MS = 5_000/);
  assert.match(quorumSection, /className="notranslate" translate="no">\{latestQuorum \? latestQuorum\.validators\.length : "—"\}/);
  assert.match(quorumSection, /className="notranslate" translate="no">\{latestQuorum \? latestQuorum\.workers\.length : "—"\}/);
  assert.match(quorumSection, /latestQuorum \? compact\(latestQuorum\.height\) : "—"/);
  assert.match(quorumSection, /quorums\?\.truncated/);
  assert.match(quorumSection, /Older quorum history exists\. Select a larger page size to reach earlier heights\./);
  assert.doesNotMatch(quorumSection, /Loading live quorum data|"N\/A"/);
  assert.match(html, /Awaiting quorum records/);

  assert.match(worker, /const QUORUM_CACHE_FRESH_MS = 15_000/);
  assert.match(worker, /const MAX_QUORUM_PAGE = 10_000/);
  assert.match(worker, /function requestedQuorumPage\(url: URL\)/);
  assert.match(worker, /truncated: quorumPage >= MAX_QUORUM_PAGE && protocolHasOlder/);
  assert.match(worker, /const MAX_QUORUM_TIP = 100_000_000/);
  assert.match(worker, /function requestedQuorumTip\(url: URL\)/);
  assert.match(worker, /Number\.isSafeInteger\(tip\)/);
  assert.match(worker, /const RPC_CACHE_MAX_ENTRIES = 200/);
  assert.match(worker, /rpcResponseCache\.size >= RPC_CACHE_MAX_ENTRIES/);
  assert.match(worker, /result\?\.status !== "OK" \|\| result\.untrusted !== false/);
  assert.match(worker, /Incomplete Judecoin testing-quorum record/);
  assert.match(worker, /Promise\.any\(JUDECOIN_RPC_NODES\.map/);
  assert.match(worker, /parsed\.records\.length === expectedCount/);
  assert.match(worker, /record\.height === expectedEndHeight - index/);
  assert.match(worker, /async function latestQuorumSnapshot/);
  assert.match(worker, /verifiedTestingQuorumRequest\(\{\}, 1\)/);
  assert.match(worker, /path: `\/api\/quorums\?page=\$\{quorumPage\}&pageSize=\$\{pageSize\}\$\{latestOnly/);
  assert.match(worker, /`&tip=\$\{requestedTip\}`/);
  assert.match(worker, /return capture\("quorums", cachedQuorumLiveResponse\(url, ctx\)\)/);
});

test("refreshes every live feed without overlapping requests or clearing good data", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  assert.match(page, /const NETWORK_REFRESH_DELAY_MS = 2_000/);
  assert.match(page, /const TRANSACTION_POOL_REFRESH_DELAY_MS = 5_000/);
  assert.match(page, /const SERVICE_NODE_REFRESH_DELAY_MS = 15_000/);
  assert.match(page, /const SERVICE_NODE_CATCH_UP_RETRY_DELAY_MS = 5_000/);
  assert.match(page, /const HIDDEN_TAB_REFRESH_DELAY_MS = 30_000/);
  assert.match(page, /window\.setTimeout\(refreshNetwork, NETWORK_REFRESH_DELAY_MS\)/);
  assert.match(page, /window\.setTimeout\(refreshTransactionPool, TRANSACTION_POOL_REFRESH_DELAY_MS\)/);
  assert.match(page, /let nextDelay = SERVICE_NODE_REFRESH_DELAY_MS/);
  assert.match(page, /window\.setTimeout\(refreshServiceNodes, delay\)/);
  assert.match(page, /nextDelay = TRANSACTION_POOL_REFRESH_DELAY_MS/);
  assert.match(page, /const endpoint = tip > 0 \? `\/api\/service-nodes-live\?tip=\$\{tip\}` : "\/api\/service-nodes-live"/);
  assert.match(page, /fetch\(endpoint, \{ cache: "no-store"/);
  assert.match(page, /data\.height < highestKnownHeightRef\.current[\s\S]*SERVICE_NODE_CATCH_UP_RETRY_DELAY_MS/);
  assert.match(page, /if \(!active \|\| inFlight\) return/);
  assert.match(page, /if \(inFlight\) \{[\s\S]*refreshQueued = true/);
  assert.match(page, /serviceNodeRefreshRef\.current = requestRefresh/);
  assert.match(page, /data\.network\.height > previousHeight\) \{[\s\S]*serviceNodeRefreshRef\.current\?\.\(\);[\s\S]*quorumRefreshRef\.current\?\.\(\);[\s\S]*\}/);
  assert.match(page, /document\.addEventListener\("visibilitychange", resume\)/);
  assert.match(page, /params\.set\("tip", String\(tip\)\)/);
  assert.match(page, /const knownChainHeight = Math\.max\(\s*isProvisionalSnapshot\(networkPreview\) \? 0 : networkPreview\?\.network\.height \?\? 0,\s*isProvisionalSnapshot\(snapshot\) \? 0 : snapshot\?\.network\.height \?\? 0,\s*isProvisionalSnapshot\(serviceNodesLive\) \? 0 : serviceNodesLive\?\.height \?\? 0,\s*\)/);
  assert.match(page, /data\.network\.height < previousHeight/);
  assert.doesNotMatch(page, /throw new Error\("Stale Service Node data"\)/);
  assert.match(page, /function isNewerHeightSnapshot/);
  assert.doesNotMatch(page, /setInterval|clearInterval|networkPreviewCache|transactionPoolCache/);
  assert.doesNotMatch(page, /setSnapshot\(null\)|setNetworkPreview\(null\)|setTransactionPoolSnapshot\(null\)|setServiceNodesLive\(null\)/);
});

test("serves one strict real-time Service Node definition with private browser caching", async () => {
  const [page, worker] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readProductionSource(new URL("../worker/index.ts", import.meta.url)),
  ]);
  const builderStart = worker.indexOf("function buildServiceNodesSnapshot");
  const builderEnd = worker.indexOf("async function serviceNodesLiveSnapshot", builderStart);
  const builder = worker.slice(builderStart, builderEnd);
  assert.match(worker, /url\.pathname === "\/api\/service-nodes-live"/);
  assert.equal((worker.match(/serviceNodes: buildServiceNodesSnapshot\(currentServiceNodeStates, topHeight\)/g) || []).length, 1);
  assert.equal((worker.match(/serviceNodes: buildServiceNodesSnapshot\(currentServiceNodeStates, serviceNodeTopHeight\)/g) || []).length, 0);
  assert.match(worker, /if \(!Array\.isArray\(serviceNodeStates\)\)/);
  assert.match(worker, /const SERVICE_NODES_CACHE_FRESH_MS = 5_000/);
  assert.match(worker, /const SERVICE_NODES_CACHE_STALE_MS = 300_000/);
  assert.match(worker, /body\.includes\('"method":"get_service_nodes"'\) \? 35_000 : 15_000/);
  assert.match(worker, /topHeight < Number\(requestedTip\)/);
  assert.match(worker, /path: "\/api\/service-nodes-live"/);
  assert.match(worker, /Promise\.any\(JUDECOIN_RPC_NODES\.map/);
  const compiledWorker = ts.transpileModule(worker, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  assert.match(compiledWorker, /Promise\.all\(\[[\s\S]*rpcFetchNode\(node, "\/get_info", undefined, 35_000\)[\s\S]*rpcFetchNode\(node, "\/json_rpc", init\)/);
  assert.match(worker, /info\?\.mainnet !== true \|\| info\?\.nettype !== "mainnet"/);
  assert.match(worker, /minimumHeight: Number\.isInteger\(requestedTip\)/);
  assert.match(worker, /createServiceNodesLiveResponse\(new URL\(url\.toString\(\)\)\)/);
  assert.match(worker, /serviceNodesHeight: null/);
  assert.match(worker, /return noStoreResponse\(stored\)/);
  assert.match(worker, /cachedServiceNodesLiveResponse\(url, ctx\)\.then\(\(response\) => attachForkArchive\(response, env, ctx\)\)/);
  assert.match(builder, /active: currentServiceNodeStates\.filter\(\(node\) => node\.active\)\.length/);
  assert.match(builder, /active: node\.active/);
  assert.doesNotMatch(builder, /Boolean\(node\.active\)|loading/i);
  assert.match(page, /const chainServiceNodesSnapshot: ServiceNodesLiveSnapshot \| null = snapshot\?\.serviceNodes && snapshot\.serviceNodesHeight != null \? \{/);
  assert.match(page, /const selectedServiceNodesSnapshot = !serviceNodesLive[\s\S]*isNewerHeightSnapshot\([\s\S]*chainServiceNodesSnapshot\.height[\s\S]*serviceNodesLive\.height/);
  assert.match(page, /const selectedNodes = selectedServiceNodesSnapshot\?\.serviceNodes \?\? null/);
  assert.match(page, /forkArchive: liveForkArchive \?\? selectedNodes\.forkArchive/);
  assert.match(page, /const serviceNodeHeight = selectedServiceNodesSnapshot\?\.height \?\? 0/);
  assert.match(page, /\{"ACTIVE SERVICE NODES"\}<\/small><strong className="notranslate" translate="no">\{serviceNodes \? compact\(serviceNodes\.active\) : "—"\}/);
  assert.doesNotMatch(page, /Loading Service Nodes|Loading live Service Node data|Loading nodes/);
  assert.doesNotMatch(page, /\b(?:active|total):\s*(?:439|440)\b|(?:activeServiceNodes|currentServiceNodeTotal|statusTotal)\s*=\s*(?:439|440)\b/);
  assert.doesNotMatch(worker, /\bactive:\s*439\b|\btotal:\s*440\b/);
});

test("selects the trusted newest complete Service Node snapshot and keeps its matching height", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const start = page.indexOf("const chainServiceNodesSnapshot:");
  const end = page.indexOf("const selectedLiveQuorums", start);
  assert.ok(start >= 0 && end > start);
  const selection = page.slice(start, end);

  assert.match(selection, /height: snapshot\.serviceNodesHeight/);
  assert.match(selection, /serviceNodes: snapshot\.serviceNodes/);
  assert.match(selection, /if \(chainServiceNodesSnapshot && isProvisionalSnapshot\(snapshot\)\) provisionalClientSnapshots\.add\(chainServiceNodesSnapshot\)/);
  assert.match(selection, /const selectedServiceNodesSnapshot = !serviceNodesLive/);
  assert.match(selection, /!chainServiceNodesSnapshot \|\| \(isProvisionalSnapshot\(chainServiceNodesSnapshot\) && !isProvisionalSnapshot\(serviceNodesLive\)\)/);
  assert.match(selection, /isProvisionalSnapshot\(chainServiceNodesSnapshot\) === isProvisionalSnapshot\(serviceNodesLive\) && isNewerHeightSnapshot\(/);
  assert.match(selection, /chainServiceNodesSnapshot\.height, chainServiceNodesSnapshot\.fetchedAt,[\s\S]*serviceNodesLive\.height, serviceNodesLive\.fetchedAt/);
  assert.match(selection, /\? serviceNodesLive : chainServiceNodesSnapshot/);
  assert.match(selection, /const selectedNodes = selectedServiceNodesSnapshot\?\.serviceNodes \?\? null/);
  assert.match(page, /const serviceNodeHeight = selectedServiceNodesSnapshot\?\.height \?\? 0/);
  assert.doesNotMatch(selection, /serviceNodesLive\?\.serviceNodes \?\? snapshot\?\.serviceNodes/);
});

test("restores only validated snapshots and never clears verified data after refresh failures", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const serviceValidatorStart = page.indexOf("function isValidServiceNodesSnapshot");
  const serviceValidatorEnd = page.indexOf("function isValidNetworkPreview", serviceValidatorStart);
  const serviceValidator = page.slice(serviceValidatorStart, serviceValidatorEnd);
  const networkValidatorStart = serviceValidatorEnd;
  const networkValidatorEnd = page.indexOf("function isValidQuorumSnapshot", networkValidatorStart);
  const networkValidator = page.slice(networkValidatorStart, networkValidatorEnd);
  const readSnapshotStart = page.indexOf("function readClientSnapshot");
  const readSnapshotEnd = page.indexOf("function writeClientSnapshot", readSnapshotStart);
  const readSnapshot = page.slice(readSnapshotStart, readSnapshotEnd);
  const fetchNetworkStart = page.indexOf("async function fetchNetworkPreview");
  const fetchNetworkEnd = page.indexOf("async function fetchTransactionPool", fetchNetworkStart);
  const fetchNetwork = page.slice(fetchNetworkStart, fetchNetworkEnd);
  const serviceRefresh = sourceEffectContaining(page, "const refreshServiceNodes = async () => {");

  assert.match(page, /const CLIENT_SNAPSHOT_MAX_CHARS = 2_500_000/);
  assert.match(page, /const CLIENT_SNAPSHOT_MAX_AGE_MS = 6 \* 60 \* 60 \* 1_000/);
  assert.match(page, /const CLIENT_SNAPSHOT_FUTURE_SKEW_MS = 60_000/);
  assert.match(page, /const CLIENT_SERVICE_NODES_SNAPSHOT_KEY = "judecoin:verified-service-nodes:v1"/);
  assert.match(readSnapshot, /window\.localStorage\.getItem\(key\)/);
  assert.match(readSnapshot, /raw\.length > CLIENT_SNAPSHOT_MAX_CHARS/);
  assert.match(readSnapshot, /if \(!validate\(parsed\)\) return null/);
  assert.match(readSnapshot, /const ageMs = Date\.now\(\) - timestamp/);
  assert.match(readSnapshot, /ageMs > CLIENT_SNAPSHOT_MAX_AGE_MS/);
  assert.match(readSnapshot, /ageMs < -CLIENT_SNAPSHOT_FUTURE_SKEW_MS/);
  assert.match(readSnapshot, /!isNonNegativeInteger\(height\) \|\| height > 100_000_000/);
  assert.match(readSnapshot, /provisionalClientSnapshots\.add\(parsed as object\)/);
  assert.match(readSnapshot, /return parsed/);
  assert.match(page, /window\.localStorage\.setItem\(key, serialized\)/);
  assert.match(serviceValidator, /snapshot\?\.live !== true/);
  assert.match(serviceValidator, /Number\.isFinite\(Date\.parse\(snapshot\.fetchedAt\)\)/);
  assert.match(serviceValidator, /counts\.every\(isNonNegativeInteger\)/);
  assert.match(serviceValidator, /nodes\.nodes\.length === nodes\.total/);
  assert.match(serviceValidator, /Array\.isArray\(nodes\.awaitingNodes\)/);
  assert.match(serviceValidator, /Array\.isArray\(nodes\.unlockingNodes\)/);
  assert.match(serviceValidator, /Array\.isArray\(nodes\.decommissionedNodes\)/);
  assert.match(networkValidator, /snapshot\?\.live === true/);
  assert.match(networkValidator, /Number\.isFinite\(Date\.parse\(snapshot\.fetchedAt\)\)/);
  assert.match(networkValidator, /isNonNegativeInteger\(snapshot\.network\?\.height\)/);
  assert.match(networkValidator, /Number\.isFinite\(snapshot\.network\?\.difficulty\)/);
  assert.match(networkValidator, /Number\.isFinite\(snapshot\.network\?\.hashrate\)/);
  assert.match(networkValidator, /snapshot\.network\?\.targetSeconds[\s\S]*snapshot\.network\?\.latestBlockTimestamp[\s\S]*snapshot\.network\?\.hardFork[\s\S]*snapshot\.network\?\.blockSizeMedian[\s\S]*snapshot\.network\?\.blockSizeLimit[\s\S]*\.every\(isNonNegativeInteger\)/);
  assert.match(networkValidator, /typeof snapshot\.network\?\.protocol === "string"/);
  assert.match(networkValidator, /typeof snapshot\.network\?\.synced === "boolean"/);
  assert.match(fetchNetwork, /fetchExplorerJson<NetworkPreview>\("\/api\/network", "Network overview unavailable"\)\.then\(\(data\) => \{\s*if \(!isValidNetworkPreview\(data\)\) throw new Error\("Invalid network overview"\)/);
  assert.match(page, /readClientSnapshot\(CLIENT_SERVICE_NODES_SNAPSHOT_KEY, isValidServiceNodesSnapshot\)/);
  assert.match(page, /const accepted = rememberServiceNodesSnapshot\(data\)/);
  assert.match(page, /if \(restoredNetwork\) setNetworkPreview\(\(current\) => current \?\? restoredNetwork\)/);
  assert.match(page, /if \(restoredServiceNodes\) setServiceNodesLive\(\(current\) => current \?\? restoredServiceNodes\)/);
  assert.match(page, /if \(restoredQuorums\) setQuorumLiveSnapshot\(\(current\) => current \?\? restoredQuorums\)/);
  assert.match(page, /setSnapshot\(\(current\) => current \?\? accepted\)/);
  assert.match(page, /setNetworkPreview\(\(current\) => !current \|\| isProvisionalSnapshot\(current\) \|\| isNewerHeightSnapshot\(/);
  assert.match(page, /setSnapshot\(\(current\) => !current \|\| isProvisionalSnapshot\(current\) \|\| shouldAcceptChainSnapshot\(current, acceptedChain\)/);
  assert.match(page, /if \(accepted\) setQuorumLiveSnapshot\(\(current\) => !current \|\| isProvisionalSnapshot\(current\)/);
  assert.ok((page.match(/setServiceNodesLive\(\(current\) => !current \|\| isProvisionalSnapshot\(current\) \|\| isNewerHeightSnapshot\(/g) || []).length >= 2);
  assert.match(serviceRefresh, /catch \{[\s\S]*Keep the last complete Service Node snapshot visible/);
  assert.doesNotMatch(serviceRefresh, /setServiceNodesLive\(null\)|setSnapshot\(null\)|removeItem/);
});

test("binds preview snapshots to their selection and home ledgers to independent pagination", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const rowsStart = page.indexOf("const blocksSelectionMatches");
  const rowsEnd = page.indexOf("const liveNetwork", rowsStart);
  assert.ok(rowsStart >= 0 && rowsEnd > rowsStart);
  const rowsSelection = page.slice(rowsStart, rowsEnd);

  assert.match(rowsSelection, /snapshot\?\.pagination\.blockPage === blockPage\s*&& snapshot\.pagination\.pageSize === blockPageSize/);
  assert.match(rowsSelection, /snapshot\?\.pagination\.transactionPage === transactionPage\s*&& snapshot\.pagination\.transactionScanSize === Math\.max\(160, transactionPageSize \* 32\)/);
  assert.match(rowsSelection, /const blocks: Block\[\] = snapshot && blocksSelectionMatches \? snapshot\.blocks\.map/);
  assert.match(rowsSelection, /const transactions: Transaction\[\] = snapshot && transactionsSelectionMatches \? snapshot\.transactions\.map/);
  assert.match(page, /const homepageBlockLedger = useLedgerRefresh\(homeOnly \? "blocks" : null, \{ scope: "home", initialData: initialData\?\.blocks \}\)/);
  assert.match(page, /const homepageTransactionLedger = useLedgerRefresh\(homeOnly \? "transactions" : null, \{ scope: "home", initialData: initialData\?\.transactions \}\)/);
  assert.match(page, /<LedgerPagination ledger=\{homepageBlockLedger\} label="Blocks" latestHref="\/#blocks"/);
  assert.match(page, /<LedgerPagination ledger=\{homepageTransactionLedger\} label="Transactions" latestHref="\/#transactions"/);
});

test("the Service Nodes-only route skips chain and transaction-pool requests", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const poolEffect = sourceEffectContaining(page, "const refreshTransactionPool = async () => {");
  const chainEffect = sourceEffectContaining(page, "const loadSnapshot = async () => {");
  const chainCatchUpEffect = sourceEffectContaining(page, "const refreshSnapshotAtTip = async () => {");
  const serviceNodeEffect = sourceEffectContaining(page, "const refreshServiceNodes = async () => {");

  assert.match(poolEffect, /if \(serviceNodesOnly\) return;/);
  assert.match(poolEffect, /fetchTransactionPool\(\)/);
  assert.match(chainEffect, /if \(serviceNodesOnly\) return;/);
  assert.match(chainEffect, /fetchSnapshotWithRetry\(params, 1\)/);
  assert.match(chainCatchUpEffect, /if \(serviceNodesOnly\) return;/);
  assert.match(chainCatchUpEffect, /snapshotParams\(\{\}, targetHeight\)/);
  assert.match(chainCatchUpEffect, /fetchSnapshotWithRetry\(params, 1\)/);
  assert.doesNotMatch(serviceNodeEffect, /if \(serviceNodesOnly\) return;/);
  assert.match(serviceNodeEffect, /\/api\/service-nodes-live/);
});

test("uses compact record rows with visible boundaries and accessible focus states", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const minimum = cssProperty(css, ".table-row", "min-height");
  assert.match(minimum ?? "", /^\d+(?:\.\d+)?px$/);
  assert.ok(parseFloat(minimum) <= 48, `Record rows should be compact: ${minimum}`);
  assert.match(cssDeclarations(css, ".table-row"), /border-(?:top|bottom)\s*:/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("keeps original navigation and the Back action available above full detail pages", async () => {
  const [page, css] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.ok(["sticky", "fixed"].includes(cssProperty(css, ".nav", "position")));
  assert.ok(Number(cssProperty(css, ".nav", "z-index")) > Number(cssProperty(css, ".detail-backdrop", "z-index")));
  assert.ok(cssProperty(css, ".detail-page-backdrop", "top"), "Detail content must reserve navigation space");
  assert.match(page, /className="detail-back-button" aria-label=\{"Back"\}/);
  assert.doesNotMatch(page, /Back to Explorer/);
});

test("keeps record values, column headers, and search text legible without restoring oversized rows", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.ok(parseFloat(cssProperty(css, ":root", "--record-table-font-size")) >= 13, "Record values should remain at least 13px");
  assert.ok(parseFloat(cssProperty(css, ".table-head", "font-size")) >= 12, "Column headers should remain at least 12px");
  assert.ok(parseFloat(cssProperty(css, ".search input", "font-size")) >= 13, "Global search text should remain legible");
  assert.ok(parseFloat(cssProperty(css, ".table-row", "min-height")) <= 48, "Regular rows must remain compact");
});

test("preserves detail identity, cryptographic input fields, and full output tables", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  for (const field of ["BLOCK HASH", "TRANSACTION HASH", "KEY IMAGE", "RING SIZE", "RING MEMBER / OUTPUT KEY", "SOURCE TX HASH", "OUTPUT KEY", "AMOUNT", "UNLOCK TIME / HEIGHT"]) {
    assert.ok(page.includes(field), `Missing detail field: ${field}`);
  }
  assert.match(page, /detail\.inputs && detail\.inputs\.length > 0 && <section className="detail-inputs"/);
  assert.match(page, /detail\.outputs && detail\.outputs\.length > 0 && <section className="detail-outputs"/);
  assert.match(page, /output\.confidential \? "Confidential"/);
  assert.match(page, /output\.amount == null \? "Not reported" : `\$\{atomicJude\(output\.amount\)\} JUDE`/);
});

test("the Statistics visual distinguishes an unknown count from verified zero and preserves actual counts", async () => {
  const response = await render("/statistics");
  const html = await response.text();
  assert.match(html, /class="network-reactor stats-orbital/);
  assert.match(html, /ACTIVE SERVICE NODES/);
  assert.match(html, /aria-label="Awaiting a verified active Service Node count"/);
  const source = await readProductionSource(new URL("../app/explorer/components/stat-network-visual.tsx", import.meta.url));
  const compiled = ts.transpileModule(`${source}\nexport { StatNetworkVisual };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, { module: testModule, exports: testModule.exports, require: createRequire(import.meta.url) });
  const { StatNetworkVisual } = testModule.exports;
  const unknown = renderToStaticMarkup(React.createElement(StatNetworkVisual, { activeCount: null, connection: "loading" }));
  assert.match(unknown, /class="notranslate" translate="no">—<\/strong>/);
  assert.doesNotMatch(unknown, /aria-label="0 active service nodes"|Reported by mainnet/);
  for (const activeCount of [0, 439]) {
    for (const connection of ["live", "offline"]) {
      const verified = renderToStaticMarkup(React.createElement(StatNetworkVisual, { activeCount, connection }));
      assert.ok(verified.includes(`aria-label="${activeCount} active service nodes"`));
      assert.ok(verified.includes(`class="notranslate" translate="no">${activeCount}</strong>`));
      assert.ok(verified.includes(connection === "live" ? "Reported by mainnet" : "Last verified snapshot"));
      assert.match(verified, /<svg[^>]*aria-hidden="true"/);
    }
  }
});

test("omits the internal global output index from visitor-facing detail tables", async () => {
  const [page, css] = await Promise.all([
    readProductionSource(new URL("../app/page.tsx", import.meta.url)),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const outputTable = page.slice(page.indexOf('detail.outputs && detail.outputs.length > 0 && <section className="detail-outputs"'), page.indexOf("</section>}", page.indexOf('detail.outputs && detail.outputs.length > 0 && <section className="detail-outputs"')));
  assert.doesNotMatch(outputTable, /GLOBAL INDEX|output\.globalIndex/);
  assert.match(outputTable, /OUTPUT KEY/);
  assert.match(outputTable, /AMOUNT/);
  assert.match(outputTable, /UNLOCK TIME \/ HEIGHT/);
  assert.ok(cssProperty(css, ".detail-output-head", "grid-template-columns"));
});

test("uses clear, consistent titles across every detail page state", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  assert.doesNotMatch(page, /title: `Block \$\{compact\(data\.height\)\}`/);
  assert.match(page, /title: "Block Details", kind: "block"/);
  assert.match(page, /title: "Transaction Details", kind: "transaction"/);
  assert.match(page, /"Deregistered Service Node Details"/);
  assert.match(page, /"Pending Unlock Service Node Details"/);
  assert.match(page, /"Service Node Details"/);
  assert.match(page, /Show Raw Block Data/);
  assert.match(page, /Show Raw Transaction Data/);
  assert.match(page, /Show Raw Service Node Data/);
});

test("opens every Transactions table row as Transaction Details", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const tables = await readFile(new URL("../app/explorer/components/ledger-tables.tsx", import.meta.url), "utf8");
  const transactionSection = tables.slice(tables.indexOf("export function TransactionRecords"));
  assert.match(page, /<TransactionRecords transactions=\{homepageTransactions\} openTransaction=\{openTransaction\}/);
  assert.match(transactionSection, /className="table-row transaction-row-link"/);
  assert.match(transactionSection, /aria-label=\{`Open transaction \$\{tx\.hash\}`\}/);
  assert.match(transactionSection, /onClick=\{\(\) => openTransaction\(tx\.hash, tx\.txType\)\}/);
  assert.doesNotMatch(transactionSection, /openBlock\(tx\.block\)/);
  assert.match(transactionSection, /<span className="height">/);
});

test("opens every Blocks table row as Block Details", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const tables = await readFile(new URL("../app/explorer/components/ledger-tables.tsx", import.meta.url), "utf8");
  const blocksSection = tables.slice(tables.indexOf("export function BlockRecords"), tables.indexOf("export function TransactionRecords"));
  assert.match(page, /<BlockRecords blocks=\{homepageBlocks\} openBlock=\{openBlock\}/);
  assert.match(blocksSection, /className="table-row block-row-link"/);
  assert.match(blocksSection, /role="button" tabIndex=\{0\} aria-label=\{`Open block/);
  assert.match(blocksSection, /onClick=\{\(\) => openBlock\(block\.height\)\}/);
  assert.doesNotMatch(blocksSection, /<button className="height detail-link"/);
  assert.doesNotMatch(blocksSection, /<button className="block-hash detail-link"/);
});

test("opens every Service Node ledger row as Service Node Details", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const serviceNodePage = page.slice(page.indexOf("{serviceNodesOnly &&"), page.indexOf("<section className=\"staking home-service-nodes", page.indexOf("{serviceNodesOnly &&")));
  const homepageNodes = page.slice(page.indexOf("home-service-nodes"), page.indexOf("<section className=\"quorum-section", page.indexOf("home-service-nodes")));
  assert.match(serviceNodePage, /className="table-row service-node-row-link notranslate" translate="no"/);
  assert.match(homepageNodes, /className="table-row service-node-row-link notranslate" translate="no"/);
  assert.match(serviceNodePage, /role="button" tabIndex=\{0\} aria-label=\{`Open Service Node/);
  assert.match(homepageNodes, /onClick=\{\(\) => openServiceNode\(node\.publicKey\)\}/);
  assert.doesNotMatch(serviceNodePage, /<button className="node-key detail-link"/);
  assert.doesNotMatch(homepageNodes, /<button className="node-key detail-link"/);
});

test("keeps block-reward records out of Transaction Details", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const start = page.indexOf("async function openTransaction");
  const end = page.indexOf("async function openServiceNode", start);
  const transactionDetail = page.slice(start, end);
  assert.match(transactionDetail, /title: "Transaction Details"/);
  assert.match(transactionDetail, /outputTitle: "Transaction Outputs"/);
  assert.match(transactionDetail, /TRANSACTION HASH/);
  assert.match(transactionDetail, /FEE RATE \(JUDE\/kB\)/);
  assert.doesNotMatch(transactionDetail, /Block Reward Transaction|BLOCK REWARD|SERVICE NODE WINNER|minerTransaction/);
});

test("uses the complete quorum summary row to expand its matrix", async () => {
  const page = await readProductionSource(new URL("../app/page.tsx", import.meta.url));
  const start = page.indexOf('<div className="quorum-ledger">');
  const end = page.indexOf("</section>", start);
  const quorumLedger = page.slice(start, end);
  assert.match(quorumLedger, /<summary>/);
  assert.match(quorumLedger, /<span className="block-height quorum-height">\{compact\(record\.height\)\}<\/span>/);
  assert.doesNotMatch(quorumLedger, /openBlock\(record\.height\)/);
  assert.match(quorumLedger, /className="expand-label">\{"EXPAND MATRIX →"\}/);
  assert.match(quorumLedger, /className="collapse-label">\{"COLLAPSE MATRIX ↑"\}/);
  assert.match(quorumLedger, /record\.validators\.map\([\s\S]*?onClick=\{\(\) => openServiceNode\(key\)\}/);
  assert.match(quorumLedger, /record\.workers\.map\([\s\S]*?onClick=\{\(\) => openServiceNode\(key\)\}/);
});

test("retains column grids across all current and historical ledgers", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const table of ["blocks-table", "tx-table", "pool-table", "nodes-table", "awaiting-live-table", "decommissioned-live-table", "deregistered-table", "unlock-detail-table", "decommission-detail-table"]) {
    assert.ok(cssProperty(css, `.${table} .table-row`, "grid-template-columns"), `Missing column grid for ${table}`);
  }
});

test("preserves all columns and uses local scrolling for detailed cryptographic ledgers", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.ok(cssProperty(css, ".detail-output-head", "grid-template-columns"));
  assert.ok(cssProperty(css, ".ring-head", "grid-template-columns"));
  assert.match(cssDeclarations(css, ".detail-output-table"), /overflow-x\s*:\s*auto/);
  assert.match(cssDeclarations(css, ".ring-members"), /overflow-x\s*:\s*auto/);
  assertNoHiddenColumnRules(css, ["detail-output-head", "detail-output-row", "ring-head", "ring-row"]);
});
