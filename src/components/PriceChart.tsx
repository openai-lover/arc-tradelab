import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { usePlotWidth } from '../hooks/usePlotWidth'
import { groupMarketCandles } from '../trading/marketCandles'
import type { MarketCandle } from '../trading/marketCandles'
import type { Trade } from '../trading/engine'

interface Props { candles: MarketCandle[]; price: number | null; trades: Trade[]; updatedAt: number | null }
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const time = (n: number) => new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
const UP = '#f04452', DOWN = '#3182f6'

export function PriceChart({ candles, price, trades, updatedAt }: Props) {
  const [interval, setTimeframe] = useState<1 | 5 | 15>(1)
  const [count, setCount] = useState(70)
  const [offset, setOffset] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const { ref: plotRef, width } = usePlotWidth()
  const grouped = useMemo(() => groupMarketCandles(candles, interval), [candles, interval])
  const maxOffset = Math.max(0, grouped.length - count)
  const safeOffset = Math.min(offset, maxOffset)
  const end = grouped.length - safeOffset
  const visible = grouped.slice(Math.max(0, end - count), end)
  const selectedIndex = hover === null ? visible.length - 1 : Math.min(hover, visible.length - 1)
  const selected = visible[selectedIndex]
  const left = 16, right = width - 80, top = 16, bottom = 248, volumeBottom = 316
  const low = visible.length ? Math.min(...visible.map(c => c.low)) : 0
  const high = visible.length ? Math.max(...visible.map(c => c.high)) : 1
  const pad = Math.max((high - low) * .14, high * .00004)
  const y = (v: number) => bottom - (v - low + pad) / (high - low + 2 * pad) * (bottom - top)
  const step = (right - left) / Math.max(visible.length, 1)
  const x = (i: number) => left + step * (i + .5)
  const bodyWidth = Math.max(1, Math.min(10, step * .62))
  const maxVolume = Math.max(1, ...visible.map(c => c.volume))
  const last = visible[visible.length - 1]
  const periodChange = visible.length > 1 ? (visible[visible.length - 1].close / visible[0].open - 1) * 100 : null
  const delayed = !updatedAt || clock - updatedAt > 45_000 || (candles.length > 0 && clock - candles[candles.length - 1].closeTime > 60_000)
  return <section className="panel candle-panel" aria-label="BTC candlestick chart">
    <div className="candle-heading"><div className="coin-name"><span className="bitcoin-icon">₿</span><div><h2>Bitcoin <span>BTC / USDT</span></h2><p className="market-price">{price === null ? '—' : fmt(price)} <small>USDT</small></p><p className="price-period">{periodChange !== null && <><b style={{ color: periodChange >= 0 ? UP : DOWN }}>{periodChange > 0 ? '+' : ''}{periodChange.toFixed(2)}%</b><span>in displayed candles</span></>}</p></div></div><span className={`market-feed-label ${delayed ? 'is-delayed' : ''}`}><i />{delayed ? 'Delayed' : 'Live'}<span>· Binance</span></span></div>
    <div className="candle-toolbar"><div className="segment-control" aria-label="Candle interval">{([1, 5, 15] as const).map(value => <button key={value} aria-pressed={interval === value} onClick={() => { setTimeframe(value); setOffset(0); setHover(null) }}>{value}m</button>)}</div><div className="chart-tools"><button aria-label="Zoom in chart" disabled={count <= 30} onClick={() => { setCount(c => Math.max(30, c - 20)); setHover(null) }}><Plus size={15} /></button><button aria-label="Zoom out chart" disabled={count >= 150} onClick={() => { setCount(c => Math.min(150, c + 20)); setHover(null) }}><Minus size={15} /></button><button aria-label="Latest candles" onClick={() => { setOffset(0); setHover(null) }}><RotateCcw size={13} /></button></div></div>
    <div className="ohlc-row" aria-live="off">{selected ? <><span>{time(selected.openTime)}</span><span>O <b>{fmt(selected.open)}</b></span><span>H <b>{fmt(selected.high)}</b></span><span>L <b>{fmt(selected.low)}</b></span><span>C <b style={{ color: selected.close >= selected.open ? UP : DOWN }}>{fmt(selected.close)}</b></span>{!selected.closed && <span className="forming-label">Forming</span>}</> : <span>Loading minute candles…</span>}</div>
    <div ref={plotRef} className="candle-plot">{visible.length ? <svg viewBox={`0 0 ${width} 344`} className="w-full" tabIndex={0} role="img" aria-label={`${interval}-minute Bitcoin candlesticks, ${visible.length} candles. Red up, blue down. Use left and right arrow keys to inspect OHLC.`}
      onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(visible.length - 1, Math.floor(((event.clientX - bounds.left) * width / bounds.width - left) / step)))) }}
      onPointerLeave={() => setHover(null)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setHover(Math.max(0, Math.min(visible.length - 1, selectedIndex + (event.key === 'ArrowLeft' ? -1 : 1)))) } }}>
      {[0, 1, 2, 3, 4].map(i => { const value = high + pad - (high - low + 2 * pad) * i / 4; return <g key={i}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#f0f2f5" /><text x={right + 10} y={y(value) + 4} fill="#8b95a1" fontSize="10">{fmt(value)}</text></g> })}
      <text x={left} y="272" fontSize="10" fill="#8b95a1">Volume · BTC{selected ? ` ${selected.volume.toFixed(3)}` : ''}</text>
      {visible.map((c, i) => { const color = c.close >= c.open ? UP : DOWN; const volumeHeight = c.volume / maxVolume * 35; return <g key={c.openTime} opacity={!c.closed ? .7 : 1} data-candle={c.openTime}>
        <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1" />
        <rect x={x(i) - bodyWidth / 2} y={Math.min(y(c.open), y(c.close))} width={bodyWidth} height={Math.max(1.3, Math.abs(y(c.open) - y(c.close)))} rx=".6" fill={color} />
        <rect x={x(i) - bodyWidth / 2} y={volumeBottom - volumeHeight} width={bodyWidth} height={Math.max(.5, volumeHeight)} rx=".5" fill={color} opacity=".22" />
      </g> })}
      {last && <g><line x1={left} x2={right} y1={y(last.close)} y2={y(last.close)} stroke={last.close >= last.open ? UP : DOWN} opacity=".35" strokeDasharray="3 4" /><rect x={right + 2} y={y(last.close) - 10} width="76" height="20" rx="4" fill={last.close >= last.open ? UP : DOWN} /><text x={right + 40} y={y(last.close) + 3.5} textAnchor="middle" fill="white" fontSize="10">{fmt(last.close)}</text></g>}
      {hover !== null && selected && <g><line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={top} y2={volumeBottom} stroke="#8b95a1" strokeDasharray="3 3" /><circle cx={x(selectedIndex)} cy={y(selected.close)} r="3" fill="#4e5968" /></g>}
      {trades.filter(t => visible.some(c => t.timestamp >= c.openTime && t.timestamp <= c.closeTime)).map(t => { const i = visible.findIndex(c => t.timestamp >= c.openTime && t.timestamp <= c.closeTime); return <g key={t.id}><circle cx={x(i)} cy={t.side === 'buy' ? y(visible[i].low) + 11 : y(visible[i].high) - 11} r="7" fill={t.side === 'buy' ? UP : DOWN} /><text x={x(i)} y={(t.side === 'buy' ? y(visible[i].low) + 11 : y(visible[i].high) - 11) + 3} fontSize="8" textAnchor="middle" fill="white">{t.side === 'buy' ? 'B' : 'S'}</text><title>{t.side} · {fmt(t.execPrice)} USDT · simulated fill</title></g> })}
      {(width < 450 ? [0, 1] : [0, .33, .66, 1]).map(ratio => { const i = Math.round((visible.length - 1) * ratio); return <text key={ratio} x={x(i)} y="338" fill="#8b95a1" textAnchor={ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'} fontSize="10">{time(visible[i].openTime)}</text> })}
    </svg> : <div className="empty-state" style={{ minHeight: 344 }}><h3>Loading BTC candles</h3><p>Waiting for exchange data.</p></div>}</div>
    <div className="chart-bottom"><span className="small-note">{updatedAt ? `Updated ${time(updatedAt)} · 15s refresh` : 'Waiting for Binance'}{safeOffset > 0 ? ' · Earlier candles' : ''}</span><label className="chart-history"><span>Earlier</span><input aria-label="Scroll candle history" type="range" min="0" max={maxOffset || 1} disabled={!maxOffset} value={maxOffset - safeOffset} onChange={e => { setOffset(maxOffset - Number(e.target.value)); setHover(null) }} /><span>Latest</span></label></div>
    <details className="chart-disclosure"><summary>Chart details</summary><p>Red candles closed above their open; blue candles closed below. Forming candles can change. Times use your device timezone. B/S markers show simulated fills. Chart intervals do not change the bot’s one-minute rules. Quotes are BTC/USDT, not USD.</p></details>
  </section>
}


