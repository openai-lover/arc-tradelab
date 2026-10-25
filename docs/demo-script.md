# Arc TradeLab — 2-Minute Demo Script

**Purpose:** Arc Microgrants Round 2 submission video  
**Audience:** Hackathon judges  
**Length:** ~2 minutes  
**Required:** Arc Studio tab + browser with MetaMask

---

## Script

### 0:00 — Open Arc Studio (15 s)

> "This is Arc TradeLab, built entirely in Arc Studio.
> The contracts, tests, and frontend all live here in one project."

Show the Arc Studio workspace with the project open. Point at:
- The `contracts/` folder (StrategyLicenseMarket.sol, TestnetBotVault.sol)
- The `contracts/test/` folder (Foundry unit tests)
- The running preview panel

---

### 0:15 — Run a backtest (25 s)

> "Anyone can test a strategy without a wallet.
> I'll pick the BTC Trend template and run it against real Binance data."

1. Click **Overview** → **Run a quick backtest** (or navigate to Bot market → StarterBots → Backtest).
2. Click **Run with recent BTC data**.
3. Show the result: strategy return, max drawdown, buy-and-hold comparison, equity curve.
4. Point at the SHA-256 checksums.

> "The dataset, strategy file, and report each get an exact hash.
> A buyer can download the bundle and recompute these to verify the listing matches what's onchain."

---

### 0:40 — Show the marketplace (20 s)

> "The Bot market panel handles the full sell-and-buy flow."

1. Navigate to **Bot market**.
2. Show the **Explore bots** and **Sell a bot** tabs.
3. If a testnet listing exists, show the listing card with the evidence-match badge.

> "Until a marketplace is deployed, payment buttons stay disabled.
> Let me deploy one now."

---

### 1:00 — Deploy StrategyLicenseMarket on Arc mainnet (30 s)

> "I'll deploy the marketplace contract. Arc uses USDC as gas — same token, no ETH needed."

1. Open **Marketplace setup** → select **Arc mainnet · real USDC**.
2. Connect MetaMask; switch to Arc mainnet.
3. Check the acknowledgement box. Click **Check deployment fee**.
4. Show the gas estimate (in USDC).
5. Click **Deploy · sign in wallet**. Show MetaMask prompt.
6. Wait for confirmation. Show the explorer link.

> "Deployed. The contract address is now verified against the exact bytecode reviewed in Arc Studio."

---

### 1:30 — Buy a license (25 s)

> "Now I'll purchase a listing. First I approve the exact USDC price — no unlimited approval."

1. Navigate to **Explore bots** → enter the listing ID → **Read listing from Arc**.
2. Load & verify evidence. Show the hash-match confirmation.
3. Accept terms checkbox.
4. Click **Approve exact USDC price** → sign in MetaMask.
5. Click **Review purchase in wallet** → sign in MetaMask.
6. Show the confirmed purchase: transaction hash, explorer link, entitlement record.

> "The USDC moved directly from my wallet to the seller.
> No platform custody. The entitlement is recorded immutably onchain."

---

### 1:55 — Close (5 s)

> "Arc TradeLab: test, verify, buy. Built on Arc."

---

## Notes for recording

- Record at 1080p minimum.
- Narrate each wallet action out loud before signing.
- Do not rush the MetaMask confirmations — the judge needs to see the network name (Arc Mainnet) and the token amount (USDC).
- Keep the Arc Studio chat thread visible briefly at the start.
- Upload to YouTube (unlisted is fine) and link in the DoraHacks submission.
