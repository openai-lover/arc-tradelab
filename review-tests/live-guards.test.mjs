import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canApplyLiveConfig, canEvaluateLiveCandles, closedCandleStopTriggered, isRestorableLiveState, isValidLiveConfig, startCandleBoundary } from '../src/trading/liveGuards.ts'

const config = { shortPeriod: 2, longPeriod: 3, candleIntervalMs: 60_000, orderSizeUsdc: 10, maxAllocationPct: 80, stopLossPct: 5 }
const candle = openTime => ({ openTime, closeTime: openTime + 59_999, open: 100, high: 101, low: 99, close: 100, closed: true })
const history = [60_000, 120_000, 180_000, 240_000].map(candle)

test('live configs reject inverted/fractional periods, unsupported intervals and nonfinite risk settings', () => {
  assert.equal(isValidLiveConfig(config), true)
  for (const patch of [
    { shortPeriod: 3 }, { shortPeriod: 0 }, { shortPeriod: 1.5 }, { longPeriod: 501 },
    { candleIntervalMs: 300_000 }, { orderSizeUsdc: NaN }, { orderSizeUsdc: -1 },
    { maxAllocationPct: Infinity }, { maxAllocationPct: 101 }, { stopLossPct: -1 },
  ]) assert.equal(isValidLiveConfig({ ...config, ...patch }), false)
})

test('a rule change requires a reset after any fill; reapplying identical rules is harmless', () => {
  const next = { ...config, shortPeriod: 1 }
  assert.equal(canApplyLiveConfig(config, next, { running: false, btcAmount: 0, tradeCount: 0 }), true)
  for (const execution of [
    { running: true, btcAmount: 0, tradeCount: 0 },
    { running: false, btcAmount: 0.1, tradeCount: 1 },
    { running: false, btcAmount: 0, tradeCount: 2 },
  ]) {
    assert.equal(canApplyLiveConfig(config, next, execution), false)
    assert.equal(canApplyLiveConfig(config, { ...config }, execution), true)
  }
})

test('Start before initial history arrives skips historical signals and allows only the next close', () => {
  const startedAt = 325_000 // during the minute beginning at 300,000
  const boundary = startCandleBoundary(startedAt)
  assert.equal(boundary, 240_000)
  assert.equal(canEvaluateLiveCandles(history, config, boundary, startedAt), false)
  assert.equal(canEvaluateLiveCandles([...history, candle(300_000)], config, boundary, 365_000), true)
  assert.equal(canEvaluateLiveCandles([...history, candle(300_000)], config, 300_000, 365_000), false)
})

test('gapped, open, future, invalid and delayed candles cannot trigger a live trade', () => {
  assert.equal(canEvaluateLiveCandles(history, config, 0, 305_000), true)
  assert.equal(canEvaluateLiveCandles(history, config, 0, 335_000), false)
  for (const modify of [
    h => { h[1].openTime += 60_000; h[1].closeTime += 60_000 },
    h => { h[3].closed = false },
    h => { h[3].close = Infinity },
    h => { h[3].low = 100.5 },
    h => { h[3].high = 99.5 },
    h => { h[3] = candle(360_000) },
  ]) {
    const changed = structuredClone(history)
    modify(changed)
    assert.equal(canEvaluateLiveCandles(changed, config, 0, 305_000), false)
  }
})

test('stop loss uses the closed candle and fee-inclusive entry basis, with no intrabar trigger', () => {
  const position = { btcAmount: 0.1, avgEntryPrice: 100, totalCost: 10 }
  const recovered = { ...candle(240_000), low: 90, close: 100 }
  assert.equal(closedCandleStopTriggered(position, recovered, 5), false)
  const dropped = { ...recovered, close: 94 }
  assert.equal(closedCandleStopTriggered(position, dropped, 5), true)
  assert.equal(closedCandleStopTriggered(position, { ...dropped, closed: false }, 5), false)
  assert.equal(closedCandleStopTriggered(position, dropped, 0), false)
  assert.equal(closedCandleStopTriggered({ ...position, btcAmount: 0 }, dropped, 5), false)
})

function stored() {
  return {
    depositedUsdc: 100, realizedGains: 0, spentUsdc: 10, reservedUsdc: 0,
    position: { btcAmount: 0.1, avgEntryPrice: 100, totalCost: 10 },
    realizedPnl: 0, maxDrawdown: 0, peakEquity: 100, trades: [], strategyStatus: 'running', strategyConfig: config,
    meta: { experimentId: 'paper', startedAt: 100_000, btcPriceAtStart: 100, strategySnapshot: null },
    lastFilledSignalId: 'buy-1', lastOrderTime: 200_000, lastEvaluatedCandleTime: 180_000,
  }
}

test('restored portfolios require consistent cash, cost basis, risk settings and experiment identity', () => {
  assert.equal(isRestorableLiveState(stored(), 'paper', 305_000), true)
  assert.equal(isRestorableLiveState(stored(), 'other-wallet', 305_000), false)
  for (const modify of [
    s => { s.position = null },
    s => { s.position.avgEntryPrice = 101 },
    s => { s.spentUsdc = 101 },
    s => { s.position.btcAmount = 0 },
    s => { s.realizedGains = 3 },
    s => { s.maxDrawdown = 101 },
    s => { s.strategyConfig = { ...config, longPeriod: 2 } },
    s => { s.meta = {} },
    s => { s.meta.strategySnapshot = {} },
    s => { s.lastEvaluatedCandleTime = 900_000 },
  ]) {
    const changed = stored()
    modify(changed)
    assert.equal(isRestorableLiveState(changed, 'paper', 305_000), false)
  }
})

test('storage cannot supply fabricated transaction confirmations or malformed trade records', () => {
  const s = stored()
  s.trades = [{ id: 'buy-1', signalId: null, side: 'buy', source: 'manual', btcAmount: 0.1, execPrice: 100,
    notional: 10, fee: 0.01, slippage: 0.005, simGasUsdc: 0, realizedPnl: null,
    timestamp: 200_000, txHash: null, arcTxStatus: 'not_submitted' }]
  assert.equal(isRestorableLiveState(s, 'paper', 305_000), true)
  s.trades[0].arcTxStatus = 'confirmed'
  s.trades[0].txHash = '0xmade-up'
  assert.equal(isRestorableLiveState(s, 'paper', 305_000), false)
  s.trades = [null]
  assert.equal(isRestorableLiveState(s, 'paper', 305_000), false)
})
