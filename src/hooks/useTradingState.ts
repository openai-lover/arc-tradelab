/**
 * Central trading state for Arc TradeLab.
 *
 * MODES:
 *   Paper mode (walletAddress = undefined):
 *     - No wallet required. Virtual budget funded with VIRTUAL_PAPER_USDC (100 USDC).
 *     - State is keyed as 'paper' in localStorage.
 *     - No onchain deposit or withdrawal — budget is simulated only.
 *     - Label: "Sim Cash" (virtual, no monetary value).
 *
 *   Wallet mode (walletAddress = "0x..."):
 *     - State keyed by wallet address.
 *     - Lab balance comes from confirmed Arc Testnet USDC deposits.
 *     - Label: "Testnet USDC" (real token, no monetary value on testnet).
 *     - Switching wallets loads that wallet's isolated experiment.
 *
 * BALANCE MODEL:
 *   tradingBudget = depositedUsdc + realizedGains
 *   freeUsdc = tradingBudget - spentUsdc - reservedUsdc
 *
 *   depositedUsdc: in paper mode = VIRTUAL_PAPER_USDC; in wallet mode = confirmed deposits.
 *   realizedGains: cumulative net P&L from closed positions (can be negative).
 *   spentUsdc:     USDC locked in current open position (notional + fees).
 *   reservedUsdc:  reserved for future pending orders (currently 0).
 *
 * STRATEGY:
 *   Uses CLOSED 1-minute candles only. Fires at most once per closed candle.
 *   Signal IDs prevent duplicate fills. Warm-up = longPeriod + 1 closed candles.
 *   Start/Pause preserves positions. Stop clears the strategy state but not trades.
 *   Tab must be open — no background worker; this is stated explicitly in the UI.
 *
 * ONCHAIN STATUS:
 *   Paper fills have arcTxStatus = 'not_submitted'. Only real Arc tx receipts
 *   produce txHash and arcTxStatus = 'confirmed'. There are no fabricated hashes.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Trade, Position, StrategyConfig, StrategySnapshot,
  DEFAULT_STRATEGY, buildTrade, calcUnrealizedPnl,
  calcBuyAndHoldReturn, buildStrategySnapshot,
  detectMaCrossover, aggregateCandles, sma,
  effectiveBuyPrice, SIM_FEE_BPS,
} from '../trading/engine'
import type { PricePoint } from './useBtcPrice'
import type { Candle } from '../trading/engine'
import { canApplyLiveConfig, canEvaluateLiveCandles, closedCandleStopTriggered, isRestorableLiveState, isSameLiveConfig, isValidLiveConfig, startCandleBoundary } from '../trading/liveGuards'

export type StrategyStatus = 'idle' | 'running' | 'paused'

export interface ExperimentMeta {
  /** 'paper' | wallet address */
  experimentId: string
  /** When the first deposit/virtual-budget was set */
  startedAt: number
  /** Snapshot of strategy config at last Start */
  strategySnapshot: StrategySnapshot | null
  /** BTC price at experiment start (for buy-and-hold comparison) */
  btcPriceAtStart: number | null
}

export interface TradingState {
  // Budget
  depositedUsdc: number       // paper mode: VIRTUAL_PAPER_USDC; wallet mode: confirmed deposits
  realizedGains: number       // cumulative closed P&L
  spentUsdc: number           // USDC locked in open position
  reservedUsdc: number        // reserved for pending orders
  // Position
  position: Position
  // Metrics
  realizedPnl: number
  maxDrawdown: number
  peakEquity: number
  // Trades
  trades: Trade[]
  // Strategy
  strategyStatus: StrategyStatus
  strategyConfig: StrategyConfig
  // Experiment metadata
  meta: ExperimentMeta
  // Duplicate-order guard: last signal ID that produced a fill
  lastFilledSignalId: string | null
  lastOrderTime: number | null
  lastEvaluatedCandleTime: number
}

const VIRTUAL_PAPER_USDC = 100    // default simulation budget
const ORDER_COOLDOWN_MS = 3000    // minimum ms between any two orders
const STORAGE_VERSION = 5 // old keys remain untouched; prior stop/signal semantics never mix into new reports

function storageKey(key: string) {
  return `tradelab_v${STORAGE_VERSION}_${key.toLowerCase()}`
}

function makeMeta(experimentId: string, btcPrice: number | null): ExperimentMeta {
  return {
    experimentId,
    startedAt: Date.now(),
    strategySnapshot: null,
    btcPriceAtStart: btcPrice,
  }
}

function makeInitialState(experimentId: string, btcPrice: number | null): TradingState {
  const isPaper = !experimentId.startsWith('0x')
  return {
    depositedUsdc: isPaper ? VIRTUAL_PAPER_USDC : 0,
    realizedGains: 0,
    spentUsdc: 0,
    reservedUsdc: 0,
    position: { btcAmount: 0, avgEntryPrice: 0, totalCost: 0 },
    realizedPnl: 0,
    maxDrawdown: 0,
    peakEquity: isPaper ? VIRTUAL_PAPER_USDC : 0,
    trades: [],
    strategyStatus: 'idle',
    strategyConfig: DEFAULT_STRATEGY,
    meta: makeMeta(experimentId, btcPrice),
    lastFilledSignalId: null,
    lastOrderTime: null,
    lastEvaluatedCandleTime: 0,
  }
}

function loadState(experimentId: string): TradingState {
  try {
    const raw = localStorage.getItem(storageKey(experimentId))
    if (!raw) return makeInitialState(experimentId, null)
    const parsed = JSON.parse(raw) as TradingState
    if (!isRestorableLiveState(parsed, experimentId, Date.now())) return makeInitialState(experimentId, null)
    return {
      ...parsed,
      // Safety: never resume a 'running' strategy after reload
      strategyStatus: parsed.strategyStatus === 'running' ? 'paused' : (parsed.strategyStatus ?? 'idle'),
    }
  } catch {
    return makeInitialState(experimentId, null)
  }
}

function saveState(experimentId: string, state: TradingState) {
  try {
    localStorage.setItem(storageKey(experimentId), JSON.stringify(state))
  } catch { /* storage full — silently skip */ }
}

function getExperimentId(walletAddress: string | undefined): string {
  return walletAddress ? walletAddress.toLowerCase() : 'paper'
}

/** Available USDC for trading (freeUsdc) */
function available(s: TradingState): number {
  return s.depositedUsdc + s.realizedGains - s.spentUsdc - s.reservedUsdc
}

// ------------------------------------------------------------------
// Export helpers
// ------------------------------------------------------------------

export function exportTradesToCsv(trades: Trade[], experimentId: string): void {
  const header = ['id', 'side', 'btcAmount', 'execPrice', 'notional', 'fee', 'slippage',
    'simGasUsdc', 'realizedPnl', 'timestamp', 'source', 'signalId', 'arcTxStatus', 'txHash'].join(',')
  const rows = trades.map(t => [
    t.id, t.side,
    t.btcAmount.toFixed(8), t.execPrice.toFixed(2), t.notional.toFixed(4),
    t.fee.toFixed(4), t.slippage.toFixed(4), t.simGasUsdc.toFixed(4),
    t.realizedPnl?.toFixed(4) ?? '',
    new Date(t.timestamp).toISOString(),
    t.source, t.signalId ?? '', t.arcTxStatus ?? '', t.txHash ?? '',
  ].join(','))
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tradelab-${experimentId.slice(0, 8)}-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ------------------------------------------------------------------
// Main hook
// ------------------------------------------------------------------

export function useTradingState(
  currentPrice: number | null,
  priceHistory: PricePoint[],  // raw ticks from useBtcPrice
  walletAddress: string | undefined,
  market?: { closedCandles: Candle[]; isStale: boolean },
) {
  const experimentId = getExperimentId(walletAddress)
  const [state, setState] = useState<TradingState>(() => loadState(experimentId))
  const stateRef = useRef(state)

  // Commit a complete transition synchronously. A second event before React renders
  // must see the updated position, cash, cooldown and strategy status together.
  const updateState = useCallback((update: (previous: TradingState) => TradingState) => {
    const next = update(stateRef.current)
    stateRef.current = next
    setState(next)
  }, [])

  // Persist whenever state changes
  useEffect(() => {
    // A wallet change renders once with the old experiment before its load effect.
    // Never save that state under the new wallet's key.
    if (state.meta.experimentId === experimentId) saveState(experimentId, state)
  }, [state, experimentId])

  // Switch experiment when wallet changes (or wallet connects/disconnects)
  const prevExperimentIdRef = useRef(experimentId)
  useEffect(() => {
    if (prevExperimentIdRef.current !== experimentId) {
      prevExperimentIdRef.current = experimentId
      updateState(() => loadState(experimentId))
    }
  }, [experimentId, updateState])

  // Set btcPriceAtStart when we first get a price for this experiment
  useEffect(() => {
    if (!currentPrice || !Number.isFinite(currentPrice) || currentPrice <= 0) return
    const s = stateRef.current
    if (s.meta.experimentId === experimentId && s.meta.btcPriceAtStart === null) {
      updateState(prev => ({
        ...prev,
        meta: { ...prev.meta, btcPriceAtStart: currentPrice },
      }))
    }
  }, [currentPrice, experimentId, updateState])

  // ------------------------------------------------------------------
  // Derived metrics
  // ------------------------------------------------------------------
  const freeUsdc = available(state)
  const unrealizedPnl = currentPrice ? calcUnrealizedPnl(state.position, currentPrice) : 0
  const tradingBudget = state.depositedUsdc + state.realizedGains
  const portfolioValue = currentPrice
    ? (tradingBudget - state.spentUsdc) + state.position.btcAmount * currentPrice
    : tradingBudget

  // MA values on raw ticks (for chart overlay only — NOT for trade signals)
  const tickPrices = priceHistory.map(p => p.price)
  const shortMA = tickPrices.length >= state.strategyConfig.shortPeriod
    ? sma(tickPrices, state.strategyConfig.shortPeriod)
    : null
  const longMA = tickPrices.length >= state.strategyConfig.longPeriod
    ? sma(tickPrices, state.strategyConfig.longPeriod)
    : null

  // Closed candles (for strategy signals)
  const closedCandles = market?.closedCandles ?? aggregateCandles(priceHistory, state.strategyConfig.candleIntervalMs)

  // Buy-and-hold comparison (requires at least one trade or a start price)
  const buyAndHoldReturn = calcBuyAndHoldReturn(
    state.meta.btcPriceAtStart,
    currentPrice,
  )

  // Is this a paper (wallet-free) experiment?
  const isPaperMode = experimentId === 'paper'

  // ------------------------------------------------------------------
  // Execute a trade (paper fill)
  // ------------------------------------------------------------------
  const executeTrade = useCallback(
    (
      side: 'buy' | 'sell',
      source: 'manual' | 'strategy',
      signalId: string | null = null,
    ): Trade | null => {
      const s = stateRef.current
      if (s.meta.experimentId !== experimentId || !isValidLiveConfig(s.strategyConfig)) return null
      if (!currentPrice || !Number.isFinite(currentPrice) || currentPrice <= 0 || market?.isStale) return null
      if (source === 'strategy' && s.strategyStatus !== 'running') return null

      // Duplicate signal guard — never fill the same signal twice
      if (signalId && s.lastFilledSignalId === signalId) return null

      // Order cooldown (prevents rapid-fire manual clicks)
      if (s.lastOrderTime && Date.now() - s.lastOrderTime < ORDER_COOLDOWN_MS) return null

      const cfg = s.strategyConfig
      const usdcAvail = available(s)

      if (side === 'buy') {
        if (usdcAvail < 0.01) return null

        const budget = s.depositedUsdc + s.realizedGains
        const maxUsdc = budget * (cfg.maxAllocationPct / 100)
        const alreadyAllocated = s.spentUsdc
        if (alreadyAllocated >= maxUsdc) return null

        const orderUsdc = Math.min(cfg.orderSizeUsdc, usdcAvail, maxUsdc - alreadyAllocated)
        if (orderUsdc < 0.01) return null

        // The selected cash amount is an ALL-IN debit, including adverse slippage and fee.
        const btcAmount = orderUsdc / ((1 + SIM_FEE_BPS / 10_000) * effectiveBuyPrice(currentPrice))
        if (!Number.isFinite(btcAmount) || btcAmount <= 0) return null
        const trade = buildTrade('buy', btcAmount, currentPrice, source, signalId)
        if (![trade.execPrice, trade.notional, trade.fee, trade.slippage].every(Number.isFinite)) return null
        trade.simGasUsdc = 0 // no chain transaction occurred
        const totalCost = orderUsdc
        updateState(prev => {
          const pos = prev.position
          const totalBtc = pos.btcAmount + btcAmount
          const newTotalCost = pos.totalCost + totalCost
          const avgEntry = totalBtc > 0 ? newTotalCost / totalBtc : currentPrice
          return {
            ...prev,
            spentUsdc: prev.spentUsdc + totalCost,
            position: { btcAmount: totalBtc, avgEntryPrice: avgEntry, totalCost: newTotalCost },
            trades: [trade, ...prev.trades].slice(0, 200),
            lastFilledSignalId: signalId ?? prev.lastFilledSignalId,
            lastOrderTime: Date.now(),
          }
        })
        return trade
      }

      if (side === 'sell') {
        const pos = s.position
        if (pos.btcAmount <= 0) return null

        const trade = buildTrade('sell', pos.btcAmount, currentPrice, source, signalId)
        if (![trade.execPrice, trade.notional, trade.fee, trade.slippage].every(Number.isFinite)) return null
        trade.simGasUsdc = 0
        // P&L = sell proceeds - cost basis - fees (all simulated)
        const tradePnl = trade.notional - pos.totalCost - trade.fee - trade.simGasUsdc
        const tradeWithPnl: Trade = { ...trade, realizedPnl: tradePnl }
        updateState(prev => ({
          ...prev,
          spentUsdc: 0,
          realizedGains: prev.realizedGains + tradePnl,
          position: { btcAmount: 0, avgEntryPrice: 0, totalCost: 0 },
          realizedPnl: prev.realizedPnl + tradePnl,
          trades: [tradeWithPnl, ...prev.trades].slice(0, 200),
          lastFilledSignalId: signalId ?? prev.lastFilledSignalId,
          lastOrderTime: Date.now(),
        }))
        return tradeWithPnl
      }

      return null
    },
    [currentPrice, market?.isStale, experimentId, updateState],
  )

  // ------------------------------------------------------------------
  // MA Crossover strategy loop — fires on NEW closed candles only
  // ------------------------------------------------------------------
  useEffect(() => {
    const s = stateRef.current
    if (s.meta.experimentId !== experimentId || s.strategyStatus !== 'running') return
    if (!currentPrice || market?.isStale || closedCandles.length === 0) return

    const lastCandle = closedCandles[closedCandles.length - 1]
    if (!canEvaluateLiveCandles(closedCandles, s.strategyConfig, s.lastEvaluatedCandleTime, Date.now())) return

    // Only process each closed candle once
    updateState(prev => ({ ...prev, lastEvaluatedCandleTime: lastCandle.openTime }))

    const cfg = s.strategyConfig

    // Close-only stop trigger; execution still uses the fresh current quote,
    // never a retroactive fill at the candle's closing price.
    if (closedCandleStopTriggered(s.position, lastCandle, cfg.stopLossPct)) {
      const stopSignalId = `stop-${lastCandle.openTime}`
      executeTrade('sell', 'strategy', stopSignalId)
      return
    }

    // Detect NEW crossover on closed candles
    const result = detectMaCrossover(closedCandles, cfg.shortPeriod, cfg.longPeriod)
    if (!result) return

    // Signal dedup — never fire the same crossover twice
    if (s.lastFilledSignalId === result.signalId) return

    if (result.signal === 1 && s.position.btcAmount === 0) {
      // Bullish crossover while flat → buy
      executeTrade('buy', 'strategy', result.signalId)
    } else if (result.signal === -1 && s.position.btcAmount > 0) {
      // Bearish crossover while long → sell
      executeTrade('sell', 'strategy', result.signalId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedCandles, currentPrice, executeTrade, market?.isStale, state.strategyStatus, experimentId, updateState])
  // Fresh prices may rerun the effect; the persisted candle boundary makes
  // evaluation idempotent when the exchange has not closed another candle.

  // ------------------------------------------------------------------
  // Portfolio value history for drawdown
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!currentPrice || !Number.isFinite(currentPrice) || currentPrice <= 0 || market?.isStale) return
    updateState(prev => {
      if (prev.meta.experimentId !== experimentId) return prev
      const value = available(prev) + prev.reservedUsdc + prev.position.btcAmount * currentPrice
      const peakEquity = Math.max(prev.peakEquity, value)
      const drawdown = peakEquity > 0 ? (peakEquity - value) / peakEquity * 100 : 0
      const maxDrawdown = Math.max(prev.maxDrawdown, drawdown)
      return prev.peakEquity === peakEquity && prev.maxDrawdown === maxDrawdown
        ? prev : { ...prev, peakEquity, maxDrawdown }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrice, portfolioValue, market?.isStale, experimentId, updateState])
  // portfolioValue is derived from currentPrice + state, no extra dep needed

  // ------------------------------------------------------------------
  // Strategy controls
  // ------------------------------------------------------------------
  const startStrategy = useCallback(() => {
    const previous = stateRef.current
    if (previous.meta.experimentId !== experimentId || !isValidLiveConfig(previous.strategyConfig)
        || !currentPrice || !Number.isFinite(currentPrice) || currentPrice <= 0 || market?.isStale) return
    const boundary = startCandleBoundary(Date.now(), closedCandles[closedCandles.length - 1]?.openTime)
    updateState(s => ({
      ...s,
      strategyStatus: 'running',
      lastEvaluatedCandleTime: Math.max(s.lastEvaluatedCandleTime, boundary),
      meta: {
        ...s.meta,
        strategySnapshot: s.meta.strategySnapshot && isSameLiveConfig(s.strategyConfig, s.meta.strategySnapshot)
          ? s.meta.strategySnapshot : buildStrategySnapshot(s.strategyConfig),
      },
    }))
  }, [closedCandles, currentPrice, market?.isStale, experimentId, updateState])

  const pauseStrategy = useCallback(() => {
    updateState(s => ({ ...s, strategyStatus: 'paused' }))
  }, [updateState])

  const stopStrategy = useCallback(() => {
    updateState(s => ({ ...s, strategyStatus: 'idle' }))
    // Keep the evaluated-candle boundary to prevent Stop/Start replay.
  }, [updateState])

  const updateStrategyConfig = useCallback((cfg: Partial<StrategyConfig>) => {
    const previous = stateRef.current
    const nextConfig = { ...previous.strategyConfig, ...cfg }
    // A new config requires a reset after any trade, including a closed round trip.
    if (previous.meta.experimentId !== experimentId || !canApplyLiveConfig(previous.strategyConfig, nextConfig, {
      running: previous.strategyStatus === 'running', btcAmount: previous.position.btcAmount,
      tradeCount: previous.trades.length,
    })) return false
    updateState(s => ({ ...s, strategyConfig: nextConfig }))
    return true
  }, [experimentId, updateState])

  // ------------------------------------------------------------------
  // Deposit / Withdrawal (wallet mode only)
  // ------------------------------------------------------------------
  const onDepositConfirmed = useCallback((amount: number) => {
    if (isPaperMode || !Number.isFinite(amount) || amount <= 0) return
    updateState(s => ({ ...s, depositedUsdc: s.depositedUsdc + amount }))
  }, [isPaperMode, updateState])

  const onWithdrawConfirmed = useCallback((amount: number) => {
    if (isPaperMode || !Number.isFinite(amount) || amount <= 0) return
    updateState(s => amount <= available(s) && amount <= s.depositedUsdc ? ({
      ...s, depositedUsdc: s.depositedUsdc - amount,
    }) : s)
  }, [isPaperMode, updateState])

  // ------------------------------------------------------------------
  // Reset experiment
  // ------------------------------------------------------------------
  const resetExperiment = useCallback(() => {
    updateState(prev => {
      const fresh = makeInitialState(experimentId, currentPrice)
      // In wallet mode: preserve the deposited amount (on-chain record persists)
      // In paper mode: reset to full virtual budget
      return {
        ...fresh,
        depositedUsdc: isPaperMode ? VIRTUAL_PAPER_USDC : prev.depositedUsdc,
        meta: {
          ...fresh.meta,
          btcPriceAtStart: currentPrice,
        },
      }
    })
  }, [experimentId, isPaperMode, currentPrice, updateState])

  // ------------------------------------------------------------------
  // Export trades
  // ------------------------------------------------------------------
  const exportTrades = useCallback(() => {
    exportTradesToCsv(stateRef.current.trades, experimentId)
  }, [experimentId])

  return {
    state,
    unrealizedPnl,
    portfolioValue,
    freeUsdc,
    tradingBudget,
    isPaperMode,
    shortMA,
    longMA,
    closedCandleCount: closedCandles.length,
    warmupRequired: state.strategyConfig.longPeriod + 1,
    buyAndHoldReturn,
    onDepositConfirmed,
    onWithdrawConfirmed,
    executeTrade,
    startStrategy,
    pauseStrategy,
    stopStrategy,
    updateStrategyConfig,
    resetExperiment,
    exportTrades,
  }
}
