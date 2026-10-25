import type { Candle, Position, StrategyConfig } from './engine'

export const LIVE_CANDLE_INTERVAL_MS = 60_000
export const MAX_SIGNAL_DELAY_MS = 30_000

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
const positive = (value: unknown): value is number => nonnegative(value) && value > 0
const sameAmount = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b))

/** The live feed currently supplies only one-minute candles, with up to 600 closed bars. */
export function isValidLiveConfig(value: unknown): value is StrategyConfig {
  if (!record(value)) return false
  return Number.isInteger(value.shortPeriod) && Number.isInteger(value.longPeriod)
    && positive(value.shortPeriod) && positive(value.longPeriod)
    && value.shortPeriod < value.longPeriod && value.longPeriod <= 500
    && value.candleIntervalMs === LIVE_CANDLE_INTERVAL_MS
    && positive(value.orderSizeUsdc)
    && positive(value.maxAllocationPct) && value.maxAllocationPct <= 100
    && nonnegative(value.stopLossPct) && value.stopLossPct <= 100
}

export function isSameLiveConfig(a: StrategyConfig, b: StrategyConfig): boolean {
  return a.shortPeriod === b.shortPeriod && a.longPeriod === b.longPeriod
    && a.candleIntervalMs === b.candleIntervalMs && a.orderSizeUsdc === b.orderSizeUsdc
    && a.maxAllocationPct === b.maxAllocationPct && a.stopLossPct === b.stopLossPct
}

/** Completed trades remain attributed to one config until the experiment is reset. */
export function canApplyLiveConfig(
  current: StrategyConfig, next: StrategyConfig,
  execution: { running: boolean; btcAmount: number; tradeCount: number },
): boolean {
  return isValidLiveConfig(next) && (isSameLiveConfig(current, next)
    || (!execution.running && execution.btcAmount === 0 && execution.tradeCount === 0))
}

/** Skip every candle already closed at Start, even if history arrives after Start. */
export function startCandleBoundary(now: number, lastCandleOpenTime = 0): number {
  return Math.max(lastCandleOpenTime, Math.floor(now / LIVE_CANDLE_INTERVAL_MS) * LIVE_CANDLE_INTERVAL_MS - LIVE_CANDLE_INTERVAL_MS)
}

/** Require contiguous, actually closed and recent exchange candles for a new live signal. */
export function canEvaluateLiveCandles(
  candles: Candle[], config: StrategyConfig, lastEvaluatedOpenTime: number, now: number,
): boolean {
  if (!isValidLiveConfig(config) || candles.length === 0) return false
  const recent = candles.slice(-(config.longPeriod + 1))
  const latest = recent[recent.length - 1]
  if (latest.openTime <= lastEvaluatedOpenTime || latest.closeTime >= now
      || now - latest.closeTime > MAX_SIGNAL_DELAY_MS) return false
  return recent.every((c, i) =>
    c.closed === true && Number.isInteger(c.openTime) && c.openTime >= 0
    && c.openTime % LIVE_CANDLE_INTERVAL_MS === 0
    && c.closeTime === c.openTime + LIVE_CANDLE_INTERVAL_MS - 1
    && [c.open, c.high, c.low, c.close].every(positive)
    && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close)
    && (i === 0 || c.openTime === recent[i - 1].openTime + LIVE_CANDLE_INTERVAL_MS))
}

/** Close-only stop trigger; a fill still uses the current observed quote. */
export function closedCandleStopTriggered(position: Position, candle: Candle, stopLossPct: number): boolean {
  return candle.closed && positive(candle.close) && positive(position.btcAmount)
    && positive(position.avgEntryPrice) && positive(stopLossPct) && stopLossPct <= 100
    && (position.avgEntryPrice - candle.close) / position.avgEntryPrice * 100 >= stopLossPct
}

/** Reject malformed or internally inconsistent browser storage instead of trading it. */
export function isRestorableLiveState(value: unknown, experimentId: string, now: number): boolean {
  if (!record(value) || !record(value.position) || !record(value.meta)
      || !isValidLiveConfig(value.strategyConfig)) return false
  const p = value.position
  if (![value.depositedUsdc, value.spentUsdc, value.reservedUsdc, value.peakEquity,
      value.maxDrawdown, p.btcAmount, p.avgEntryPrice, p.totalCost].every(nonnegative)
      || (value.maxDrawdown as number) > 100
      || typeof value.realizedGains !== 'number' || !Number.isFinite(value.realizedGains)
      || typeof value.realizedPnl !== 'number' || !Number.isFinite(value.realizedPnl)) return false
  const deposited = value.depositedUsdc as number
  const spent = value.spentUsdc as number
  const freeCash = deposited + value.realizedGains - spent - (value.reservedUsdc as number)
  if (!Number.isFinite(freeCash) || freeCash < -1e-7
      || !sameAmount(value.realizedGains, value.realizedPnl)
      || !sameAmount(spent, p.totalCost as number)) return false
  if (p.btcAmount === 0
    ? p.avgEntryPrice !== 0 || p.totalCost !== 0
    : !positive(p.avgEntryPrice) || !positive(p.totalCost)
      || !sameAmount((p.btcAmount as number) * p.avgEntryPrice, p.totalCost)) return false
  const timestamp = (v: unknown) => nonnegative(v) && v <= now + 2_000
  if (!['idle', 'running', 'paused'].includes(value.strategyStatus as string)
      || value.meta.experimentId !== experimentId || !timestamp(value.meta.startedAt)
      || !(value.meta.btcPriceAtStart === null || positive(value.meta.btcPriceAtStart))
      || !(value.lastFilledSignalId === null || typeof value.lastFilledSignalId === 'string')
      || !(value.lastOrderTime === null || timestamp(value.lastOrderTime))
      || !timestamp(value.lastEvaluatedCandleTime)) return false
  const snapshot = value.meta.strategySnapshot
  if (snapshot !== null && (!record(snapshot) || !isValidLiveConfig(snapshot)
      || typeof snapshot.version !== 'string' || typeof snapshot.rule !== 'string'
      || !timestamp(snapshot.startedAt) || !nonnegative(snapshot.simFeeBps)
      || !nonnegative(snapshot.simSlippageBps) || snapshot.simGasUsdc !== 0)) return false
  if (!Array.isArray(value.trades) || value.trades.length > 200) return false
  if (value.trades.length > 0 && record(snapshot)
      && !isSameLiveConfig(value.strategyConfig, snapshot)) return false
  return value.trades.every(t => record(t) && typeof t.id === 'string' && t.id.length > 0
    && ['buy', 'sell'].includes(t.side as string) && ['manual', 'strategy'].includes(t.source as string)
    && [t.btcAmount, t.execPrice, t.notional].every(positive)
    && [t.fee, t.slippage].every(nonnegative) && t.simGasUsdc === 0
    && (t.realizedPnl === null || (typeof t.realizedPnl === 'number' && Number.isFinite(t.realizedPnl)))
    && (t.signalId === null || typeof t.signalId === 'string') && timestamp(t.timestamp)
    // This prototype has no onchain executor. Browser storage cannot supply transaction evidence.
    && t.txHash === null && t.arcTxStatus === 'not_submitted')
}
