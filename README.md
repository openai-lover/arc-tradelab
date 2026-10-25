# Arc TradeLab

A BTC/USDT strategy-testing lab with a versioned software-license marketplace built on Arc.

Built with [Arc Studio](https://studio.arc.io)

---

## What it does

Arc TradeLab lets you test a moving-average BTC/USDT trading strategy, inspect an independently verifiable historical backtest with SHA-256 file commitments, and purchase a specific versioned strategy license in USDC on Arc.

**BTC trades are simulations.** No real BTC is ever bought or sold. Paper experiments use virtual USDC. Arc Testnet experiments use test USDC only.

The approved commercial flow:
1. Pick or configure a strategy template.
2. Fetch real Binance 1-minute candle data and run a backtest.
3. Inspect the result: fee/slippage assumptions, date range, dataset source, drawdown, buy-and-hold comparison.
4. Download and recompute SHA-256 commitments; confirm they match the onchain listing before paying.
5. Purchase the exact version you verified. The contract checks your stated price and strategy hash, then transfers USDC directly to the seller with no platform custody.

## Tech stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28, Foundry (forge)
- Wallet: injected (MetaMask or any EIP-1193 provider)
- Chains: Arc Testnet (5042002) and Arc mainnet (5042)
- Token: USDC at `0x3600000000000000000000000000000000000000` (Arc native USDC, 6 decimals ERC-20)
- Evidence hosting: Netlify Blobs (`@netlify/blobs` 11.1.6) — requires a live Netlify deployment with `PUBLIC_APP_ORIGIN` set

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.x
- [Foundry](https://getfoundry.sh) (for contract work)
- Node 24+ (for review tests and server)

### Install

```bash
bun install
```

### Run

```bash
bun run dev          # Vite dev server on :5173
```

### Build contracts

```bash
bun run contracts:build   # forge build
```

### Test contracts

```bash
bun run contracts:test    # forge test  (52 tests, Solidity 0.8.28)
```

### Browser typecheck

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.browser.json
```

### JS review tests

```bash
node --test review-tests/*.test.mjs   # 89 tests
```

### Production build

```bash
bunx vite build
```

## Environment variables

| Name | Purpose | Required |
|---|---|---|
| `PUBLIC_APP_ORIGIN` | Canonical HTTPS origin for the deployed app; used by the evidence API to accept uploads. Without it, uploads are refused as non-public. | Netlify deployment only |
| `EVIDENCE_DIRECTORY` | Local filesystem path for evidence storage when using the Node HTTP server. | Node server only (`server/index.mjs`) |
| `PORT` | HTTP port for the Node server. Default: 4174. | Node server only |
| `BIND_HOST` | Bind host for the Node server. Default: 127.0.0.1. | Node server only |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Arc Studio RPC proxy. Optional outside Arc Studio; backend code falls back to public RPC URLs when absent. | Optional outside Arc Studio |

## Onchain deployments

| Contract | Chain | Address | Status |
|---|---|---|---|
| TestnetBotVault | Arc Testnet (5042002) | `0x36920c4ddaee26ec039a653ec78520c4b27a64e3` | Deployed; full run completed 2026-10-23 |
| StrategyLicenseMarket | Arc mainnet (5042) | `0xEB55Dca755E186C24Ee42cd1d3D315D3Cc602A4d` | Deployed 2026-10-25 — deploy tx [`0x364b873f…`](https://explorer.arc.io/tx/0x364b873f903d473cf45d2b3342a14690a1be72533ca548235fdde71a92d69cf6) (gas only; 0 listings, 0 purchases as of 2026-10-25) |
| StrategyLicenseMarket | Arc Testnet (5042002) | — | Not yet deployed |
| ExperimentRegistry | Arc Testnet (5042002) | — | Developed, not yet deployed |

## Genuine limitations

- Strategy templates are public SMA settings, not proprietary algorithms or secret delivery.
- A software-use entitlement does not make public settings exclusive or prove authorship.
- Historical returns are simulations under stated fee and slippage assumptions. Not a forecast.
- Live Arc Testnet fills use client-reported BTC prices from Binance public APIs, not an onchain oracle.
- Evidence hosting (Netlify Blobs) is implemented and tested. `GET /api/evidence/status` returns `{available:true,publicHosting:true}` (verified 2026-10-25). No signed upload or download round-trip has been performed — end-to-end persistence durability is not yet confirmed.
- No background worker. The app requires an open browser tab.
- No independent security audit has been performed on the contracts.

## Submission status (Arc Microgrants Round 2)

- [x] Public source repository: https://github.com/openai-lover/arc-tradelab
- [x] Builder profile: https://github.com/openai-lover
- [x] Arc Studio project: https://studio.arc.io/app/04fabf1d-e9e4-40c9-a737-ac53f55c43b1
- [x] StrategyLicenseMarket deployed on Arc mainnet: `0xEB55Dca755E186C24Ee42cd1d3D315D3Cc602A4d` — deploy tx [`0x364b873f…`](https://explorer.arc.io/tx/0x364b873f903d473cf45d2b3342a14690a1be72533ca548235fdde71a92d69cf6) (gas only, not a USDC license purchase; verified 2026-10-25)
- [ ] Mainnet USDC purchase through the marketplace contract (verified buyer→seller Transfer + LicensePurchased event)
- [x] Live public URL: https://arc-tradelab.netlify.app (Git-connected build main@594e9d3 published 2026-10-25; Netlify Functions active; `GET /api/evidence/status` verified)
- [ ] 2-minute demo video showing Arc Studio and mainnet transaction

**Gas estimate (observed 2026-10-25, Arc mainnet):** maximum budget ~0.034365 USDC for StrategyLicenseMarket deployment. Estimates change with network conditions; verify in the app before signing.
