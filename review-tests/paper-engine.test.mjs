import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPaperLedger, fillPaperOrder, markPaperLedger } from '../src/trading/paperLedger.ts'
import { runSmaBacktest } from '../src/trading/backtest.ts'

const costs = { feeBps: 10, slippageBps: 5 }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
const buy = (state, amount = 10, id = 'b') => fillPaperOrder(state, { id, side: 'buy', referencePrice: 100, amount }, costs)

test('all-in buy never spends more than the cash budget, including fees', () => {
  const start = createPaperLedger(10)
  const result = buy(start)
  assert.equal(result.ok, true)
  near(result.ledger.cash, 0)
  near(result.fill.notional + result.fill.fee, 10)
  assert.equal(result.fill.networkGas, 0)
  assert.equal(result.fill.chainStatus, 'not_submitted')
  assert.equal(start.cash, 10)
})

test('round trip charges BOTH fees and slippage; realized P/L reconciles to equity', () => {
  const first = buy(createPaperLedger(100))
  const sold = fillPaperOrder(first.ledger, { id: 's', side: 'sell', amount: first.ledger.btc, referencePrice: 100 }, costs)
  assert.equal(sold.ok, true)
  assert.ok(sold.ledger.realizedPnl < -0.029)
  near(sold.ledger.cash - 100, sold.ledger.realizedPnl)
  assert.equal(sold.ledger.costBasis, 0)
  assert.equal(sold.ledger.btc, 0)
})

test('partial sales allocate buy fees proportionally and preserve accounting identity', () => {
  const first = buy(createPaperLedger(100))
  const sold = fillPaperOrder(first.ledger, { id: 'half', side: 'sell', amount: first.ledger.btc / 2, referencePrice: 110 }, costs)
  near(sold.ledger.costBasis, 5)
  const mark = markPaperLedger(sold.ledger, 110)
  near(mark.equity - 100, mark.realizedPnl + mark.unrealizedPnl)
})

test('invalid values, insufficient cash, duplicate orders, and overselling are blocked', () => {
  const start = createPaperLedger(100)
  for (const bad of [NaN, Infinity, -1, 0]) assert.equal(buy(start, bad).ok, false)
  assert.equal(buy(start, 101).ok, false)
  const first = buy(start)
  assert.equal(buy(first.ledger).ok, false)
  assert.equal(fillPaperOrder(first.ledger, { id: 's', side: 'sell', amount: first.ledger.btc + 1, referencePrice: 100 }, costs).ok, false)
})

const config = { ...costs, shortPeriod: 2, longPeriod: 3, intervalMs: 60_000, initialCash: 100, orderCash: 10 }
function dataset(closes = [100, 100, 100, 99, 105, 106, 90, 89, 110, 111]) {
  return {
    source: 'SYNTHETIC UNIT TEST — not market evidence', symbol: 'BTCUSDT', quoteCurrency: 'USDT', retrievedAt: '2026-10-18T00:00:00Z',
    candles: closes.map((close, i) => ({ openTime: i * 60_000, open: close - 0.1, high: close + 1, low: close - 1, close })),
  }
}

test('crossovers fill at the next open, with no same-candle look-ahead', () => {
  const data = dataset()
  const result = runSmaBacktest(data, config)
  assert.ok(result.fills.length >= 2)
  for (const fill of result.fills) {
    assert.equal(fill.timestamp, fill.signalTime + 1)
    assert.equal(fill.referencePrice, data.candles.find(c => c.openTime === fill.timestamp).open)
  }
  near(result.equityCurve.at(-1).value - 100, result.realizedPnl + result.unrealizedPnl)
  assert.equal(result.assumptions.cashCurrency, 'USDT')
})

test('future candle changes cannot alter already executed fills', () => {
  const original = dataset()
  const changed = dataset()
  changed.candles[8] = { ...changed.candles[8], open: 50, high: 51, low: 49, close: 50 }
  changed.candles[9] = { ...changed.candles[9], open: 60, high: 61, low: 59, close: 60 }
  const past = result => result.fills.filter(f => f.timestamp < 8 * 60_000)
  assert.deepEqual(past(runSmaBacktest(original, config)), past(runSmaBacktest(changed, config)))
})

test('bad provenance, gaps, reordered candles, invalid prices, and short histories fail closed', () => {
  for (const modify of [
    d => { d.source = '' },
    d => { d.candles[5].openTime += 60_000 },
    d => { d.candles[5].close = NaN },
    d => { d.candles.reverse() },
    d => { d.candles = d.candles.slice(0, 3) },
  ]) {
    const data = dataset(); modify(data)
    assert.throws(() => runSmaBacktest(data, config))
  }
})

test('flat history makes no invented trades; last-candle signals remain unfilled', () => {
  const result = runSmaBacktest(dataset(Array(10).fill(100)), config)
  assert.equal(result.fills.length, 0)
  assert.equal(result.returnPct, 0)
  const lastSignal = runSmaBacktest(dataset([100, 100, 100, 99, 105]), config)
  assert.equal(lastSignal.fills.length, 0)
  assert.equal(lastSignal.pendingSignalAtEnd.side, 'buy')
})

test('allocation caps every all-in entry using the realized budget, including both buy costs', () => {
  const result = runSmaBacktest(dataset(), { ...config, maxAllocationPct: 2 })
  let cash = 100, realized = 0
  for (const fill of result.fills) {
    if (fill.side === 'buy') {
      near(-fill.cashDelta, Math.min(10, cash, (100 + realized) * 0.02))
      near(fill.notional + fill.fee, -fill.cashDelta)
    }
    cash += fill.cashDelta
    realized += fill.realizedPnl
  }
  assert.ok(result.fills.filter(f => f.side === 'buy').length >= 2)
  assert.equal(result.config.maxAllocationPct, 2)
  assert.equal(result.config.stopLossPct, 0)
  assert.equal(result.assumptions.allocation, 'all_in_cost_basis_capped_by_initial_cash_plus_realized_pnl')
  const largeOrder = runSmaBacktest(dataset(), { ...config, orderCash: 1000 })
  near(-largeOrder.fills.find(f => f.side === 'buy').cashDelta, 100)
  const belowMinimum = runSmaBacktest(dataset(), { ...config, initialCash: 0.01, maxAllocationPct: 1 })
  assert.equal(belowMinimum.fills.length, 0)
  assert.ok(belowMinimum.skippedOrders.length > 0)
})

test('stop loss takes priority over bearish crossover and fills only at the next open, including gaps', () => {
  const data = dataset()
  data.candles[5].low = 1 // An intrabar low alone cannot trigger a modeled close-only stop.
  data.candles[7] = { ...data.candles[7], open: 70, low: 69 }
  const result = runSmaBacktest(data, { ...config, stopLossPct: 5 })
  const firstSell = result.fills.find(f => f.side === 'sell')
  assert.equal(firstSell.signalReason, 'stop_loss')
  assert.equal(firstSell.signalTime, data.candles[6].openTime + 59_999)
  assert.equal(firstSell.timestamp, data.candles[7].openTime)
  assert.equal(firstSell.referencePrice, 70)
  assert.ok(firstSell.executionPrice < 70)
  assert.ok(firstSell.realizedPnl < -3)
  assert.equal(result.assumptions.stopLoss, 'closed_candle_close_vs_fee_inclusive_entry_basis_then_next_open')
  assert.match(result.disclosure, /live fills use an observed current quote/)
  assert.match(result.disclosure, /Gaps may exceed the stop threshold/)
})

test('stop thresholds use fee-inclusive entry basis and final stop signals remain pending', () => {
  const data = dataset([100, 100, 100, 99, 105, 95.1, 90, 89])
  data.candles[5] = { ...data.candles[5], open: 100, high: 101 }
  const result = runSmaBacktest(data, { ...config, stopLossPct: 5 })
  const bought = result.fills.find(f => f.side === 'buy')
  const basisPerBtc = -bought.cashDelta / bought.btc
  assert.ok((bought.executionPrice - 95.1) / bought.executionPrice * 100 < 5)
  assert.ok((basisPerBtc - 95.1) / basisPerBtc * 100 > 5)
  const sold = result.fills.find(f => f.side === 'sell')
  assert.equal(sold.signalReason, 'stop_loss')
  assert.equal(sold.timestamp, data.candles[6].openTime)
  const atEnd = runSmaBacktest(dataset([100, 100, 100, 99, 105, 106, 90]), { ...config, stopLossPct: 5 })
  assert.equal(atEnd.pendingSignalAtEnd.reason, 'stop_loss')
  assert.equal(atEnd.fills.filter(f => f.side === 'sell').length, 0)
  assert.ok(atEnd.ledger.btc > 0)
})

test('backtest drawdown explicitly samples closes and does not invent intrabar execution', () => {
  const normal = dataset()
  const lowSpike = dataset()
  lowSpike.candles[5].low = 1
  const first = runSmaBacktest(normal, config)
  const second = runSmaBacktest(lowSpike, config)
  assert.equal(first.maxDrawdownPct, second.maxDrawdownPct)
  assert.deepEqual(first.fills, second.fills)
  assert.equal(second.assumptions.drawdown, 'close_only_marks_not_intrabar')
})

test('malformed provenance, nonfinite extremes and not-yet-closed input candles fail cleanly', () => {
  for (const data of [null, [], {}, { ...dataset(), source: 7 }, { ...dataset(), symbol: null },
    { ...dataset(), quoteCurrency: [] }, { ...dataset(), retrievedAt: 'yesterday' },
    { ...dataset(), candles: null }, { ...dataset(), candles: [...dataset().candles, null] }]) {
    assert.throws(() => runSmaBacktest(data, config), error => error instanceof Error && !(error instanceof TypeError))
  }
  const notClosed = dataset()
  notClosed.retrievedAt = new Date(notClosed.candles.at(-1).openTime + 59_999).toISOString()
  assert.throws(() => runSmaBacktest(notClosed, config), /not-yet-closed/)
  notClosed.retrievedAt = new Date(notClosed.candles.at(-1).openTime + 60_000).toISOString()
  assert.doesNotThrow(() => runSmaBacktest(notClosed, config))
  const hugePrice = dataset()
  hugePrice.candles.at(-1).high = Number.MAX_VALUE
  assert.throws(() => runSmaBacktest(hugePrice, config), /Invalid/)
  for (const [field, badValues] of Object.entries({
    shortPeriod: [0, 1.5, NaN], longPeriod: [501, Infinity],
    intervalMs: [0, 1.5, 86_400_001], initialCash: [0, 0.001, 1e20, NaN],
    orderCash: [0, 0.001, 1_000_001, NaN], maxAllocationPct: [null, 0, 101, NaN],
    stopLossPct: [null, -1, 101, Infinity], feeBps: [-1, 10_000, NaN], slippageBps: [-1, 10_000, Infinity],
  })) {
    for (const value of badValues) assert.throws(() => runSmaBacktest(dataset(), { ...config, [field]: value }), /Invalid backtest configuration/)
  }
})
