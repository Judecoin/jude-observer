# Jude .net PoS Explorer Implementation Plan

**Goal:** Make the repository's root Flask explorer a reliable v17 PoS baseline, while retaining historical PoW block inspection and providing a public review preview before any production deployment.

**Architecture:** Restore the previously synchronized production source from the repository history. Keep RPC as the source of chain data. Select PoS or PoW presentation from the live fork/block version; never infer hashrate for PoS. Mock responses are explicit test fixtures only. A separate public preview can demonstrate the interface, but must disclose when it uses a snapshot or a proxy instead of the production RPC path.

**Tech stack:** Flask/Jinja, Python unittest, read-only Jude RPC. `explorer-iii` is out of scope.

## Tasks

- [ ] Add regression checks for explicit mock mode, v17 overview and statistics, and v17/v16 block labels. Run them against the restored baseline and record failures.
- [ ] Make real-node mode the default, use current RPC fork data for PoS presentation, and preserve PoW history. Make the smallest changes that pass the checks.
- [ ] Check that no sample values appear in production templates or API responses. Render mock routes and inspect the displayed pages.
- [ ] Publish a separate public review URL and clearly identify its data source. Verify the URL and visible PoS screens before handoff.
- [ ] Keep the production server unchanged pending the user's preview review. Prepare a reproducible branch/patch and deployment verification notes.

## Risks to verify

- A missing `MOCK_MODE` environment variable must never show fabricated network data.
- A v17 Pulse block must not report network hashrate or call its reward a miner reward.
- A historical mined block must remain inspectable with its difficulty and nonce.
- A stale or lagging node must show a synchronization warning instead of silently presenting stale data as current.
- Preview provenance must remain visible so a rendered snapshot is never confused with a live-node validation.
