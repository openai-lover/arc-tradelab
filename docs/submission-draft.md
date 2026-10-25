# TradeLab — Arc Microgrants Round 2 Submission Draft

**Status: INCOMPLETE — do not submit until all required fields are filled.**

---

## Project name

TradeLab

## Short description (≤ 280 characters)

BTC strategy backtesting lab with a USDC software-license marketplace on Arc. Pick a free SMA template, run real Binance candles, recompute evidence, then buy the exact version you verified. Simulated trades only.

## Longer description

TradeLab is a browser-based BTC/USDT strategy lab and USDC-powered software-license marketplace built on Arc.

**What it does:**
- Lets anyone run a historical SMA crossover backtest against real Binance 1-minute candle data, with stated fee/slippage assumptions, no wallet required.
- Publishes strategy versions as exact SHA-256 committed bundles (strategy JSON + backtest report + license terms). Buyers can recompute every hash before spending a cent.
- Uses `StrategyLicenseMarket.sol` on Arc: a buyer calls `approve` for the exact listed price, then `buyLicense`. The contract re-checks price and strategy hash, calls `safeTransferFrom` directly to the seller, emits `LicensePurchased`. No platform custody, no escrow.
- Uses Arc Testnet USDC for live bot experiments: `TestnetBotVault.sol` receives test USDC, records each fill onchain, returns funds on close.
- Purchase proof verification (`purchaseProof.ts`) independently confirms the exact USDC Transfer log (buyer → seller), `LicensePurchased` event, canonical block hash, and authoritative entitlement before displaying any access.

**How Arc is used:**
- USDC is the only token. Both native gas (18-decimal) and ERC-20 payment (6-decimal) paths are handled explicitly with explicit conversion (`usdcToGasToken` / `gasTokenToUsdc`).
- Sub-second confirmation allows the post-purchase entitlement re-read to complete in the same UI interaction.
- Stable USDC-denominated gas makes deployment cost estimates readable in the same unit as the payment token.

**Development:**
- Frontend (Vite + React + TypeScript) and all onchain integration built in Arc Studio.
- Contract sources initially drafted locally with Codex assistance, then integrated, reviewed, and tested in Arc Studio using Foundry.
- Marketplace integration, evidence pipeline, purchase-proof verification, Netlify Blobs adapter, and 81-test review suite written and run in Arc Studio.

**Honest limitations:**
- Strategy templates are public SMA settings. A software-use license does not make them exclusive or secret.
- Historical backtests are simulations under stated assumptions, not forecasts.
- Contracts reviewed and fuzz-tested in Arc Studio; not independently audited by a third party.
- No background worker; the app runs only while the browser tab is open.

---

## Required submission fields

| Field | Value | Status |
|---|---|---|
| Arc Studio project URL | `https://studio.arc.io/app/04fabf1d-e9e4-40c9-a737-ac53f55c43b1` | ✓ Available |
| Live app URL | _PENDING — deploy to Netlify/HF/Vercel_ | ❌ Missing |
| Mainnet contract address | _PENDING — deploy StrategyLicenseMarket on Arc mainnet_ | ❌ Missing |
| Mainnet USDC purchase TX | _PENDING — verified buyer→seller Transfer + LicensePurchased event, amount > 0, buyer ≠ seller, chain 5042_ | ❌ Missing |
| Public repo URL | `https://github.com/openai-lover/arc-tradelab` — repo created, source push pending GitHub app authorization | ⚠ Repo empty |
| Video (Arc Studio + mainnet tx) | _PENDING — record after mainnet deploy showing Studio tests and a live mainnet USDC purchase_ | ❌ Missing |
| Builder profile | `https://github.com/openai-lover` | ✓ Available |

**Note on mainnet USDC transaction:** listing creation does not count. The requirement is a real buyer-to-seller USDC transfer confirmed on Arc mainnet (chain 5042), independently verifiable via the `purchaseProof.ts` verification pipeline (USDC Transfer log + LicensePurchased event + block hash + entitlement).

**Testnet evidence (already available):**
- TestnetBotVault: `0x36920c4ddaee26ec039a653ec78520c4b27a64e3` on Arc Testnet (5042002)
- Deploy tx: `0x0101cfd53bb2469150387f5d3c37483fe57e16f7fa84f8d6f7a923f1cb706358`
- Buy tx (automatic fill): `0xb99bf6414ed9475fe3d020a2c7b042a614aba3cff7f15b7aaf184c2ad3143a81`
- Sell tx (automatic fill): `0xf35f115eb8677adb4a5b6d6525e955c3967fbfe882f0dd8d86c9af3320e0fd47`
- Close/recovery tx: `0xa9b68258db0a2a110dad17a1fb3f16c6061e3f9abecb8d4e29109eca59d16102`

These are Arc Testnet transactions using test USDC only. They demonstrate the vault contract and full bot lifecycle but do not satisfy the mainnet USDC commerce requirement.

---

## Ready manual license demo (0.01 USDC — review only, no signing until human confirms)

This describes the flow once `StrategyLicenseMarket` is deployed on Arc mainnet. Wallet currently connected: MetaMask on Arc mainnet with ~2 USDC. No transaction is submitted without the human confirming each MetaMask prompt.

**Step 1 — Deploy the marketplace (one-time, owner wallet):**
1. In TradeLab → Bot market → Marketplace setup → select Arc mainnet → "Activate bot marketplace".
2. Click "Check deployment fee" — the UI calls `eth_estimateGas` via viem and displays the actual estimated cost in USDC. Do not use any pre-calculated estimate; read the displayed value.
3. Review: contract bytecode hash, owner address (your MetaMask), chain 5042.
4. Click "Deploy · sign in wallet" — MetaMask prompts. Human signs. Record the deployed address.

**Step 2 — Create a listing at 0.01 USDC:**
1. Lab → Backtest: pick any free template, click "Test with BTC data".
2. Click "Sell this bot" → enter license terms → "Recompute & prepare files".
3. Review evidence panel: return %, drawdown %, SHA-256 hashes, date range, candle count.
4. In Listing details: price = `0.01` (six-decimal validation enforced). Enter evidence bundle URL.
5. "Review listing in wallet" — MetaMask shows: contract = market address, seller = your address, price 10000 (0.01 × 10⁶). Human signs.
6. Record `ListingCreated` event listing ID.

**Step 3 — Buy at 0.01 USDC (different wallet):**
1. Load listing ID in Buyer view → "Load & verify evidence" → confirm all hashes match onchain commitments.
2. Check the acceptance box.
3. "Approve exact USDC price" — MetaMask shows: token = USDC `0x3600…0000`, spender = market contract, amount = 10000 raw units (0.01 USDC). Human approves.
4. "Review purchase in wallet" — MetaMask shows: contract = market, function = `buyLicense`, no ETH value. Human signs.
5. After confirmation: `LicensePurchased` event visible in explorer.
6. PurchaseProofPanel verifies: exact USDC Transfer log (buyer → seller, 10000 raw units), `LicensePurchased` event, block hash, authoritative entitlement. All six checks must pass.

**This receipt, once verified, is the required mainnet USDC transaction evidence.**

---

## Arc Studio usage evidence

- Arc Studio project: `https://studio.arc.io/app/04fabf1d-e9e4-40c9-a737-ac53f55c43b1`
- All Solidity reviewed and edited in Arc Studio; Foundry tests run here: `bun run contracts:test` → 52/52 pass.
- Frontend built in Arc Studio: `bunx vite build` succeeds.
- Review tests: `node --test review-tests/*.test.mjs` → 81/81 pass.
- Contract sources initially drafted locally with Codex; integrated, reviewed, and all tests run in Arc Studio.
- TestnetBotVault deployed and full onchain run executed locally 2026-10-23 via a disposable Node script (owner/session keys were memory-only, now gone). Browser MetaMask mainnet deployment is the next required human step.

---

## Submission blockers (do not submit until resolved)

1. Deploy `StrategyLicenseMarket` on Arc mainnet — human wallet action required.
2. Complete one real USDC purchase (buyer ≠ seller, amount > 0) and record the verified receipt.
3. Push codebase to a public GitHub repository.
4. Deploy app to a live public URL (Netlify/HF/Vercel).
5. Record a 2-minute video demonstrating Arc Studio (contract tests visible) and the mainnet USDC transaction.
6. Create a public builder profile (GitHub, X, or Farcaster — not just DoraHacks).
