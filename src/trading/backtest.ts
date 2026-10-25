import { createPaperLedger, fillPaperOrder, markPaperLedger } from './paperLedger.ts'
import type { FillAssumptions, PaperFill } from './paperLedger.ts'

export interface HistoricalCandle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
}

export interface BacktestConfig extends FillAssumptions {
  shortPeriod: number
  longPeriod: number
  intervalMs: number
  initialCash: number
  orderCash: number // all-in maximum debit, including simulation fees
  maxAllocationPct?: number // defaults to 100; cap includes entry fees
  stopLossPct?: number // defaults to 0 (disabled); checked at candle close only
}

export interface HistoricalDataset {
  source: string
  symbol: string
  quoteCurrency: string
  retrievedAt: string
  candles: HistoricalCandle[]
}

const mean = (values: number[], end: number, period: number) => {
  let sum = 0
  for (let i = end - period + 1; i <= end; i++) sum += values[i]
  return sum / period
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finiteWithin = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const provenanceText = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value)

/** Signals use a closed candle; execution is at the NEXT candle open. */
export function runSmaBacktest(dataset: HistoricalDataset, config: BacktestConfig) {
  if (!isRecord(dataset) || !provenanceText(dataset.source, 512)
      || !provenanceText(dataset.symbol, 32) || !provenanceText(dataset.quoteCurrency, 16)
      || typeof dataset.retrievedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(dataset.retrievedAt)
      || !Number.isFinite(Date.parse(dataset.retrievedAt))) throw new Error('Dataset provenance with an ISO-8601 retrieval timestamp is required')
  if (!isRecord(config)) throw new Error('Invalid backtest configuration')
  const maxAllocationPct = config.maxAllocationPct === undefined ? 100 : config.maxAllocationPct
  const stopLossPct = config.stopLossPct === undefined ? 0 : config.stopLossPct
  if (!Number.isInteger(config.shortPeriod) || !Number.isInteger(config.longPeriod)
      || config.shortPeriod < 1 || config.shortPeriod >= config.longPeriod || config.longPeriod > 500
      || !Number.isInteger(config.intervalMs) || !finiteWithin(config.intervalMs, 1, 86_400_000)
      || !finiteWithin(config.initialCash, 0.01, 1_000_000_000)
      || !finiteWithin(config.orderCash, 0.01, 1_000_000)
      || !finiteWithin(maxAllocationPct, 0.01, 100) || !finiteWithin(stopLossPct, 0, 100)
      || ![config.feeBps, config.slippageBps].every(v => finiteWithin(v, 0, 9_999.999999))) {
    throw new Error('Invalid backtest configuration')
  }
  const normalizedConfig = { ...config, maxAllocationPct, stopLossPct }
  const candles = dataset.candles
  if (!Array.isArray(candles) || candles.length > 50_000) throw new Error('Expected at most 50,000 historical candles')
  if (candles.length < config.longPeriod + 2) throw new Error('Insufficient closed-candle history')
  const retrievedAt = Date.parse(dataset.retrievedAt)
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (!isRecord(c) || !Number.isSafeInteger(c.openTime) || c.openTime < 0 || c.openTime % config.intervalMs !== 0
        || !Number.isSafeInteger(c.openTime + config.intervalMs) || c.openTime + config.intervalMs > retrievedAt
        || ![c.open, c.high, c.low, c.close].every(p => finiteWithin(p, 0.00000001, 1_000_000_000_000))
        || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)
        || c.low > c.high) throw new Error(`Invalid or not-yet-closed candle at ${i}`)
    if (i && c.openTime !== candles[i - 1].openTime + config.intervalMs) throw new Error(`Unsorted, duplicate, or missing candle at ${i}`)
  }
  const closes = candles.map(c => c.close)
  let ledger = createPaperLedger(config.initialCash)
  let pending: { side: 'buy' | 'sell'; signalTime: number; reason: 'sma_crossover' | 'stop_loss' } | null = null
  let peak = config.initialCash, maxDrawdownPct = 0
  const fills: (PaperFill & { timestamp: number; signalTime: number; signalReason: 'sma_crossover' | 'stop_loss' })[] = []
  const skippedOrders: { timestamp: number; signalTime: number; reason: string }[] = []
  const equity: { timestamp: number; value: number }[] = []
  // Prior candles are warm-up data; the benchmark starts with the evaluated window.
  const startIndex = config.longPeriod
  const benchmarkEntry = candles[startIndex].open
  const benchmark = fillPaperOrder(createPaperLedger(config.initialCash), {
    id: 'benchmark', side: 'buy', referencePrice: benchmarkEntry, amount: config.initialCash,
  }, config)
  if (!benchmark.ok) throw new Error(benchmark.reason)
  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i]
    if (pending) {
      // Match the live guard: cap deployed all-in basis by the realized cash
      // budget, not by unrealized mark-to-market gains on an open position.
      const realizedBudget = ledger.initialCash + ledger.realizedPnl
      const allocationHeadroom = Math.max(0, realizedBudget * maxAllocationPct / 100 - ledger.costBasis)
      const amount = pending.side === 'buy'
        ? Math.min(config.orderCash, ledger.cash, allocationHeadroom)
        : ledger.btc
      if (pending.side === 'buy' && amount < 0.01) {
        skippedOrders.push({ timestamp: candle.openTime, signalTime: pending.signalTime, reason: 'Cash or allocation headroom below the 0.01 minimum all-in order' })
      } else {
        const result = fillPaperOrder(ledger, {
          id: `${pending.reason}-${pending.side}-${pending.signalTime}`,
          side: pending.side,
          referencePrice: candle.open,
          amount,
        }, config)
        if (!result.ok) throw new Error(`Backtest order could not be represented: ${result.reason}`)
        ledger = result.ledger
        fills.push({ ...result.fill, timestamp: candle.openTime, signalTime: pending.signalTime, signalReason: pending.reason })
      }
      pending = null
    }
    const value = markPaperLedger(ledger, candle.close).equity
    peak = Math.max(peak, value)
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak - value) / peak * 100)
    equity.push({ timestamp: candle.openTime + config.intervalMs - 1, value })
    // Historical OHLC does not reveal tick order. Never infer an intrabar stop
    // fill from low/high: observe only the closed price, then fill next open.
    const entryBasisPerBtc = ledger.btc > 0 ? ledger.costBasis / ledger.btc : 0
    if (stopLossPct > 0 && entryBasisPerBtc > 0
        && (entryBasisPerBtc - candle.close) / entryBasisPerBtc * 100 >= stopLossPct) {
      pending = { side: 'sell', signalTime: candle.openTime + config.intervalMs - 1, reason: 'stop_loss' }
      continue
    }
    const shortNow = mean(closes, i, config.shortPeriod)
    const longNow = mean(closes, i, config.longPeriod)
    const shortBefore = mean(closes, i - 1, config.shortPeriod)
    const longBefore = mean(closes, i - 1, config.longPeriod)
    if (shortBefore <= longBefore && shortNow > longNow && ledger.btc === 0) {
      pending = { side: 'buy', signalTime: candle.openTime + config.intervalMs - 1, reason: 'sma_crossover' }
    } else if (shortBefore >= longBefore && shortNow < longNow && ledger.btc > 0) {
      pending = { side: 'sell', signalTime: candle.openTime + config.intervalMs - 1, reason: 'sma_crossover' }
    }
  }
  const finalMark = markPaperLedger(ledger, candles[candles.length - 1].close)
  const benchmarkValue = markPaperLedger(benchmark.ledger, candles[candles.length - 1].close).equity
  return {
    schemaVersion: 1,
    kind: 'historical_backtest' as const,
    strategy: 'sma_crossover_v1',
    dataset: { source: dataset.source, symbol: dataset.symbol, quoteCurrency: dataset.quoteCurrency, retrievedAt: dataset.retrievedAt },
    config: normalizedConfig,
    assumptions: {
      execution: 'next_candle_open', cashCurrency: dataset.quoteCurrency,
      fees: 'simulated', slippage: 'simulated', networkGas: 0,
      allocation: 'all_in_cost_basis_capped_by_initial_cash_plus_realized_pnl',
      stopLoss: 'closed_candle_close_vs_fee_inclusive_entry_basis_then_next_open',
      drawdown: 'close_only_marks_not_intrabar',
    },
    startedAt: candles[startIndex].openTime,
    endedAt: candles[candles.length - 1].openTime + config.intervalMs - 1,
    warmupCandles: startIndex,
    evaluatedCandles: candles.length - startIndex,
    ledger, fills, skippedOrders, equityCurve: equity, ...finalMark,
    returnPct: (finalMark.equity / config.initialCash - 1) * 100,
    maxDrawdownPct,
    buyAndHoldReturnPct: (benchmarkValue / config.initialCash - 1) * 100,
    completedTrades: fills.filter(f => f.side === 'sell').length,
    pendingSignalAtEnd: pending,
    disclosure: 'Historical simulation, not live performance or an onchain proof. Source attribution and an input hash do not authenticate supplied prices. Signals and stop losses are observed at candle close and filled at the modeled next open; live fills use an observed current quote after signal evaluation and can differ. Gaps may exceed the stop threshold. Drawdown uses close-only marks and can miss intrabar losses. Open positions are marked to market, not silently liquidated.',
  }
}
