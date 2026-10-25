# Arc TradeLab

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Arc TradeLab is a BTC/USDT strategy-testing lab with a versioned software-license marketplace. BTC trades and performance are simulations. The approved commercial flow is to inspect historical backtests and separate live forward evidence, purchase a specific strategy version in USDC on Arc mainnet, then import that version into the paper lab. This is not a report-service-fee product.

Current local build (2026-10-23): paper engine 1.2.0/storage v5 remains separate. Test on Arc now deploys a personal TestnetBotVault with an isolated reserve, exact owner-approved funding, and a memory-only generated session signer. Closed-candle SMA signals use observed quotes, then actual receipt/state confirmation. The user expressly authorized a disposable generated testnet owner. Its public run completed on 2026-10-23: one automatic buy, one automatic sell, and owner close/recovery. This Node rehearsal reused the browser signal engine and contract; browser MetaMask end-to-end remains unverified. Mainnet still requires the human wallet.

Strategy packages are strict data-only JSON settings, not executable uploaded bot code. The linked historical report and original dataset are recomputed before preparing or importing a publication. Publication bundle and manifest contain exact-file SHA-256 commitments for strategy/report/dataset/terms. Embedded package and report content checksums have different byte boundaries; never substitute those content checksums for exact-file commitments.

Marketplace wallet methods are explicit, never automatic effects. An address from a form or localStorage is only an untrusted candidate: registerVerifiedMarket must match the EXACT compiler runtime (including immutable chain ID). Every purchase/read rechecks code, chain and token. compiled.json is generated only after compiler-source hashes match current sources. Approval uses exact bigint amounts; native gas uses 18 decimals. Purchases still require verified files, terms, identity checks, simulation, receipt/event and authoritative entitlement. No verified deployment means no payment buttons. WalletButton detects installed providers and explicitly names MetaMask; an embedded preview without extensions explains opening the app in Chrome/Edge.

StrategyLicenseMarket.sol is locally tested and supports Arc mainnet/testnet; its direct payment grants a public software-use entitlement, not secret delivery or exclusive ownership. ExperimentRegistry.sol is Testnet-only and records owner attestations with sequence/predecessor links and final sealing. It has no funds, price oracle, simulated-profit payout or price-authentication guarantee. Neither contract is deployed yet.

Use Arc Studio to review/adapt contracts, run tests and integrate before human signing. The user authorized completing testnet experiments and real-USDC software licensing. A human reviews the concrete deployment/payment and signs wallet requests. Never collect user keys, seed phrases or exchange permissions. The temporary generated testnet session key never leaves memory or enters storage/logs/exports. Preserve old storage keys and actual records.

TestnetBotVault is hard-gated to 5042002. Each experiment owns its cash and reserve; a buy transfers test USDC to its reserve, a sell transfers it back. BTC/quotes/signals remain client attestations, not oracle-verified execution. Default owner funding is 100 test USDC budget plus 50 reserve, separate from up to 0.10 session gas. Session cannot withdraw/change rules; 24h/200-order limit, sequence/candle uniqueness, quote freshness, allocation limits and reserve checks apply. Close is always owner-recoverable, returns both pockets and records abandoned positions. It is NOT a real profit payout. Onchain integer sizing is disclosed separately from floating-point backtests. Background/hidden or stale tabs pause; reload never resumes. Export only verified chain events with complete sequence counts.

server/index.mjs serves built dist plus immutable evidence files (Node.js path, durable disk). netlify/functions/evidence.mjs serves the same API via Netlify Functions + site-wide Blobs (no process state, cold-start safe). blobEvidenceHandler uses CAS mutate() for nonce/quota atomicity: content-addressed files use onlyIfNew and integrity-check on re-read. publicHosting is false when origin is loopback; publicLink blocks studio preview domains. Use Node 24+, PUBLIC_APP_ORIGIN (Netlify URL env), BIND_HOST for Node server. Only content-addressed .json is served. Public hosting and durable Blobs remain a Netlify deployment requirement; preview disk/URL is neither durable nor public. External HTTPS/IPFS still supported.

Public buyer links (?chain=&market=&listing=&tx=) are candidates, never authority. parsePublicSelection validates format; registerVerifiedMarket does exact runtime re-check before adding to LICENSE_MARKET_DEPLOYMENTS. PurchaseProofPanel reads receipt read-only, no wallet, no auto-signature. purchaseProof.ts requires exact single buyer-to-seller USDC Transfer log matching paidPrice6, plus entitlement, event and block-hash confirmation. Purchased bot opens Test on Arc without touching paper state (target='testnet' skips updateStrategyConfig).

PUBLIC TESTNET EXPERIMENT (Arc Testnet 5042002 — NOT mainnet): vault 0x36920c4ddaee26ec039a653ec78520c4b27a64e3, deployment tx 0x0101cfd53bb2469150387f5d3c37483fe57e16f7fa84f8d6f7a923f1cb706358, funding 10 test USDC tx 0xe26781c2f75f76fe12f981ccfed4c35ddddbe0986c2d3d5701bc1effb63f8dd3. Completed run: automatic buy 0xb99bf6414ed9475fe3d020a2c7b042a614aba3cff7f15b7aaf184c2ad3143a81; automatic sell 0xf35f115eb8677adb4a5b6d6525e955c3967fbfe882f0dd8d86c9af3320e0fd47; close/recovery 0xa9b68258db0a2a110dad17a1fb3f16c6061e3f9abecb8d4e29109eca59d16102. Two Fill events matched sequence 2, no virtual BTC remained, and the vault was closed. Owner/session keys existed only in the now-exited Node process. Do not claim these test assets are recoverable by a user wallet or re-run this experiment automatically. Public evidence is in release-review/public-testnet/run.json (local parent workspace). The browser viewer can read ?experiment=0x36920c4ddaee26ec039a653ec78520c4b27a64e3 without a signer. Simulated realized result was -0.003968 test USDC before actual network gas; this was execution verification, not a profitable-strategy claim.

MAINNET CONTRACT DEPLOYED (2026-10-25): StrategyLicenseMarket at 0xEB55Dca755E186C24Ee42cd1d3D315D3Cc602A4d on Arc mainnet (chain 5042). Deploy tx 0x364b873f903d473cf45d2b3342a14690a1be72533ca548235fdde71a92d69cf6 (deployment gas only — NOT a USDC license purchase). Deploy receipt: status=success, blockNumber=27745471, gasUsed=978570. Read-only onchain check 2026-10-25: nextListingId=1 (0 listings ever created), 0 ListingCreated events, 0 LicensePurchased events scanned from block 27745471 to block 27756306. Independently verified via RPC: expectedChainId()=5042, USDC()=0x3600000000000000000000000000000000000000, USDC_DECIMALS()=6, keccak256(eth_getCode) matches compiled artifact 0x4a9ce64c…. Address seeded in LICENSE_MARKET_DEPLOYMENTS; marketplace panel re-verifies runtime before any read or payment. MAINNET USDC PURCHASE: not yet completed. ExperimentRegistry: not deployed on any chain.

## Tech Stack

Release candidate update (2026-10-23, local): wallet dialog explicitly switches between Arc mainnet licensing and Testnet experiments, showing the connected network balance. Marketplace starts on mainnet for deployment review; no default verified address exists. Public links supply untrusted chain/address/listing/receipt candidates, then exact runtime and RPC checks run without wallet access. Session-scoped Studio preview links cannot be shared as public buyer links. The latest three real listings can be loaded as cards only after their reports are recomputed; missing evidence is labeled, never filled with invented performance. Purchased versions can open Test on Arc without resetting the separate paper portfolio.

PurchaseProofPanel independently checks purchase event + exact USDC Transfer + canonical block + authoritative entitlement/price/version; its JSON receipt separates license price from actual gas. Does not claim an independent customer or validate returns. The updated local Anvil test exercises this proof against actual mock-token transfers on both chain configurations.

Netlify deployment adapter: netlify.toml and netlify/functions/evidence.mjs use @netlify/blobs 11.1.6, site-wide store arctradelab-public-evidence-v1, strong reads, onlyIfMatch CAS nonce/quota updates and onlyIfNew content-addressed writes. No ephemeral disk or server signer. PUBLIC_APP_ORIGIN or Netlify URL binds upload origin; preview-origin uploads are refused. 2 MB bundles, 100 pending challenges, 10 challenges/min/IP hash, conservative 2,000-file/1 GB quota. Unit fixtures verify cold starts, racing replay, concurrent quota, expired/changed signatures, forged results and missing ETags. The real SDK bundles/loads locally; public Netlify hosting is NOT yet verified. No new source changes to Solidity. A human still needs to connect hosting/GitHub and sign deployments/listings/purchases. Never present this candidate as a submitted or publicly transacted build.

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chains: Arc Testnet (5042002) and Arc mainnet (5042), imported from `viem/chains`; Ethereum mainnet only for ENS
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)
- `src/marketplace/` - strict strategy packages, reproducible publication bundles and reviewed deployment/receipt checks
- `src/trading/` - paper ledger, historical backtests, live execution guards and transparent forward-report exports

## Reviewed Checks

Current status (2026-10-25 end of day):
- Public frontend live at https://arc-tradelab.netlify.app (site ID e1567516-3f99-4422-ae43-b66f4703d7d8; Git-connected build 1cd6b70 deployed 2026-10-25 16:02 KST; Netlify Functions active; renamed from earnest-kleicha-68d9e5.netlify.app)
- StrategyLicenseMarket deployed on Arc mainnet at 0xEB55Dca755E186C24Ee42cd1d3D315D3Cc602A4d (deploy tx 0x364b873f…69cf6; gas only, not a USDC purchase)
- GitHub repo public at https://github.com/openai-lover/arc-tradelab (commit 32028a6, source pushed 2026-10-25)
- PUBLIC_APP_ORIGIN=https://arc-tradelab.netlify.app in netlify.toml [build.environment]
- Mainnet USDC license purchase: NOT yet completed
- CSS defect fixed: .starter-card-bottom button was overriding .btn-primary colour (blue-on-blue); fixed with explicit .btn-primary override rule

Verified in Arc Studio (2026-10-25, final QA corrections pass):
- tradelab-user-logo.webp c22c0fcb… confirmed installed (155024 bytes, VP8L lossless)
- All three .webp images now imported as Vite module assets (fingerprinted into dist/assets/); resolves naturalWidth=0 in preview proxy
- `tsc -p tsconfig.browser.json`: clean (0 errors)
- `oxlint` (Brand, OverviewPanel, ProjectPanel, App.tsx): 0 warnings, 0 errors
- `bunx vite build`: succeeds

Previously verified in Arc Studio (2026-10-25, QA finishing pass):
- Image hashes confirmed: tradelab-hero.webp ef9dc193…, strategy-objects.webp fcb5640a…
- `tsc -p tsconfig.browser.json`: clean (0 errors)
- `oxlint` (OverviewPanel, BacktestPanel, ProjectPanel, App.tsx): 0 warnings, 0 errors
- `node --test review-tests/*.test.mjs`: **81/81 pass**
- `forge test`: **52/52 pass**
- `bunx vite build`: succeeds

Previously verified in Arc Studio (2026-10-25, overview/project/docs pass):
- `tsc -p tsconfig.browser.json`: **clean** (0 errors)
- `oxlint` on new files (OverviewPanel, ProjectPanel, App.tsx): **0 warnings, 0 errors**
- `forge test`: **52/52 pass** — contracts unchanged
- Dev server: running (pid 2082, port 5173)

Previously verified in Arc Studio (2026-10-23, submission-candidate integration run):

- `bun add @netlify/blobs@11.1.6`: installed (43 packages), lockfile updated via bun
- `node --test review-tests/*.test.mjs`: **81/81 pass** — adds public-purchase-proof (3) and blob-evidence (7) to prior 71
- `forge test` (Solidity 0.8.28, local mock USDC): **52/52 pass** — contracts unchanged; 3 x 256-case fuzz
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.browser.json`: **clean** (0 errors)
- `bunx vite build`: **succeeds**
- Preview (localhost:5173): **HTTP 200**

Global `tsc --noEmit`: errors only in `scripts/` (deployment-helper private dependency) and `src/trading/engine.test.ts` (`bun:test`). Both excluded from `tsconfig.browser.json`. Do not conceal with fake shims.
Lint: 3 warnings total — 2 pre-existing `engine.test.ts` unused vars, 1 `parseAbi` unused import in `scripts/check-onchain-integration.mjs`. All warnings; zero new errors in browser source.

`compiled.json` `sourceSha256` values match current `.sol` sources. Contracts not changed; compiler runtime commitments not regenerated.

These are not onchain performance results or an external audit. See MAINNET CONTRACT DEPLOYED note above for current deployment status.

## To Run

```bash
bun install
bun run dev
```

## UI workflow (2026-10-25 update)

Overview panel added as the default landing view. OverviewPanel.tsx: wallet-free entry, primary CTA runs a synthetic demo backtest immediately (BacktestPanel.forwardRef + runSample via backtestRef), secondary CTA opens marketplace. Three honest step cards (test, verify, buy) with genuine limitation list and footer CTAs. HeroImage and StrategyImage components live in OverviewPanel.tsx with graceful SVG fallbacks; images install under public/brand/tradelab-hero.webp and strategy-objects.webp (pending user upload). ProjectPanel.tsx: real deployment registry (TestnetBotVault deployed; StrategyLicenseMarket and ExperimentRegistry "not yet deployed" explicitly), how-Arc-is-used explanation, development history, build/test commands, genuine limitations, and machine-readable missing-item checklist. App.tsx adds 'overview' and 'project' views; BacktestPanel now receives a forwardRef; sidebar has 5 nav items. docs/readiness.json has machine-readable submission checklist. docs/demo-script.md has 2-minute demo plan. README.md updated with accurate env vars, deployment table, and limitations.

## UI workflow (2026-10-19)
2026-10-23 refinement: original blue vector logo lives in public/brand/tradelab-symbol.svg, rendered by Brand.tsx. The chart leads the live screen; portfolio metrics follow it. StarterBots offers three clearly labeled free SMA templates without invented performance or purchases. Selecting one only chooses a backtest package; it does not save a version, change the live rules or start a bot. Marketplace setup is collapsed until requested. Historical results still require real recomputation before selling. Testnet setup groups bot/budget and wallet/deployment, preserving explicit session consent and all wallet guards. Keep forms and detailed assumptions behind deliberate actions; never hide transaction costs or consent. Desktop and 390/768px iframe layouts were visually reviewed locally. Mainnet deployment and purchases remain unverified because Chrome web control is unavailable in the current session; user-reported MetaMask connection is not independently observed.

A compact light workspace uses a white top navigation, blue primary actions, and short labels inspired by familiar consumer finance apps. Do not restore the marketing hero, three-step promotional cards or dark sidebar. Keep Trading lab, Results and Bot market separate, with Live test, Backtest and My bots inside the lab. Hidden panels stay mounted to preserve work. Rule edits are staged and validated.

PriceChart renders genuine Binance one-minute OHLCV, with 1/5/15-minute views, red up/blue down candles, volume, OHLC inspection, zoom and history navigation. marketCandles.ts rejects bad envelopes and missing/duplicate bars. Larger intervals skip incomplete leading groups. The final forming candle is labeled; only closed one-minute candles reach the engine. Candles refresh every 15 seconds, separately from tick quotes; chart interval controls do not change strategy rules.

Save & backtest creates a strict version then navigates to its backtest. Run with recent BTC data fetches at most 1,000 one-minute Binance bars, excludes the forming bar and retains the exact normalized dataset with retrieval time. This short window is not long-term evidence. A linked result flows through Sell this bot to seller preparation, full report recomputation and buyer preview. A new seller draft opens the seller view even if the buyer tab was previously selected. Download-and-verify evidence supports credential-free HTTPS/IPFS requests with a 20 MB streamed bound and manual-file fallback. Payments and licensed import remain gated by real deployment, verified file commitments and onchain entitlement. After a confirmed listing, View this listing carries its actual event-derived ID to the buyer view.

The optional tutorial in demoDataset.ts is deterministic SYNTHETIC data. Never claim market performance, attach it to a saved package, alter a live experiment or enable sale preparation for it. The report graph uses its actual equityCurve. Studio credit is visible in the footer without covering controls.

Final receipt UI follow-up: catch synchronous publicLink refusal inside async copyReceipt, clear prior proof on deployment changes, label testnet gas as test USDC. Rechecked browser types and production build locally.
