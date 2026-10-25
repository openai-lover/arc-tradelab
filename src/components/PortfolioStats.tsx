import { Wallet, TrendingUp, Activity, ChartNoAxesCombined } from 'lucide-react'
import type { TradingState } from '../hooks/useTradingState'

interface Props {
  state: TradingState
  unrealizedPnl: number
  portfolioValue: number
  freeUsdc: number
  currentPrice: number | null
  buyAndHoldReturn: number | null
}
const fmt = (value: number, decimals = 2) => value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
export function PortfolioStats({ state, unrealizedPnl, portfolioValue, freeUsdc, currentPrice, buyAndHoldReturn }: Props) {
  const totalReturn = state.depositedUsdc > 0 ? (portfolioValue - state.depositedUsdc) / state.depositedUsdc * 100 : 0
  const pnlColor = totalReturn > 0 ? 'var(--gain)' : totalReturn < 0 ? 'var(--loss)' : 'var(--ink)'
  return <section aria-label="Live paper portfolio" className="panel metric-strip">
    <div className="metric-cell"><p className="metric-label"><Wallet size={12} />Simulated balance</p><p className="metric-value">{fmt(portfolioValue)}<small>sim USDC</small></p><p className="metric-note">{fmt(freeUsdc)} available · {fmt(state.depositedUsdc, 0)} initial</p></div>
    <div className="metric-cell" title={`Realized: ${fmt(state.realizedPnl)} · Unrealized: ${fmt(unrealizedPnl)} sim USDC`}><p className="metric-label"><TrendingUp size={12} />Total return</p><p className="metric-value" style={{ color: pnlColor }}>{totalReturn > 0 ? '+' : ''}{fmt(totalReturn)}<small>%</small></p><p className="metric-note">{state.trades.length ? `${fmt(state.realizedPnl)} realized sim P/L` : 'Waiting for your first paper trade'}</p></div>
    <div className="metric-cell" title={buyAndHoldReturn !== null ? `Buy & hold since experiment start: ${fmt(buyAndHoldReturn)}%` : 'Buy & hold comparison appears after the experiment starts'}><p className="metric-label"><ChartNoAxesCombined size={12} />Max drawdown</p><p className="metric-value">{state.trades.length >= 2 ? fmt(state.maxDrawdown) : '—'}{state.trades.length >= 2 && <small>%</small>}</p><p className="metric-note">{state.trades.length >= 2 ? 'Largest observed portfolio decline' : 'Available after two trades'}</p></div>
    <div className="metric-cell" title={`Virtual BTC: ${fmt(state.position.btcAmount, 8)} · mark value: ${currentPrice ? fmt(state.position.btcAmount * currentPrice) : '—'} sim USDC`}><p className="metric-label"><Activity size={12} />Paper trades</p><p className="metric-value">{state.trades.length.toLocaleString()}<small>fills</small></p><p className="metric-note">{state.position.btcAmount > 0 ? `${fmt(state.position.btcAmount, 6)} virtual BTC held` : 'No open BTC position'}</p></div>
  </section>
}