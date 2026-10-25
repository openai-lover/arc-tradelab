import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { generateForwardReport } from '../src/trading/forwardReport.ts'
import { buildStrategySnapshot, buildTrade, DEFAULT_STRATEGY, SIM_FEE_BPS, effectiveBuyPrice } from '../src/trading/engine.ts'

const NOW = 1_800_000_360_000
const market = () => ({ provider: 'Binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT', source: 'ws',
  price: 100_000, lastUpdated: NOW + 4_000, lastMarketTime: NOW + 3_999, isStale: false, exportedAt: NOW + 5_000 })
function emptyState() {
  return { depositedUsdc: 100, realizedGains: 0, spentUsdc: 0, reservedUsdc: 0,
    position: { btcAmount: 0, avgEntryPrice: 0, totalCost: 0 }, realizedPnl: 0, maxDrawdown: 0, peakEquity: 100,
    trades: [], strategyStatus: 'idle', strategyConfig: { ...DEFAULT_STRATEGY },
    meta: { experimentId: 'paper', startedAt: NOW - 300_000, strategySnapshot: null, btcPriceAtStart: 100_000 },
    lastFilledSignalId: null, lastOrderTime: null, lastEvaluatedCandleTime: 0 }
}
function opened(source = 'manual') {
  const s = emptyState()
  const qty = 10 / ((1 + SIM_FEE_BPS / 10_000) * effectiveBuyPrice(100_000))
  const signal = source === 'strategy' ? `sig-buy-${NOW - 60_000}-${NOW - 120_000}` : null
  const t = { ...buildTrade('buy', qty, 100_000, source, signal), id: 'buy-1', timestamp: NOW + 500 }
  s.spentUsdc = 10; s.position = { btcAmount: qty, avgEntryPrice: 10 / qty, totalCost: 10 }; s.trades = [t]
  s.lastOrderTime = NOW + 501; s.lastFilledSignalId = signal
  if (source === 'strategy') {
    s.strategyStatus = 'running'
    s.meta.strategySnapshot = { ...buildStrategySnapshot(s.strategyConfig), startedAt: NOW - 240_000 }
    s.lastEvaluatedCandleTime = NOW - 60_000
  }
  return s
}
function roundTrip() {
  const s = opened()
  const t = { ...buildTrade('sell', s.position.btcAmount, 100_000, 'manual'), id: 'sell-1', timestamp: NOW + 4_000 }
  t.realizedPnl = t.notional - t.fee - 10
  s.realizedGains = t.realizedPnl; s.realizedPnl = t.realizedPnl; s.spentUsdc = 0
  s.position = { btcAmount: 0, avgEntryPrice: 0, totalCost: 0 }; s.trades.unshift(t); s.lastOrderTime = NOW + 4_001
  return s
}

test('forward artifact hashes exact downloaded bytes and separates manual fills from nonexistent chain evidence', async () => {
  const artifact = await generateForwardReport(roundTrip(), market())
  assert.equal(artifact.sha256, createHash('sha256').update(artifact.json, 'utf8').digest('hex'))
  assert.deepEqual(JSON.parse(artifact.json), artifact.report)
  assert.equal(artifact.report.summary.manualTradeCount, 2)
  assert.equal(artifact.report.summary.strategyTradeCount, 0)
  assert.equal(artifact.report.timeline[0].id, 'buy-1')
  assert.equal(artifact.report.timeline[1].id, 'sell-1')
  assert.equal(artifact.report.onchainEvidence.status, 'not_submitted')
  assert.equal(artifact.report.onchainEvidence.transactionCount, 0)
  assert.equal(artifact.report.timeline[0].exchangeTimestampForThisFill, null)
  assert.match(artifact.report.disclosures.join(' '), /not.*autonomous bot-only/)
  assert.ok(artifact.report.summary.realizedPnl < 0)
})

test('snapshot is copied before async hashing and deeply frozen after the caller changes live state', async () => {
  const state = opened('strategy'), metadata = market()
  const pending = generateForwardReport(state, metadata)
  state.strategyConfig.orderSizeUsdc = 99; state.trades[0].execPrice = 1; metadata.price = 1
  const { report } = await pending
  assert.equal(report.experiment.strategyConfig.orderSizeUsdc, 10)
  assert.ok(report.timeline[0].execPrice > 100_000)
  assert.equal(report.marketAtExport.price, 100_000)
  assert.equal(report.summary.strategyTradeCount, 1)
  assert.throws(() => { report.timeline[0].fee = 0 }, TypeError)
})

test('inconsistent cash, fee, quantities, versions, ordering and duplicate signals fail closed', async () => {
  for (const modify of [
    s => { s.realizedPnl = 10 },
    s => { s.position.btcAmount *= 2 },
    s => { s.trades[0].fee = 0 },
    s => { s.strategyConfig.shortPeriod = 20 },
    s => { s.meta.strategySnapshot.version = '0.0.1' },
    s => { s.trades[0].signalId = `sig-buy-${NOW}-${NOW - 60_000}` },
    s => { s.trades.push({ ...s.trades[0], id: 'another-id' }) },
  ]) {
    const state = opened('strategy'); modify(state)
    await assert.rejects(generateForwardReport(state, market()), /Cannot export forward report/)
  }
  const reversed = roundTrip(); reversed.trades.reverse()
  await assert.rejects(generateForwardReport(reversed, market()), /newest first/)
})

test('unknown fields, getters, forged chain confirmations, wallets and market mismatches are never exported', async () => {
  let getterCalls = 0
  const accessors = emptyState()
  Object.defineProperty(accessors, 'realizedGains', { enumerable: true, get() { getterCalls++; return 0 } })
  await assert.rejects(generateForwardReport(accessors, market()), /JSON data only/)
  assert.equal(getterCalls, 0)
  const arrayAccessors = opened()
  Object.defineProperty(arrayAccessors.trades, '0', { enumerable: true, get() { getterCalls++; return {} } })
  await assert.rejects(generateForwardReport(arrayAccessors, market()), /dense JSON data array/)
  assert.equal(getterCalls, 0)
  const extra = emptyState(); extra.privateKey = 'DO NOT EXPORT'
  await assert.rejects(generateForwardReport(extra, market()), /unsupported fields/)
  const forged = opened(); forged.trades[0].txHash = '0xfake'; forged.trades[0].arcTxStatus = 'confirmed'
  await assert.rejects(generateForwardReport(forged, market()), /onchain claim/)
  const wallet = emptyState(); wallet.meta.experimentId = '0x0000000000000000000000000000000000000001'
  await assert.rejects(generateForwardReport(wallet, market()), /wallet-free/)
  await assert.rejects(generateForwardReport(emptyState(), { ...market(), quoteCurrency: 'USD' }), /market metadata/)
})

test('missing or stale quotes remain explicit and never invent a current position mark', async () => {
  const missing = { ...market(), source: null, price: null, lastUpdated: null, lastMarketTime: null, isStale: true }
  const { report } = await generateForwardReport(opened(), missing)
  assert.equal(report.summary.equityAtLastObservedPrice, null)
  assert.equal(report.summary.returnPctAtLastObservedPrice, null)
  assert.equal(report.marketAtExport.isStale, true)
  const stale = await generateForwardReport(opened(), { ...market(), lastUpdated: NOW - 20_000, lastMarketTime: NOW - 20_001 })
  assert.equal(stale.report.marketAtExport.isStale, true)
})

test('the 200-trade window is disclosed as potentially incomplete rather than a verified entire experiment', async () => {
  const state = emptyState()
  const qty = 10 / ((1 + SIM_FEE_BPS / 10_000) * effectiveBuyPrice(100_000))
  for (let i = 0; i < 100; i++) {
    const buy = { ...buildTrade('buy', qty, 100_000, 'manual'), id: `buy-${i}`, timestamp: NOW - 200_000 + i * 2_000 }
    const sell = { ...buildTrade('sell', qty, 100_000, 'manual'), id: `sell-${i}`, timestamp: buy.timestamp + 1_000 }
    sell.realizedPnl = sell.notional - sell.fee - 10
    state.trades.unshift(sell, buy)
    state.realizedPnl += sell.realizedPnl
  }
  state.realizedGains = state.realizedPnl
  state.lastOrderTime = NOW + 1
  const { report } = await generateForwardReport(state, market())
  assert.equal(report.history.coverage, 'possibly_truncated')
  assert.equal(report.history.reconciliation, 'retained_window_replayed_from_unverified_opening_balance')
  assert.equal(report.summary.retainedTradeCount, 200)
  assert.match(report.disclosures.join(' '), /Earlier fills may be missing/)
  state.position = { btcAmount: 0.00001, avgEntryPrice: 100_000, totalCost: 1 }; state.spentUsdc = 1
  await assert.rejects(generateForwardReport(state, market()), /retained sell/)
})
