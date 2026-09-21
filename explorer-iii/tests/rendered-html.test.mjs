import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
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

test("server-renders the English-only release explorer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Judecoin Blockchain Explorer<\/title>/i);
  assert.match(html, /See the chain/);
  assert.match(html, /Latest Blocks/);
  assert.match(html, /Latest Transactions/);
  assert.match(html, /Service Node Testing Quorums/);
  assert.match(html, /Latest Service Nodes/);
  assert.match(html, /class="quorum-bottom-pager"/);
  assert.doesNotMatch(html, /class="language-toggle"/);
  assert.doesNotMatch(html, />中文<\/button>/);
  assert.match(html, /Page 1 of 1/);
  assert.match(html, /<option value="5" selected="">5<\/option>/);
  assert.doesNotMatch(html, />5<!-- --> rows<\/option>/);
  assert.match(html, /href="\/service-nodes">Service Nodes/);
  assert.match(html, /href="\/statistics">Statistics/);
});

test("server-renders all three routes with numeric zero states and no visible loading placeholders", async () => {
  for (const path of ["/", "/service-nodes", "/statistics"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const text = visibleText(html);
    assert.doesNotMatch(text, /\bloading\b|\bN\/A\b|—/i, path);
    assert.match(text, /\b0\b/, path);
  }
});

test("adds live Awaiting Contributions without a permanent loading panel", async () => {
  const [response, page, worker, css] = await Promise.all([
    render(),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
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
  assert.match(css, /\.awaiting-live-table \.table-head,[\s\S]*min-width:1910px;[\s\S]*column-gap:16px/);
  assert.match(css, /\.awaiting-live-table \.table-head \{[\s\S]*min-height:72px/);
});

test("never server-renders fabricated fallback chain data", async () => {
  const [response, page] = await Promise.all([render(), readFile(new URL("../app/page.tsx", import.meta.url), "utf8")]);
  const html = await response.text();
  assert.doesNotMatch(page, /fallbackBlocks|fallbackTransactions/);
  assert.doesNotMatch(html, /840164|2\.84 kH\/s|4\.82 G/);
  assert.match(html, /0 BLOCK RECORDS/);
  assert.match(html, /0 TRANSACTION RECORDS/);
  assert.doesNotMatch(visibleText(html), /\bloading\b|\bN\/A\b|—/i);
  assert.doesNotMatch(html, /\bRPC\b/i);
  assert.match(page, /const blocks: Block\[\] = snapshot && blocksSelectionMatches \? snapshot\.blocks\.map/);
  assert.match(page, /const transactions: Transaction\[\] = snapshot && transactionsSelectionMatches \? snapshot\.transactions\.map/);
  assert.match(page, /\{\(!snapshot \|\| !blocksSelectionMatches\) && <div className="nodes-loading notranslate" translate="no">\{"0 BLOCK RECORDS · No verified snapshot for this page yet"\}<\/div>\}/);
  assert.match(page, /\{\(!snapshot \|\| !transactionsSelectionMatches\) && <div className="nodes-loading notranslate" translate="no">\{"0 TRANSACTION RECORDS · No verified snapshot for this page yet"\}<\/div>\}/);
});

test("renders an accurate statistics command center", async () => {
  const response = await render("/statistics");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Judecoin network,/);
  assert.match(html, /Explore Judecoin blocks, transactions, Service Nodes, staking, and network activity in one place\./);
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /statusTotal = currentServiceNodeTotal \+ lockedDeregisteredServiceNodeTotal/);
  assert.match(page, /activeServiceNodes = serviceNodes\?\.active \?\? 0/);
  assert.match(page, /serviceNodes\.total - serviceNodes\.funded/);
  assert.match(page, /\{"Unlocking · included in Active"\}/);
  assert.match(page, /\{"Awaiting contributions"\}/);
  assert.match(page, /\{"TOTAL SHOWN"\}/);
  assert.match(page, /\{"CURRENT SERVICE NODES"\}/);
  assert.match(page, /unlocking nodes remain included in Active/);
  assert.match(page, /#ef677b \$\{offlineEnd\}% 100%/);
  assert.match(page, /Deregistered · Stake locked/);
});

test("uses total mined supply for the staking ratio and never fabricates 100 percent", async () => {
  const [page, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /serviceNodes\.totalContributed \/ minedSupply/);
  assert.match(page, /% of total mined supply/);
  assert.match(page, /\(stakingRatio \?\? 0\)\.toFixed\(2\)/);
  assert.match(page, /minedSupply \? atomicJude\(minedSupply\) : "0"/);
  assert.doesNotMatch(page, /fundingProgress|registered Service Node requirement/);
  assert.match(worker, /JUDECOIN_EMISSION_API/);
  assert.match(worker, /minedSupply: hasCurrentMinedSupply \? minedSupply : null/);
});

test("keeps the complete primary navigation and groups Statistics after Service Nodes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const nav = page.slice(page.indexOf('<div className="nav-links">'), page.indexOf("</div>", page.indexOf('<div className="nav-links">')));
  assert.match(nav, /Home/);
  assert.match(nav, /Blocks/);
  assert.match(nav, /Transactions/);
  assert.match(nav, /Service Nodes/);
  assert.match(nav, /Statistics/);
  assert.match(nav, /Quorums/);
  assert.match(nav, /<a className=\{serviceNodesOnly \? "active" : undefined\} href="\/service-nodes">/);
  assert.match(nav, /<a className=\{statisticsOnly \? "active" : undefined\} href="\/statistics">/);
  assert.ok(nav.indexOf("Home") < nav.indexOf("Service Nodes"));
  assert.ok(nav.indexOf("Service Nodes") < nav.indexOf("Statistics"));
  assert.ok(nav.indexOf("Statistics") < nav.indexOf("Blocks"));
  assert.ok(nav.indexOf("Blocks") < nav.indexOf("Transactions"));
  assert.ok(nav.indexOf("Transactions") < nav.indexOf("Quorums"));
  assert.doesNotMatch(page, /import Link from "next\/link"/);
  const quorumIndex = page.indexOf('id="quorums"');
  const homeServiceNodesIndex = page.indexOf('id="home-service-nodes"');
  assert.ok(quorumIndex >= 0 && homeServiceNodesIndex > quorumIndex);
  assert.match(page, /b\.lastRewardAt - a\.lastRewardAt/);
  assert.match(page, /\.slice\(0, 5\)/);
  assert.match(page, /homepageServiceNodes\.map/);
  assert.match(page, /LAST REWARD BLOCK ↓/);
  assert.match(page, /Boolean\(serviceNodes\?\.decommissionedNodes\.length\)/);
  assert.match(page, /This panel is hidden automatically when all nodes return to service/);
});

test("keeps the phone layout contained and readable", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const mobileAuthority = css.slice(css.indexOf("/* Mobile layout authority."));
  assert.ok(mobileAuthority.length > 0);
  assert.match(page, /className="block-size-card"/);
  assert.match(page, /className="block-size-value notranslate" translate="no"/);
  assert.match(page, /className="block-size-ratio"/);
  assert.match(page, /className="block-size-limit"/);
  assert.match(page, /className="block-size-caption"/);
  assert.match(page, /Median \/ protocol limit/);
  assert.match(page, /liveNetwork\.blockSizeMedian \/ liveNetwork\.blockSizeLimit/);
  assert.match(css, /\.metrics \.block-size-ratio \{/);
  assert.match(mobileAuthority, /\.nav::before[\s\S]*background:rgba\(3,10,8,\.985\)!important/);
  assert.match(mobileAuthority, /\.decommissioned-live-heading[\s\S]*grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(mobileAuthority, /\.decommissioned-live-table[\s\S]*overflow-x:auto!important/);
  assert.match(mobileAuthority, /grid-template-areas:[\s\S]*"index height validators"[\s\S]*"workers workers toggle"!important/);
  assert.match(mobileAuthority, /\.tx-type-legend-items[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(mobileAuthority, /\.tx-table \.table-head,[\s\S]*min-width:1160px!important/);
  assert.match(mobileAuthority, /\.nodes-table \.table-head,[\s\S]*min-width:1630px!important/);
  assert.match(mobileAuthority, /\.table-card \.table-head > :first-child,[\s\S]*position:static!important/);
});

test("makes the homepage telemetry animation clearly visible", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.hero::before \{[\s\S]*hero-radar-pulse/);
  assert.match(css, /\.hero::after \{[\s\S]*hero-sweep/);
  assert.match(css, /\.particle-field i \{[\s\S]*hero-particle-drift/);
  assert.match(css, /@keyframes ambient-one-drift/);
  assert.match(css, /@keyframes ambient-two-drift/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
});

test("paginates the Service Node list with 50 rows by default", async () => {
  const [response, page, worker] = await Promise.all([
    render("/service-nodes"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  const html = await response.text();
  assert.match(html, /Service Node Overview/);
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

test("server-renders all six Service Node summaries as protected numeric zeros", async () => {
  const response = await render("/service-nodes");
  assert.equal(response.status, 200);
  const html = await response.text();
  const start = html.indexOf('<div class="staking-stats">');
  const end = html.indexOf("</div>", start);
  assert.ok(start >= 0 && end > start);
  const summary = html.slice(start, end + "</div>".length);
  const values = [...summary.matchAll(/<article(?: class="[^"]*")?><small>([^<]+)<\/small><strong class="notranslate" translate="no">([\s\S]*?)<\/strong>/g)]
    .map((match) => [match[1], visibleText(match[2])]);

  assert.deepEqual(values, [
    ["TOTAL SERVICE NODES", "0"],
    ["ACTIVE NODES", "0"],
    ["STAKING REQUIREMENT", "0 JUDE"],
    ["TOTAL STAKED", "0 JUDE"],
    ["UNLOCKING NODES", "0"],
    ["DECOMMISSIONED NODES", "0"],
  ]);
  assert.equal((summary.match(/class="notranslate" translate="no"/g) || []).length, 6);
  assert.doesNotMatch(visibleText(summary), /\bloading\b|\bN\/A\b|—/i);
});

test("paginates deregistration records at 20 rows while fetching the complete history", async () => {
  const [page, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /deregisteredNodePageSize, setDeregisteredNodePageSize\] = useState\(20\)/);
  assert.match(page, /paginatedDeregisteredNodes/);
  assert.match(page, /deregisteredNodes\.slice\(deregisteredNodePage \* deregisteredNodePageSize/);
  assert.match(page, /deregisteredNodes\.length > 20/);
  assert.match(worker, /pageSize: deregisteredHistory\.nodes\.length/);
  assert.doesNotMatch(worker, /deregisteredNodes\.slice\(deregisteredNodePage \* deregisteredNodePageSize/);
});

test("searches blocks, transactions, and Service Node public keys", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /fetch\(`\/api\/block\?id=/);
  assert.match(page, /fetch\(`\/api\/transaction\?hash=/);
  assert.match(page, /fetch\(`\/api\/service-node\?key=/);
  assert.match(page, /#block-/);
  assert.match(page, /#tx-/);
  assert.match(page, /#node-/);
  assert.match(page, /aria-label=\{"Back"\}/);
});

test("uses live chain data, a constrained emission feed, freshness checks, and precise historical status", async () => {
  const [page, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
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
  assert.match(page, /Not detected/);
});

test("serves the last verified chain snapshot immediately while refreshing it in the background", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /const CHAIN_CACHE_FRESH_MS = 5_000/);
  assert.match(worker, /const CHAIN_CACHE_STALE_MS = 300_000/);
  assert.match(worker, /const CHAIN_CACHE_TTL_SECONDS = 600/);
  assert.match(worker, /snapshot\.network\.height < requestedTip/);
  assert.match(worker, /cache\.match\(cacheKey\)/);
  assert.match(worker, /cache\.put\(cacheKey, stored\.clone\(\)\)/);
  assert.match(worker, /return noStoreResponse\(cached\)/);
  assert.match(worker, /ctx\.waitUntil\(refreshChainCache\(cache, cacheKey, url\)/);
  assert.match(worker, /const serviceNodesResponsePromise = serviceNodeStatesRequest\(topHeight\)/);
  assert.match(worker, /get_tx_hashes: true/);
  assert.match(worker, /Promise\.all\(\[[\s\S]*serviceNodesResponsePromise,[\s\S]*latestBlockDetailsPromise,[\s\S]*transactionDetailsPromise/);
  assert.match(worker, /const quorumSnapshotPromise = quorumPageSnapshot/);
  assert.match(worker, /return cachedChainResponse\(request, url, ctx\)/);
});

test("hides unavailable fields across service-node detail states", async () => {
  const [page, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  const start = page.indexOf("async function openServiceNode");
  const end = page.indexOf("async function search", start);
  const detail = page.slice(start, end);
  assert.match(detail, /data\.operatorAddress \? \[\{ label: "OPERATOR ADDRESS"/);
  assert.match(detail, /data\.historical \? \[\] : \[/);
  assert.match(detail, /protocolRows\.length \? \[\{ kicker: "PUBLIC NODE DATA"/);
  assert.match(detail, /\.\.\.\(serviceNodeHeight > 0 && liveNetwork \? \[/);
  assert.doesNotMatch(detail, /Removed from current RPC state|Not retained in the current historical index|Awaiting current chain height|Awaiting network timing|Never \/ not provided|Node did not provide/);
  assert.match(worker, /publicEndpoint: node\.public_ip \? \[node\.public_ip, node\.quorumnet_port\]\.filter\(Boolean\)\.join\(":"\) : null/);
  assert.doesNotMatch(worker, /publicEndpoint:.*Not published|version:.*Unknown/);
});

test("preserves authoritative transaction classification and multi-node pool validation", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /function classifyTransaction/);
  assert.match(worker, /sn_state_change\?\.type/);
  assert.match(worker, /Promise\.allSettled\([\s\S]*get_transaction_pool/);
  assert.match(worker, /candidate\.height === synchronizedHeight/);
  assert.match(worker, /observation\.nodes\.length >= 2 && poolDetails\.has\(hash\)/);
  assert.doesNotMatch(worker, /rawExtra.*deregistration|extraBytes.*deregistration/i);
});

test("ships a real responsive phone layout and no local font paths", async () => {
  const [css, layout] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /body\{width:auto!important;max-width:100%!important;overflow-x:hidden!important;font-size:16px!important;zoom:1!important\}/);
  assert.match(css, /\.metrics\s*\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(css, /\.nav-links\{display:flex!important;order:3!important;width:100%!important/);
  assert.match(css, /\.table-card\{width:100%!important;max-width:100%!important;overflow-x:auto!important\}/);
  assert.doesNotMatch(layout, /next\/font|\/Users\//);
});

test("keeps final telemetry labels readable and homepage node headers complete", async () => {
  const [css, page] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.chain-pulse-panel>header>span\{[^}]*font-size:12px/);
  assert.match(css, /\.pulse-footer\{[^}]*font-size:12px/);
  assert.match(css, /\.home-service-nodes \.nodes-table \.table-head\{[^}]*min-height:72px/);
  assert.match(css, /\.home-service-nodes \.nodes-table \.table-head>\*\{overflow:visible;text-overflow:clip;white-space:normal/);
  assert.match(css, /\.metrics article > span\.trend,[\s\S]*color:#59f0b7!important/);
  assert.match(css, /\.metrics article > span\.warning,[\s\S]*color:#f2bf66!important/);
  assert.match(css, /\.metrics article > span\.offline,[\s\S]*color:#ff858b!important/);
  assert.match(page, /className="block-height notranslate" translate="no">\{liveNetwork \? compact\(liveNetwork\.height\) : "0"\}/);
  assert.match(page, /className="notranslate" translate="no">\{compact\(serviceNodes\?\.active \?\? 0\)\}/);
});

test("retries slow live snapshot requests without clearing previously loaded data", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /SNAPSHOT_RETRY_DELAYS_MS = \[0, 1_200, 3_000\]/);
  assert.match(page, /async function fetchSnapshotWithRetry/);
  assert.match(page, /return await fetchSnapshot\(params\)/);
  assert.match(page, /const data = await fetchSnapshotWithRetry\(snapshotParams\(\)\)/);
  assert.match(page, /const data = await fetchSnapshotWithRetry\(snapshotParams\(\{\}, targetHeight\)\)/);
  assert.doesNotMatch(page, /catch[^}]*setSnapshot\(null\)/s);
});

test("keeps the complete Statistics page typography readable", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.statistics-page \.unlock-estimate-note\{[^}]*font-size:14px;line-height:1\.65/);
  assert.match(css, /\.statistics-page \.status-ledger dt\{font-size:14px\}/);
  assert.match(css, /\.statistics-page \.stake-mini-grid span\{font-size:12\.5px/);
  assert.match(css, /\.statistics-page \.lifecycle-grid span\{font-size:13px/);
  assert.match(css, /\.statistics-page \.protocol-panel dt\{font-size:12\.5px/);
  assert.match(css, /\.statistics-page \.pulse-tooltip b,\.statistics-page \.pulse-tooltip em\{font-size:10px\}/);
});

test("keeps the primary navigation fixed without covering page content", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /main\{padding-top:92px\}/);
  assert.match(css, /\.nav\{\s*position:fixed;\s*top:0;\s*left:50%;/);
  assert.match(css, /transform:translateX\(-50%\)/);
});

test("loads fast network data and verified pool data independently", async () => {
  const [page, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  const chainStart = worker.indexOf("async function chainSnapshot");
  const chainEnd = worker.indexOf("async function createChainResponse", chainStart);
  const chain = worker.slice(chainStart, chainEnd);

  assert.match(page, /fetch\("\/api\/network", \{ cache: "no-store" \}\)/);
  assert.match(page, /fetch\("\/api\/transaction-pool", \{ cache: "no-store" \}\)/);
  assert.match(page, /const liveNetwork = !networkPreview/);
  assert.match(page, /\(isProvisionalSnapshot\(snapshot\) && !isProvisionalSnapshot\(networkPreview\)\)/);
  assert.match(page, /isProvisionalSnapshot\(snapshot\) === isProvisionalSnapshot\(networkPreview\) && isNewerHeightSnapshot\(/);
  assert.match(page, /snapshot\.network\.height, snapshot\.fetchedAt, networkPreview\.network\.height, networkPreview\.fetchedAt/);
  assert.match(page, /compact\(transactionPool\?\.available \? transactionPool\.count : 0\)/);
  assert.match(worker, /async function networkPreviewSnapshot\(\)/);
  assert.match(worker, /async function transactionPoolSnapshot\(\)/);
  assert.match(worker, /url\.pathname === "\/api\/network"/);
  assert.match(worker, /url\.pathname === "\/api\/transaction-pool"/);
  assert.match(worker, /const NETWORK_CACHE_FRESH_MS = 3_000/);
  assert.match(worker, /const TRANSACTION_POOL_CACHE_FRESH_MS = 5_000/);
  assert.match(worker, /return cachedNetworkLiveResponse\(url, ctx\)/);
  assert.match(worker, /return cachedTransactionPoolLiveResponse\(url, ctx\)/);
  assert.match(chain, /transactionPool:\s*\{\s*available: false/);
  assert.doesNotMatch(chain, /get_transaction_pool/);
});

test("loads and preserves verified testing-quorum data independently", async () => {
  const [response, page, worker] = await Promise.all([
    render(),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  const html = await response.text();
  const quorumSection = page.slice(page.indexOf('<section className="quorum-section'), page.indexOf('<section className="staking home-service-nodes'));

  assert.match(page, /fetch\(`\/api\/quorums\?\$\{params\}`/);
  assert.match(page, /else if \(quorumPage === 0\) params\.set\("latest", "1"\)/);
  assert.match(page, /Math\.min\(10000, Math\.floor\(liveNetwork\.height \/ quorumPageSize\)\)/);
  assert.match(page, /setQuorumLiveSnapshot/);
  assert.match(page, /Never replace the last verified quorum with an empty or failed read/);
  assert.match(page, /quorumRefreshRef\.current\?\.\(\)/);
  assert.match(page, /const QUORUM_REFRESH_DELAY_MS = 5_000/);
  assert.match(quorumSection, /className="notranslate" translate="no">\{latestQuorum\?\.validators\.length \?\? 0\}/);
  assert.match(quorumSection, /latestQuorum \? compact\(latestQuorum\.height\) : "0"/);
  assert.match(quorumSection, /quorums\?\.truncated/);
  assert.match(quorumSection, /Older quorum history exists\. Select a larger page size to reach earlier heights\./);
  assert.doesNotMatch(quorumSection, /Loading live quorum data|"N\/A"/);
  assert.match(html, /0 QUORUM RECORDS/);

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
  assert.match(worker, /return cachedQuorumLiveResponse\(url, ctx\)/);
});

test("refreshes every live feed without overlapping requests or clearing good data", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  const builderStart = worker.indexOf("function buildServiceNodesSnapshot");
  const builderEnd = worker.indexOf("async function serviceNodesLiveSnapshot", builderStart);
  const builder = worker.slice(builderStart, builderEnd);
  assert.match(worker, /url\.pathname === "\/api\/service-nodes-live"/);
  assert.equal((worker.match(/serviceNodes: buildServiceNodesSnapshot\(currentServiceNodeStates, topHeight\)/g) || []).length, 1);
  assert.equal((worker.match(/serviceNodes: buildServiceNodesSnapshot\(currentServiceNodeStates, serviceNodeTopHeight\)/g) || []).length, 1);
  assert.match(worker, /if \(!Array\.isArray\(serviceNodeStates\)\)/);
  assert.match(worker, /const SERVICE_NODES_CACHE_FRESH_MS = 5_000/);
  assert.match(worker, /const SERVICE_NODES_CACHE_STALE_MS = 300_000/);
  assert.match(worker, /body\.includes\('"method":"get_service_nodes"'\) \? 35_000 : 15_000/);
  assert.match(worker, /topHeight < Number\(requestedTip\)/);
  assert.match(worker, /path: "\/api\/service-nodes-live"/);
  assert.match(worker, /Promise\.any\(JUDECOIN_RPC_NODES\.map/);
  assert.match(worker, /Promise\.all\(\[[\s\S]*rpcFetchNode\(node, "\/get_info", undefined, 35_000\)[\s\S]*rpcFetchNode\(node, "\/json_rpc", init\)/);
  assert.match(worker, /info\?\.mainnet !== true \|\| info\?\.nettype !== "mainnet"/);
  assert.match(worker, /minimumHeight: Number\.isInteger\(requestedTip\)/);
  assert.match(worker, /createServiceNodesLiveResponse\(new URL\(url\.toString\(\)\)\)/);
  assert.match(worker, /serviceNodesHeight: serviceNodeTopHeight/);
  assert.match(worker, /return noStoreResponse\(stored\)/);
  assert.match(worker, /return cachedServiceNodesLiveResponse\(url, ctx\)/);
  assert.match(builder, /active: currentServiceNodeStates\.filter\(\(node\) => node\.active\)\.length/);
  assert.match(builder, /active: node\.active/);
  assert.doesNotMatch(builder, /Boolean\(node\.active\)|loading/i);
  assert.match(page, /const chainServiceNodesSnapshot: ServiceNodesLiveSnapshot \| null = snapshot \? \{/);
  assert.match(page, /const selectedServiceNodesSnapshot = !serviceNodesLive[\s\S]*isNewerHeightSnapshot\([\s\S]*chainServiceNodesSnapshot\.height[\s\S]*serviceNodesLive\.height/);
  assert.match(page, /const serviceNodes = selectedServiceNodesSnapshot\?\.serviceNodes \?\? null/);
  assert.match(page, /const serviceNodeHeight = selectedServiceNodesSnapshot\?\.height \?\? 0/);
  assert.match(page, /compact\(serviceNodes\?\.active \?\? 0\)[\s\S]*\{"Active on mainnet"\}/);
  assert.doesNotMatch(page, /Loading Service Nodes|Loading live Service Node data|Loading nodes/);
  assert.doesNotMatch(page, /\b439\b|\b440\b/);
  assert.doesNotMatch(worker, /\bactive:\s*439\b|\btotal:\s*440\b/);
});

test("selects the trusted newest complete Service Node snapshot and keeps its matching height", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  assert.match(selection, /const serviceNodes = selectedServiceNodesSnapshot\?\.serviceNodes \?\? null/);
  assert.match(page, /const serviceNodeHeight = selectedServiceNodesSnapshot\?\.height \?\? 0/);
  assert.doesNotMatch(selection, /serviceNodesLive\?\.serviceNodes \?\? snapshot\?\.serviceNodes/);
});

test("restores only validated snapshots and never clears verified data after refresh failures", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  assert.match(fetchNetwork, /const data = await response\.json\(\) as NetworkPreview;\s*if \(!isValidNetworkPreview\(data\)\) throw new Error\("Invalid network overview"\)/);
  assert.match(page, /readClientSnapshot\(CLIENT_SERVICE_NODES_SNAPSHOT_KEY, isValidServiceNodesSnapshot\)/);
  assert.match(page, /const accepted = rememberServiceNodesSnapshot\(data\)/);
  assert.match(page, /if \(restoredNetwork\) setNetworkPreview\(\(current\) => current \?\? restoredNetwork\)/);
  assert.match(page, /if \(restoredServiceNodes\) setServiceNodesLive\(\(current\) => current \?\? restoredServiceNodes\)/);
  assert.match(page, /if \(restoredQuorums\) setQuorumLiveSnapshot\(\(current\) => current \?\? restoredQuorums\)/);
  assert.match(page, /setSnapshot\(\(current\) => current \?\? accepted\)/);
  assert.match(page, /setNetworkPreview\(\(current\) => !current \|\| isProvisionalSnapshot\(current\) \|\| isNewerHeightSnapshot\(/);
  assert.match(page, /if \(!current \|\| isProvisionalSnapshot\(current\)\) return acceptedChain/);
  assert.match(page, /if \(accepted\) setQuorumLiveSnapshot\(\(current\) => !current \|\| isProvisionalSnapshot\(current\)/);
  assert.ok((page.match(/setServiceNodesLive\(\(current\) => !current \|\| isProvisionalSnapshot\(current\) \|\| isNewerHeightSnapshot\(/g) || []).length >= 3);
  assert.match(serviceRefresh, /catch \{[\s\S]*Keep the last complete Service Node snapshot visible/);
  assert.doesNotMatch(serviceRefresh, /setServiceNodesLive\(null\)|setSnapshot\(null\)|removeItem/);
});

test("binds block and transaction rows to the requested pagination selection", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const rowsStart = page.indexOf("const blocksSelectionMatches");
  const rowsEnd = page.indexOf("const particles", rowsStart);
  assert.ok(rowsStart >= 0 && rowsEnd > rowsStart);
  const rowsSelection = page.slice(rowsStart, rowsEnd);

  assert.match(rowsSelection, /snapshot\?\.pagination\.blockPage === blockPage\s*&& snapshot\.pagination\.pageSize === blockPageSize/);
  assert.match(rowsSelection, /snapshot\?\.pagination\.transactionPage === transactionPage\s*&& snapshot\.pagination\.transactionScanSize === Math\.max\(160, transactionPageSize \* 32\)/);
  assert.match(rowsSelection, /const blocks: Block\[\] = snapshot && blocksSelectionMatches \? snapshot\.blocks\.map/);
  assert.match(rowsSelection, /const transactions: Transaction\[\] = snapshot && transactionsSelectionMatches \? snapshot\.transactions\.map/);
  assert.match(page, /\{\(!snapshot \|\| !blocksSelectionMatches\) && <div className="nodes-loading notranslate" translate="no">\{"0 BLOCK RECORDS · No verified snapshot for this page yet"\}<\/div>\}/);
  assert.match(page, /\{\(!snapshot \|\| !transactionsSelectionMatches\) && <div className="nodes-loading notranslate" translate="no">\{"0 TRANSACTION RECORDS · No verified snapshot for this page yet"\}<\/div>\}/);
});

test("the Service Nodes-only route skips chain and transaction-pool requests", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const poolEffect = sourceEffectContaining(page, "const refreshTransactionPool = async () => {");
  const chainEffect = sourceEffectContaining(page, "const loadSnapshot = async () => {");
  const chainCatchUpEffect = sourceEffectContaining(page, "const refreshSnapshotAtTip = async () => {");
  const serviceNodeEffect = sourceEffectContaining(page, "const refreshServiceNodes = async () => {");

  assert.match(poolEffect, /if \(serviceNodesOnly\) return;/);
  assert.match(poolEffect, /fetchTransactionPool\(\)/);
  assert.match(chainEffect, /if \(serviceNodesOnly\) return;/);
  assert.match(chainEffect, /fetchSnapshotWithRetry\(snapshotParams\(\)\)/);
  assert.match(chainCatchUpEffect, /if \(serviceNodesOnly\) return;/);
  assert.match(chainCatchUpEffect, /fetchSnapshotWithRetry\(snapshotParams\(\{\}, targetHeight\)\)/);
  assert.doesNotMatch(serviceNodeEffect, /if \(serviceNodesOnly\) return;/);
  assert.match(serviceNodeEffect, /\/api\/service-nodes-live/);
});

test("restores every metric separator and strengthens the hero radar", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.metrics article:nth-of-type\(4n\) \{ border-right:0!important; \}/);
  assert.match(css, /\.metrics article:nth-of-type\(n\+5\) \{ border-bottom:0!important; \}/);
  assert.match(css, /\.metrics article:nth-of-type\(even\) \{ border-right:0!important; \}/);
  assert.match(css, /\.metrics article:nth-of-type\(n\+7\) \{ border-bottom:0!important; \}/);
  assert.match(css, /rgba\(76,255,201,\.07\)/);
  assert.match(css, /filter:drop-shadow\(0 0 26px rgba\(45,232,173,\.08\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{ \*,\*:before,\*:after/);
});

test("keeps the fixed navigation visible above every detail page", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.nav\{[\s\S]*position:fixed;/);
  assert.match(css, /\.nav\{z-index:100\}/);
  assert.match(css, /\.detail-backdrop\{z-index:80\}/);
  assert.match(css, /\.detail-page-backdrop\{top:92px\}/);
  assert.match(css, /\.detail-page\{min-height:calc\(100vh - 92px\)\}/);
  assert.match(css, /\.detail-page > header\{isolation:isolate\}/);
  assert.match(page, /className="detail-back-button" aria-label=\{"Back"\}/);
  assert.doesNotMatch(page, /Back to Explorer/);
});

test("keeps every detail-page field and ledger heading on one line", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.detail-page \.detail-grid small,[\s\S]*\.detail-page \.ring-head > \*\{\s*white-space:nowrap;\s*overflow-wrap:normal;\s*word-break:normal;/);
  assert.match(css, /\.transaction-detail-page \.input-summary\{\s*grid-template-columns:minmax\(0,1fr\) 180px 170px;/);
  assert.match(css, /@media \(max-width:600px\)\{\s*\.transaction-detail-page \.input-summary\{grid-template-columns:1fr\}/);
});

test("sizes the Statistics reactor cube around its active-node label", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.statistics-page \.reactor-cube\{top:58px;width:148px;height:148px\}/);
  assert.match(css, /\.statistics-page \.cube-front\{transform:translateZ\(74px\)\}/);
  assert.match(css, /\.statistics-page \.cube-bottom\{transform:rotateX\(-90deg\) translateZ\(74px\)\}/);
  assert.match(css, /\.statistics-page \.ring-two\{top:84px;width:276px;height:88px\}/);
  assert.match(css, /\.statistics-page \.reactor-beam\{top:24px;width:144px;height:250px\}/);
});

test("omits the internal global output index from visitor-facing detail tables", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const outputTable = page.slice(page.indexOf('detail.outputs && <section className="detail-outputs"'), page.indexOf("</section>}", page.indexOf('detail.outputs && <section className="detail-outputs"')));
  assert.doesNotMatch(outputTable, /GLOBAL INDEX|output\.globalIndex/);
  assert.match(outputTable, /OUTPUT KEY/);
  assert.match(outputTable, /AMOUNT/);
  assert.match(outputTable, /UNLOCK HEIGHT/);
  assert.match(css, /\.detail-output-head,\.detail-output-row\{grid-template-columns:50px minmax\(380px,2\.8fr\) minmax\(120px,\.8fr\) minmax\(130px,\.8fr\)\}/);
});

test("uses clear, consistent titles across every detail page state", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf('<section className="stream shell" id="transactions">');
  const end = page.indexOf("</section>", start);
  const transactionSection = page.slice(start, end);
  assert.match(transactionSection, /className="table-row transaction-row-link"/);
  assert.match(transactionSection, /aria-label=\{`Open transaction \$\{tx\.hash\}`\}/);
  assert.match(transactionSection, /onClick=\{\(\) => openTransaction\(tx\.hash, tx\.txType\)\}/);
  assert.doesNotMatch(transactionSection, /openBlock\(tx\.block\)/);
  assert.match(transactionSection, /<span className="height">/);
});

test("opens every Blocks table row as Block Details", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const blocksSection = page.slice(page.indexOf('id="blocks"'), page.indexOf('id="transactions"'));
  assert.match(blocksSection, /className="table-row block-row-link"/);
  assert.match(blocksSection, /role="button" tabIndex=\{0\} aria-label=\{`Open block/);
  assert.match(blocksSection, /onClick=\{\(\) => openBlock\(block\.height\)\}/);
  assert.doesNotMatch(blocksSection, /<button className="height detail-link"/);
  assert.doesNotMatch(blocksSection, /<button className="block-hash detail-link"/);
});

test("opens every Service Node ledger row as Service Node Details", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const serviceNodePage = page.slice(page.indexOf("{serviceNodesOnly &&"), page.indexOf("<section className=\"quorum-section", page.indexOf("{serviceNodesOnly &&")));
  const homepageNodes = page.slice(page.indexOf("home-service-nodes"), page.indexOf("<section className=\"privacy-panel", page.indexOf("home-service-nodes")));
  assert.match(serviceNodePage, /className="table-row service-node-row-link notranslate" translate="no"/);
  assert.match(homepageNodes, /className="table-row service-node-row-link notranslate" translate="no"/);
  assert.match(serviceNodePage, /role="button" tabIndex=\{0\} aria-label=\{`Open Service Node/);
  assert.match(homepageNodes, /onClick=\{\(\) => openServiceNode\(node\.publicKey\)\}/);
  assert.doesNotMatch(serviceNodePage, /<button className="node-key detail-link"/);
  assert.doesNotMatch(homepageNodes, /<button className="node-key detail-link"/);
});

test("keeps block-reward records out of Transaction Details", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("async function openTransaction");
  const end = page.indexOf("async function openServiceNode", start);
  const transactionDetail = page.slice(start, end);
  assert.match(transactionDetail, /title: "Transaction Details"/);
  assert.match(transactionDetail, /outputTitle: "Transaction Outputs"/);
  assert.match(transactionDetail, /TRANSACTION HASH/);
  assert.match(transactionDetail, /FEE PER KB/);
  assert.doesNotMatch(transactionDetail, /Block Reward Transaction|BLOCK REWARD|SERVICE NODE WINNER|minerTransaction/);
});

test("uses the complete quorum summary row to expand its matrix", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf('<div className="quorum-ledger">');
  const end = page.indexOf("</section>", start);
  const quorumLedger = page.slice(start, end);
  assert.match(quorumLedger, /<summary>/);
  assert.match(quorumLedger, /<span className="block-height quorum-height">\{compact\(record\.height\)\}<\/span>/);
  assert.doesNotMatch(quorumLedger, /openBlock\(record\.height\)/);
  assert.match(quorumLedger, /EXPAND MATRIX →/);
  assert.match(quorumLedger, /COLLAPSE MATRIX ↑/);
});

test("mobile ledgers use one value scale across every record column", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--mobile-ledger-value-size:13px/);
  assert.match(css, /\.table-card \.table-row \.tx-hash,[\s\S]*\.table-card \.table-row \.node-key,[\s\S]*\.detail-output-row code,[\s\S]*\.quorum-key \{[\s\S]*font-size:var\(--mobile-ledger-value-size\)!important/);
  assert.match(css, /\.table-card \.table-row,[\s\S]*\.quorum-record summary \{[\s\S]*align-items:center!important/);
});

test("keeps every table heading one visual step above its row values", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--mobile-ledger-heading-size:13\.5px/);
  assert.match(css, /\.table-card \.table-head,[\s\S]*\.committee-matrix header > \* \{\s*font-size:14px!important;\s*font-weight:650!important/);
  assert.match(css, /@media \(max-width:900px\) \{[\s\S]*\.committee-matrix header > \* \{\s*font-size:var\(--mobile-ledger-heading-size,13\.5px\)!important/);
  assert.match(css, /--mobile-ledger-value-size:13px/);
});
