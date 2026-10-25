/**
 * Arc TradeLab — virtual paper-trading engine.
 *
 * ALL BTC positions are simulated paper trades. No real BTC is bought or sold.
 * USDC figures here are either:
 *   (a) virtual simulation cash — not real money, no on-chain existence, or
 *   (b) Arc Testnet USDC — test tokens with no monetary value.
 *
 * Fee assumptions (clearly labeled as simulated, not measured):
 *   - Taker fee:          0.10% of notional  (SIM_FEE_BPS)
 *   - Adverse slippage:   0.05% of notional  (SIM_SLIPPAGE_BPS)
 *   - Simulated gas:      0.001 USDC fixed    (SIM_GAS_USDC)
 *     This is a display-only assumption, NOT a measured Arc gas cost.
 *     Actual Arc Testnet gas for a real tx varies and is measured separately.
 *
 * Price source: Binance public WebSocket / REST API.
 *   Pair:         BTCUSDT (BTC priced in USDT, not USD)
 *   Provider:     Binance
 *   No affiliation with Binance; the public API is used as a free data source.
 *   Terms: https://www.binance.com/en/terms
 *   This app does not place any orders on Binance.
 */

export const SIM_FEE_BPS = 10         // 0.10% simulated taker fee
export const SIM_SLIPPAGE_BPS = 5     // 0.05% simulated adverse slippage
export const SIM_GAS_USDC = 0 // paper fills do not submit chain transactions

// Strategy version stamp — bump when logic changes to invalidate old snapshots
export const STRATEGY_VERSION = '1.2.0'

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

/**
 * Arc integration status for a paper fill.
 * 'not_submitted' — paper-only, no wallet action taken.
 * 'awaiting_signature' — user wallet prompt shown (not yet signed).
 * 'pending' — tx broadcast, awaiting confirmation.
 * 'confirmed' — tx has a real on-chain receipt.
 * 'failed' — tx reverted or rejected.
 * null — status not applicable (legacy records).
 */
export type ArcTxStatus = 'not_submitted' | 'awaiting_signature' | 'pending' | 'confirmed' | 'failed' | null

export interface Trade {
  id: string              // unique trade ID
  signalId: string | null // unique signal ID (prevents duplicate fills per signal)
  side: 'buy' | 'sell'
  btcAmount: number
  execPrice: number       // after simulated slippage
  notional: number        // btcAmount * execPrice
  fee: number             // simulated taker fee in USDC
  slippage: number        // simulated slippage cost in USDC
  simGasUsdc: number      // simulated gas cost in USDC (not a real measurement)
  realizedPnl: number | null  // only populated on sells
  timestamp: number
  source: 'manual' | 'strategy'
  txHash: string | null   // only populated after a real on-chain tx confirms
  arcTxStatus: ArcTxStatus
}

export interface Position {
  btcAmount: number
  avgEntryPrice: number
  totalCost: number   // total USDC notional paid (ex fees)
}

/** Snapshot of strategy config and simulation assumptions at experiment start */
export interface StrategySnapshot {
  version: string             // STRATEGY_VERSION
  shortPeriod: number
  longPeriod: number
  candleIntervalMs: number    // e.g. 60_000 for 1-minute candles
  rule: string                // human-readable rule description
  orderSizeUsdc: number
  maxAllocationPct: number
  stopLossPct: number
  simFeeBps: number
  simSlippageBps: number
  simGasUsdc: number
  startedAt: number           // epoch ms
}

export interface StrategyConfig {
  shortPeriod: number       // e.g. 5 candles
  longPeriod: number        // e.g. 20 candles
  candleIntervalMs: number  // candle duration in ms; default 60_000 (1 min)
  orderSizeUsdc: number     // USDC per trade
  maxAllocationPct: number  // 0-100
  stopLossPct: number       // 0-100, 0 = disabled
}

export const DEFAULT_STRATEGY: StrategyConfig = {
  shortPeriod: 5,
  longPeriod: 20,
  candleIntervalMs: 60_000,
  orderSizeUsdc: 10,
  maxAllocationPct: 80,
  stopLossPct: 5,
}

// ------------------------------------------------------------------
// 1-minute closed candle aggregator
// ------------------------------------------------------------------

export interface Candle {
  open: number
  high: number
  low: number
  close: number
  openTime: number  // start of the candle window (epoch ms)
  closeTime: number // end of the candle window (epoch ms)
  closed: boolean   // true once the candle's minute boundary has passed
}

/**
 * Aggregate a stream of raw ticks into closed 1-minute candles.
 * Ticks that fall in the current (open) candle update it.
 * A tick in a NEW minute closes the previous candle first.
 * Returns only CLOSED candles — never the live partial candle.
 */
export function aggregateCandles(
  ticks: { time: number; price: number }[],
  intervalMs = 60_000,
): Candle[] {
  if (ticks.length === 0) return []

  const candles: Candle[] = []
  let current: {
    open: number; high: number; low: number; close: number
    openTime: number; closeTime: number
  } | null = null

  for (const tick of ticks) {
    const bucketStart = Math.floor(tick.time / intervalMs) * intervalMs
    const bucketEnd = bucketStart + intervalMs - 1

    if (!current || bucketStart !== current.openTime) {
      // close out the previous candle
      if (current) {
        candles.push({ ...current, closed: true })
      }
      current = {
        open: tick.price, high: tick.price, low: tick.price, close: tick.price,
        openTime: bucketStart, closeTime: bucketEnd,
      }
    } else {
      current.high = Math.max(current.high, tick.price)
      current.low = Math.min(current.low, tick.price)
      current.close = tick.price
    }
  }
  // current candle is NOT pushed (it is open/partial)
  return candles
}

// ------------------------------------------------------------------
// Price calculations
// ------------------------------------------------------------------

/** Apply 0.05% adverse slippage on top of raw price for a buy */
export function effectiveBuyPrice(rawPrice: number): number {
  return rawPrice * (1 + SIM_SLIPPAGE_BPS / 10_000)
}

/** Apply 0.05% adverse slippage below raw price for a sell */
export function effectiveSellPrice(rawPrice: number): number {
  return rawPrice * (1 - SIM_SLIPPAGE_BPS / 10_000)
}

/** 0.10% simulated taker fee */
export function calcFee(notional: number): number {
  return (notional * SIM_FEE_BPS) / 10_000
}

/** Simulated slippage cost in USDC (display only, already baked into exec price) */
export function calcSlippageCost(notional: number): number {
  return (notional * SIM_SLIPPAGE_BPS) / 10_000
}

// ------------------------------------------------------------------
// Simple moving average
// ------------------------------------------------------------------

/** SMA over last `period` values. Returns null if insufficient data. */
export function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null
  const slice = prices.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

// ------------------------------------------------------------------
// MA crossover signal — operates on CLOSED candles only
// ------------------------------------------------------------------

/**
 * Detect a NEW crossover on closed candles.
 *
 * Rules (5/20 SMA by default, configurable):
 *   Buy signal:  Short MA was <= Long MA on the previous closed candle,
 *                AND Short MA is > Long MA on the current closed candle.
 *                => This is a NEW bullish crossover.
 *   Sell signal: Short MA was >= Long MA on the previous closed candle,
 *                AND Short MA is < Long MA on the current closed candle.
 *                => This is a NEW bearish crossover.
 *   No signal:   If there is no crossover, or insufficient candles for warm-up.
 *
 * Warm-up requirement: need at least `longPeriod + 1` closed candles.
 * The strategy will NOT fire on the first candle after warm-up where data only
 * spans exactly `longPeriod` — it needs `longPeriod + 1` so it can compare
 * current vs previous MA values.
 *
 * Returns a unique signalId string on a crossover, null otherwise.
 */
export function detectMaCrossover(
  closedCandles: Candle[],
  short: number,
  long: number,
): { signal: 1 | -1; signalId: string; candleTime: number } | null {
  const warmupRequired = long + 1
  if (closedCandles.length < warmupRequired) return null

  const closes = closedCandles.map(c => c.close)
  const lastCandle = closedCandles[closedCandles.length - 1]
  const prevCandle = closedCandles[closedCandles.length - 2]

  const currShort = sma(closes, short)
  const currLong = sma(closes, long)
  const prevCloses = closes.slice(0, -1)
  const prevShort = sma(prevCloses, short)
  const prevLong = sma(prevCloses, long)

  if (!currShort || !currLong || !prevShort || !prevLong) return null

  const crossedUp = prevShort <= prevLong && currShort > currLong
  const crossedDown = prevShort >= prevLong && currShort < currLong

  if (!crossedUp && !crossedDown) return null

  // Build a deterministic signal ID from candle boundaries
  const signalId = `sig-${crossedUp ? 'buy' : 'sell'}-${lastCandle.openTime}-${prevCandle.openTime}`

  return {
    signal: crossedUp ? 1 : -1,
    signalId,
    candleTime: lastCandle.closeTime,
  }
}

/** Legacy tick-based crossover for MA overlay display only (not used for trade signals) */
export function maCrossoverSignal(
  prices: number[],
  short: number,
  long: number,
): 1 | -1 | 0 {
  if (prices.length < long + 1) return 0
  const prevSlice = prices.slice(0, -1)
  const currShort = sma(prices, short)
  const currLong = sma(prices, long)
  const prevShort = sma(prevSlice, short)
  const prevLong = sma(prevSlice, long)
  if (!currShort || !currLong || !prevShort || !prevLong) return 0
  if (prevShort <= prevLong && currShort > currLong) return 1
  if (prevShort >= prevLong && currShort < currLong) return -1
  return 0
}

// ------------------------------------------------------------------
// Trade record builder
// ------------------------------------------------------------------

export function generateTradeId(): string {
  return `tl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Build a paper trade record.
 * txHash and arcTxStatus are always null/not_submitted initially.
 * A real tx hash is only ever set after a real confirmed on-chain receipt.
 */
export function buildTrade(
  side: 'buy' | 'sell',
  btcAmount: number,
  rawPrice: number,
  source: 'manual' | 'strategy',
  signalId: string | null = null,
): Trade {
  const exec = side === 'buy' ? effectiveBuyPrice(rawPrice) : effectiveSellPrice(rawPrice)
  const notional = btcAmount * exec
  const fee = calcFee(notional)
  const slippage = calcSlippageCost(notional)
  return {
    id: generateTradeId(),
    signalId,
    side, btcAmount, execPrice: exec, notional, fee, slippage,
    simGasUsdc: SIM_GAS_USDC,
    realizedPnl: null,
    timestamp: Date.now(),
    source,
    txHash: null,
    arcTxStatus: 'not_submitted',
  }
}

// ------------------------------------------------------------------
// Strategy snapshot builder
// ------------------------------------------------------------------

export function buildStrategySnapshot(cfg: StrategyConfig): StrategySnapshot {
  return {
    version: STRATEGY_VERSION,
    shortPeriod: cfg.shortPeriod,
    longPeriod: cfg.longPeriod,
    candleIntervalMs: cfg.candleIntervalMs,
    rule: `Buy on NEW bullish SMA${cfg.shortPeriod}/SMA${cfg.longPeriod} crossover (flat). ` +
          `Sell on NEW bearish crossover (long). ` +
          `Interval: ${cfg.candleIntervalMs / 1000}s closed candles. ` +
          `Warm-up: ${cfg.longPeriod + 1} closed candles required. ` +
          `Stop loss: ${cfg.stopLossPct}% from fee-inclusive entry, evaluated at candle close. ` +
          `Live fills use a fresh observed quote after the signal. ` +
          `Allocation cap: ${cfg.maxAllocationPct}% of initial cash plus realized P&L, measured by all-in cost basis.`,
    orderSizeUsdc: cfg.orderSizeUsdc,
    maxAllocationPct: cfg.maxAllocationPct,
    stopLossPct: cfg.stopLossPct,
    simFeeBps: SIM_FEE_BPS,
    simSlippageBps: SIM_SLIPPAGE_BPS,
    simGasUsdc: SIM_GAS_USDC,
    startedAt: Date.now(),
  }
}

// ------------------------------------------------------------------
// Portfolio metrics
// ------------------------------------------------------------------

/** Unrealized P&L: current market value minus cost basis */
export function calcUnrealizedPnl(pos: Position, currentPrice: number): number {
  if (pos.btcAmount === 0) return 0
  return (currentPrice - pos.avgEntryPrice) * pos.btcAmount
}

/**
 * Maximum drawdown from peak portfolio value history (%).
 * Requires at least 2 data points; returns 0 otherwise.
 */
export function calcMaxDrawdown(values: number[]): number {
  if (values.length < 2) return 0
  let peak = values[0]
  let maxDD = 0
  for (const v of values) {
    if (v > peak) peak = v
    const dd = peak > 0 ? (peak - v) / peak * 100 : 0
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

/**
 * Buy-and-hold return vs strategy return.
 * Returns null if insufficient data (no trades, or entry price not available).
 */
export function calcBuyAndHoldReturn(
  initialPrice: number | null,
  currentPrice: number | null,
): number | null {
  if (!initialPrice || !currentPrice || initialPrice <= 0) return null
  return ((currentPrice - initialPrice) / initialPrice) * 100
}
