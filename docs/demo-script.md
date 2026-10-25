# Arc TradeLab — 2-Minute Demo Script

**Purpose:** Arc Microgrants Round 2 submission video
**Audience:** Hackathon judges
**Length:** ~2 minutes
**State as of 2026-10-25:** Contract deployed on Arc mainnet. USDC purchase transaction pending (wallet-connection step required in browser).

---

## Prepared backtest result (use this exact run — already visible in app)

- **Strategy:** TradeLab BTC Trend — Verification Demo v1.0.0
- **Dataset:** Binance, 999 closed 1-minute candles, 2026-10-24T14:51:00Z to 2026-10-25T07:09:59.999Z
- **Settings:** SMA 5 / 20
- **Result:** −0.82% | max drawdown 0.82% | buy-and-hold +0.23% | 29 closed trades
- **Draft listing price:** 0.01 USDC

---

## Script

### 0:00 — Open Arc Studio (10 s)

> "This is Arc TradeLab, built in Arc Studio.
> The contract, tests, and frontend all live in one project."

Show the Arc Studio workspace. Point briefly at:
- The `contracts/` folder (StrategyLicenseMarket.sol)
- The `contracts/test/` folder (Foundry unit tests — 52/52 pass)
- The running preview panel

---

### 0:10 — Show the live app (15 s)

> "The public app is at arc-tradelab.netlify.app.
> A fresh visitor lands here — no wallet, no account needed."

Open `https://arc-tradelab.netlify.app` in a separate browser tab. Show the Overview panel.

---

### 0:25 — Run a real backtest (25 s)

> "I'll click Test with BTC data. This fetches real closed Binance candles —
> no synthetic data, no cached result."

1. Click **Test with BTC data** on the Overview starter card (or Lab → Backtest → **Run with recent BTC data**).
2. Wait for the fetch (≈ 2 s). The result populates automatically.
3. Show the results panel: −0.82% return, 0.82% max drawdown, +0.23% buy-and-hold, 29 trades.
4. Point at the SHA-256 checksums shown below the chart.

> "The dataset, strategy file, and report each get an exact hash.
> A buyer recomputes these locally before spending anything."

---

### 0:50 — Show the marketplace — known deployment, no wallet required (20 s)

> "The Bot market panel auto-verified the deployed mainnet contract.
> No wallet needed to browse."

1. Navigate to **Bot market** → **Explore bots**.
2. Show that the market address `0xEB55Dc…` is already selected and verified — no deploy ceremony.
3. Show the listing count: 0 listings (honest empty state).

> "The contract is live on Arc mainnet. No listings yet —
> that's the next step."

---

### 1:10 — Connect wallet and create a listing (20 s)

> "I'll connect MetaMask and list this strategy at 0.01 USDC."

1. Click **Connect wallet** → MetaMask → select **Arc Mainnet**.
2. Navigate to **Sell a bot**.
3. Show the prepared evidence: strategy version hash, report hash, dataset hash.
4. Enter price **0.01** USDC.
5. Click **Review listing in wallet** → MetaMask shows: contract = `0xEB55Dc…`, seller = your address, price = 10000 raw units (0.01 USDC). Sign.
6. Wait for confirmation. Show the `ListingCreated` event and listing ID.

**[ PENDING — requires live wallet signing. Record this segment after signing. ]**

---

### 1:30 — Buy the listing at 0.01 USDC (25 s)

> "Now I'll buy from a separate wallet. First, an exact approval — no unlimited approval."

1. In **Explore bots**: enter the listing ID from the previous step → **Load listing from Arc**.
2. Click **Load & verify evidence** → confirm all four hash badges are green.
3. Check the acceptance box.
4. **Approve exact USDC price** → MetaMask: token = `0x3600…0000`, spender = contract, amount = 10000 raw units (0.01 USDC). Sign.
5. **Review purchase in wallet** → MetaMask: function = `buyLicense`, no ETH value. Sign.
6. Show confirmed receipt: transaction hash, explorer link.
7. Navigate to **Purchase proof** panel → show all six verification checks passing: USDC Transfer log, LicensePurchased event, block hash, entitlement, price, version.

> "0.01 USDC moved directly from my wallet to the seller.
> No platform custody. The proof is verified independently — not taken on trust."

**[ PENDING — requires wallet-connection segment above to complete first. ]**

---

### 1:55 — Close (5 s)

> "Arc TradeLab: test, verify, buy. Built on Arc."

---

## Notes for recording

- Record at 1080p minimum.
- The 0:00–1:10 segment (through the empty marketplace) can be recorded now. The 1:10–1:55 segment requires MetaMask signing on Arc Mainnet with a funded wallet.
- Narrate each wallet action out loud before signing: name the network (Arc Mainnet), the token (USDC), and the amount.
- Keep the Arc Studio tab visible briefly at 0:00.
- The purchase segment requires two separate wallets (seller ≠ buyer) or two MetaMask accounts.
- Upload to YouTube (unlisted is fine) and link in the DoraHacks submission form.
- Do not edit out the confirmation wait times — judges need to see real network confirmations.
