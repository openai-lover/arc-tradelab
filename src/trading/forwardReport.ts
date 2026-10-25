import { SIM_FEE_BPS, SIM_SLIPPAGE_BPS, STRATEGY_VERSION, buildStrategySnapshot } from './engine.ts'
import type { StrategyConfig, StrategySnapshot, Trade } from './engine.ts'
import type { TradingState } from '../hooks/useTradingState.ts'

export interface ForwardMarketMetadata {
  provider: 'Binance'
  symbol: 'BTCUSDT'
  quoteCurrency: 'USDT'
  source: 'ws' | 'rest' | null
  price: number | null
  lastUpdated: number | null
  lastMarketTime: number | null
  isStale: boolean
  /** Defaults to Date.now(); the browser clock is not independently authenticated. */
  exportedAt?: number
}

const CONFIG_KEYS = ['shortPeriod', 'longPeriod', 'candleIntervalMs', 'orderSizeUsdc', 'maxAllocationPct', 'stopLossPct'] as const
const TRADE_KEYS = ['id', 'signalId', 'side', 'btcAmount', 'execPrice', 'notional', 'fee', 'slippage', 'simGasUsdc', 'realizedPnl', 'timestamp', 'source', 'txHash', 'arcTxStatus'] as const
const SNAPSHOT_KEYS = ['version', ...CONFIG_KEYS, 'rule', 'simFeeBps', 'simSlippageBps', 'simGasUsdc', 'startedAt'] as const
const STATE_KEYS = ['depositedUsdc', 'realizedGains', 'spentUsdc', 'reservedUsdc', 'position', 'realizedPnl', 'maxDrawdown', 'peakEquity', 'trades', 'strategyStatus', 'strategyConfig', 'meta', 'lastFilledSignalId', 'lastOrderTime', 'lastEvaluatedCandleTime'] as const
const MARKET_KEYS = ['provider', 'symbol', 'quoteCurrency', 'source', 'price', 'lastUpdated', 'lastMarketTime', 'isStale', 'exportedAt'] as const
const MAX_TRADES = 200
function fail(message: string): never { throw new Error(`Cannot export forward report: ${message}`) }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0
const positive = (v: unknown): v is number => finite(v) && v > 0
const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b))
const sameQuantity = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-12 * Math.max(1e-8, Math.abs(a), Math.abs(b))
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0
  && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v)

/** Check descriptors before reading values: no getters, functions, prototype data or secrets. */
function exactRecord(value: unknown, keys: readonly string[], label: string, optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain record`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const actual = Reflect.ownKeys(value)
  if (actual.some(k => typeof k !== 'string' || !keys.includes(k))
      || keys.some(k => !optional.includes(k) && !Object.prototype.hasOwnProperty.call(descriptors, k))) fail(`${label} has missing or unsupported fields`)
  for (const key of actual) {
    const d = descriptors[key as string]
    if (!d || !('value' in d) || !d.enumerable) fail(`${label} must contain JSON data only`)
  }
  return value as Record<string, unknown>
}

function configCopy(value: unknown): StrategyConfig {
  const c = exactRecord(value, CONFIG_KEYS, 'strategy config')
  if (!Number.isInteger(c.shortPeriod) || !Number.isInteger(c.longPeriod)
      || !positive(c.shortPeriod) || !positive(c.longPeriod) || c.shortPeriod >= c.longPeriod || c.longPeriod > 500
      || c.candleIntervalMs !== 60_000 || !finite(c.orderSizeUsdc) || c.orderSizeUsdc < 0.01 || c.orderSizeUsdc > 1_000_000
      || !finite(c.maxAllocationPct) || c.maxAllocationPct < 0.01 || c.maxAllocationPct > 100
      || !nonnegative(c.stopLossPct) || c.stopLossPct > 100) fail('invalid supported strategy config')
  return { shortPeriod: c.shortPeriod, longPeriod: c.longPeriod, candleIntervalMs: 60_000,
    orderSizeUsdc: c.orderSizeUsdc, maxAllocationPct: c.maxAllocationPct, stopLossPct: c.stopLossPct }
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

function buildForwardReport(input: TradingState, metadata: ForwardMarketMetadata) {
  const market = exactRecord(metadata, MARKET_KEYS, 'market metadata', ['exportedAt'])
  const exportedAt = market.exportedAt === undefined ? Date.now() : market.exportedAt
  const timestamp = (v: unknown): v is number => Number.isSafeInteger(v) && nonnegative(v) && v <= (exportedAt as number) + 2_000
  if (!timestamp(exportedAt) || exportedAt <= 0) fail('invalid export timestamp')
  if (market.provider !== 'Binance' || market.symbol !== 'BTCUSDT' || market.quoteCurrency !== 'USDT'
      || !['ws', 'rest', null].includes(market.source as string | null) || typeof market.isStale !== 'boolean') fail('unsupported market metadata')
  if (market.source === null) {
    if (market.price !== null || market.lastUpdated !== null || market.lastMarketTime !== null || !market.isStale) fail('missing feed must be marked unavailable and stale')
  } else if (!positive(market.price) || !timestamp(market.lastUpdated)
      || (market.source === 'ws' ? !timestamp(market.lastMarketTime) : market.lastMarketTime !== null)) fail('invalid observed quote metadata')
  const quotePrice = market.price
  const state = exactRecord(input, STATE_KEYS, 'trading state')
  const meta = exactRecord(state.meta, ['experimentId', 'startedAt', 'strategySnapshot', 'btcPriceAtStart'], 'experiment metadata')
  const position = exactRecord(state.position, ['btcAmount', 'avgEntryPrice', 'totalCost'], 'position')
  const config = configCopy(state.strategyConfig)
  if (meta.experimentId !== 'paper') fail('only the wallet-free paper experiment is supported; no testnet deposit proof exists')
  if (!timestamp(meta.startedAt) || !(meta.btcPriceAtStart === null || positive(meta.btcPriceAtStart))) fail('invalid experiment metadata')
  const experimentStartedAt = meta.startedAt
  if (state.depositedUsdc !== 100 || state.reservedUsdc !== 0
      || !finite(state.realizedGains) || !finite(state.realizedPnl) || !near(state.realizedGains, state.realizedPnl)
      || !nonnegative(state.spentUsdc) || !nonnegative(state.maxDrawdown) || state.maxDrawdown > 100
      || !nonnegative(state.peakEquity) || ![position.btcAmount, position.avgEntryPrice, position.totalCost].every(nonnegative)
      || !near(state.spentUsdc, position.totalCost as number)) fail('invalid paper portfolio accounting')
  const btc = position.btcAmount as number
  const costBasis = position.totalCost as number
  if (btc === 0 ? costBasis !== 0 || position.avgEntryPrice !== 0
    : !positive(position.avgEntryPrice) || costBasis <= 0 || !near(btc * position.avgEntryPrice, costBasis)) fail('inconsistent fee-inclusive position basis')
  const freeCash = state.depositedUsdc + state.realizedGains - state.spentUsdc
  if (!finite(freeCash) || freeCash < -1e-7 || !['idle', 'running', 'paused'].includes(state.strategyStatus as string)
      || !(state.lastFilledSignalId === null || text(state.lastFilledSignalId, 160))
      || !(state.lastOrderTime === null || timestamp(state.lastOrderTime)) || !timestamp(state.lastEvaluatedCandleTime)) fail('invalid execution state')
  let snapshot: StrategySnapshot | null = null
  if (meta.strategySnapshot !== null) {
    const s = exactRecord(meta.strategySnapshot, SNAPSHOT_KEYS, 'strategy start snapshot')
    const snapshotConfig: StrategyConfig = configCopy(Object.fromEntries(CONFIG_KEYS.map(k => [k, s[k]])))
    if (CONFIG_KEYS.some(k => snapshotConfig[k] !== config[k]) || s.version !== STRATEGY_VERSION
        || s.rule !== buildStrategySnapshot(config).rule || s.simFeeBps !== SIM_FEE_BPS
        || s.simSlippageBps !== SIM_SLIPPAGE_BPS || s.simGasUsdc !== 0
        || !timestamp(s.startedAt) || s.startedAt < meta.startedAt) fail('snapshot/config or simulation version mismatch')
    snapshot = { version: STRATEGY_VERSION, ...snapshotConfig, rule: s.rule,
      simFeeBps: SIM_FEE_BPS, simSlippageBps: SIM_SLIPPAGE_BPS, simGasUsdc: 0, startedAt: s.startedAt }
  }
  if (state.strategyStatus !== 'idle' && snapshot === null) fail('running or paused strategy requires a start snapshot')
  if (!Array.isArray(state.trades) || Object.getPrototypeOf(state.trades) !== Array.prototype || state.trades.length > MAX_TRADES) fail('invalid retained trade history')
  const tradeDescriptors = Object.getOwnPropertyDescriptors(state.trades)
  if (Reflect.ownKeys(state.trades).length !== state.trades.length + 1) fail('trade history must be a dense JSON data array')
  for (let i = 0; i < state.trades.length; i++) {
    if (!tradeDescriptors[String(i)] || !('value' in tradeDescriptors[String(i)])) fail('trade history must be a dense JSON data array')
  }
  const seenIds = new Set<string>(), seenSignals = new Set<string>()
  const trades: Trade[] = state.trades.map((value: unknown) => {
    const t = exactRecord(value, TRADE_KEYS, 'trade')
    if (!text(t.id, 160) || seenIds.has(t.id) || !['buy', 'sell'].includes(t.side as string)
        || !['manual', 'strategy'].includes(t.source as string)
        || ![t.btcAmount, t.execPrice, t.notional].every(positive) || ![t.fee, t.slippage].every(nonnegative)
        || !near((t.btcAmount as number) * (t.execPrice as number), t.notional as number)
        || !near(t.fee as number, (t.notional as number) * SIM_FEE_BPS / 10_000)
        || !near(t.slippage as number, (t.notional as number) * SIM_SLIPPAGE_BPS / 10_000)
        || t.simGasUsdc !== 0 || t.txHash !== null || t.arcTxStatus !== 'not_submitted'
        || !timestamp(t.timestamp) || t.timestamp < experimentStartedAt
        || (t.side === 'buy' ? t.realizedPnl !== null : !finite(t.realizedPnl))) fail('invalid trade, fee accounting, or unsupported onchain claim')
    seenIds.add(t.id)
    if (t.source === 'manual') {
      if (t.signalId !== null) fail('manual trade cannot claim an automated signal')
    } else {
      if (!snapshot || !text(t.signalId, 160) || seenSignals.has(t.signalId) || t.timestamp < snapshot.startedAt) fail('missing or duplicate automated signal snapshot')
      const crossover = /^sig-(buy|sell)-(\d+)-(\d+)$/.exec(t.signalId)
      const stop = /^stop-(\d+)$/.exec(t.signalId)
      const candleOpen = Number(crossover?.[2] ?? stop?.[1])
      if ((!crossover && !stop) || (crossover && (crossover[1] !== t.side || Number(crossover[3]) !== candleOpen - 60_000))
          || (stop && (t.side !== 'sell' || config.stopLossPct === 0)) || !Number.isSafeInteger(candleOpen) || candleOpen < 0 || candleOpen % 60_000 !== 0
          || candleOpen + 59_999 > t.timestamp || t.timestamp - candleOpen - 59_999 > 32_000) fail('invalid automated closed-candle signal timing')
      seenSignals.add(t.signalId)
    }
    return Object.fromEntries(TRADE_KEYS.map(k => [k, t[k]])) as unknown as Trade
  })
  if (trades.some((t, i) => i > 0 && t.timestamp > trades[i - 1].timestamp)) fail('trade history must be newest first')
  if (trades.length > 0 && (!timestamp(state.lastOrderTime) || state.lastOrderTime < trades[0].timestamp)) fail('last order timestamp precedes a retained fill')
  const chronological = [...trades].reverse()
  const possiblyTruncated = trades.length === MAX_TRADES
  const latestAutomated = trades.find(t => t.source === 'strategy')
  if (latestAutomated ? state.lastFilledSignalId !== latestAutomated.signalId
    : !possiblyTruncated && state.lastFilledSignalId !== null) fail('last filled automated signal does not match retained history')
  {
    let cash = 100, amount = 0, basis = 0, realized = 0
    if (possiblyTruncated) {
      // Work backwards from the final portfolio to the retained window's opening
      // balance. This can check the window without pretending older fills exist.
      cash = freeCash; amount = btc; basis = costBasis; realized = state.realizedPnl
      for (const t of chronological) {
        const delta = t.side === 'buy' ? -(t.notional + t.fee) : t.notional - t.fee
        cash -= delta
        amount -= (t.side === 'buy' ? 1 : -1) * t.btcAmount
        basis -= t.side === 'buy' ? t.notional + t.fee : -(delta - (t.realizedPnl as number))
        if (t.side === 'sell') realized -= t.realizedPnl as number
      }
      if (near(cash, 0)) cash = 0
      if (sameQuantity(amount, 0)) amount = 0
      if (near(basis, 0)) basis = 0
      if (![cash, amount, basis, realized].every(finite) || cash < 0 || amount < 0 || basis < 0
          || (amount === 0 ? basis !== 0 : basis <= 0)
          || !near(cash + basis, 100 + realized)) fail('retained window cannot reconcile a plausible opening portfolio')
    }
    for (const t of chronological) {
      if (t.side === 'buy') {
        const debit = t.notional + t.fee
        const cap = (100 + realized) * config.maxAllocationPct / 100 - basis
        if (debit > Math.min(cash, config.orderSizeUsdc, cap) + 1e-7 || (t.source === 'strategy' && amount > 0)) fail('retained buy exceeds its cash/order/allocation limit')
        cash -= debit; amount += t.btcAmount; basis += debit
      } else {
        const proceeds = t.notional - t.fee
        if (!sameQuantity(t.btcAmount, amount) || amount <= 0 || !near(t.realizedPnl as number, proceeds - basis)) fail('retained sell cannot reconcile its full position or realized P&L')
        cash += proceeds; realized += proceeds - basis; amount = 0; basis = 0
      }
    }
    if (!near(cash, freeCash) || !sameQuantity(amount, btc) || !near(basis, costBasis) || !near(realized, state.realizedPnl)) fail('current portfolio does not reconcile with retained fills')
  }
  const equity = quotePrice === null ? (btc === 0 ? freeCash : null) : freeCash + btc * quotePrice
  if (equity !== null && !nonnegative(equity)) fail('unrepresentable portfolio mark')
  const manualCount = trades.filter(t => t.source === 'manual').length
  return freezeDeep({
    schema: 'arc-tradelab.forward-report' as const,
    schemaVersion: 1 as const,
    kind: 'browser_forward_paper_experiment' as const,
    exportedAt,
    engineVersion: STRATEGY_VERSION,
    experiment: { localStorageScope: 'paper' as const, browserRecordedStartedAt: meta.startedAt,
      strategyStatus: state.strategyStatus as 'idle' | 'running' | 'paused', strategyConfig: config, strategyStartSnapshot: snapshot },
    assumptions: { simulationCash: 'sim USDC; no monetary value', marketQuoteCurrency: 'USDT',
      quoteConversion: 'USDT_USDC_1_to_1_simulation', simFeeBps: SIM_FEE_BPS, simSlippageBps: SIM_SLIPPAGE_BPS,
      simGasUsdc: 0, signalEvaluation: 'closed_one_minute_candles', fillTiming: 'fresh_observed_quote_after_signal',
      timestampBasis: 'browser_local_clock; per-fill exchange timestamps were not retained' },
    marketAtExport: { provider: 'Binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT', source: market.source as 'ws' | 'rest' | null,
      price: quotePrice, lastUpdated: market.lastUpdated, lastMarketTime: market.lastMarketTime as number | null,
      isStale: market.isStale || (typeof market.lastUpdated === 'number' && exportedAt - market.lastUpdated >= 10_000)
        || (typeof market.lastMarketTime === 'number' && exportedAt - market.lastMarketTime >= 10_000) },
    summary: { initialSimulationCash: 100, freeSimulationCash: freeCash, virtualBtc: btc, feeInclusiveCostBasis: costBasis,
      realizedPnl: state.realizedPnl, unrealizedPnlAtLastObservedPrice: equity === null ? null : equity - freeCash - costBasis,
      equityAtLastObservedPrice: equity, returnPctAtLastObservedPrice: equity === null ? null : (equity - 100) / 100 * 100,
      browserRecordedMaxDrawdownPct: state.maxDrawdown, browserRecordedPeakEquity: state.peakEquity,
      retainedTradeCount: trades.length, manualTradeCount: manualCount, strategyTradeCount: trades.length - manualCount,
      retainedSellCount: trades.filter(t => t.side === 'sell').length },
    history: { retentionLimit: MAX_TRADES, coverage: possiblyTruncated ? 'possibly_truncated' as const : 'retained_history_reconciled' as const,
      reconciliation: possiblyTruncated ? 'retained_window_replayed_from_unverified_opening_balance' as const : 'cash_position_and_realized_pnl_replayed' as const },
    timeline: chronological.map((trade, i) => ({ retainedSequence: i + 1, ...trade,
      inferredReferencePriceUnderSlippageModel: trade.execPrice / (1 + (trade.side === 'buy' ? 1 : -1) * SIM_SLIPPAGE_BPS / 10_000),
      exchangeTimestampForThisFill: null, cashDelta: trade.side === 'buy' ? -(trade.notional + trade.fee) : trade.notional - trade.fee })),
    onchainEvidence: { status: 'not_submitted' as const, chainId: null, contractAddress: null, transactionCount: 0, transactionHashes: [] },
    disclosures: [
      'This is an export of local browser records, not an independently authenticated trading, price-oracle, or blockchain proof.',
      'All BTC positions, fills, cash, fees and profit/loss are simulated. No real BTC order or USDC transfer is represented.',
      'Market provider labels and local timestamps do not authenticate price accuracy. Per-fill raw market observations and full equity history were not retained.',
      manualCount > 0 ? 'Manual trades are included. These aggregate results must not be presented as autonomous bot-only performance.' : 'No manual trades appear in the retained history; this does not prove uninterrupted autonomous execution.',
      possiblyTruncated ? 'The 200-record retention limit was reached. Earlier fills may be missing; total trade counts and complete-ledger reconciliation are unavailable.' : 'Retained fills reconcile numerically with this portfolio; consistency does not authenticate their origin or completeness.',
      'Drawdown and peak equity are browser-recorded metrics and cannot be independently replayed from the retained fills alone.',
      'A report hash commits to exact downloaded bytes only. It does not prove authorship, uninterrupted operation, real execution, future returns, or an onchain registration.',
    ],
  })
}

export type ForwardReport = ReturnType<typeof buildForwardReport>

/** Capture/copy synchronously before hashing; the returned hash covers exact UTF-8 file bytes. */
export async function generateForwardReport(state: TradingState, marketMetadata: ForwardMarketMetadata) {
  const report = buildForwardReport(state, marketMetadata)
  const json = JSON.stringify(report, null, 2)
  if (!globalThis.crypto?.subtle) fail('Web Crypto SHA-256 is unavailable')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  return Object.freeze({ report, json, sha256 })
}
