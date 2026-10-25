import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BarChart3, Download, FileUp, FlaskConical, Layers3, Play } from 'lucide-react'
import { fetchRecentDataset } from '../trading/marketCandles'
import { runSmaBacktest } from '../trading/backtest'
import type { HistoricalDataset } from '../trading/backtest'
import { usePlotWidth } from '../hooks/usePlotWidth'
import { createDemoDataset, DEMO_SOURCE } from '../trading/demoDataset'
import type { StrategyPackage } from '../marketplace/strategyPackage'

type Report = ReturnType<typeof runSmaBacktest> & { inputSha256: string; strategyPackage: StrategyPackage | null; reportSha256: string }
export interface BacktestReady { strategy: StrategyPackage; reportText: string; datasetText: string }

const sha256 = async (bytes: BufferSource) => {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
}

interface BacktestProps {
  strategyPackage?: StrategyPackage | null
  /**
   * Pre-fetched dataset JSON text from OverviewPanel's starter flow.
   * When set, BacktestPanel runs it immediately instead of fetching again.
   * Clear it by calling onPendingDatasetConsumed after use.
   */
  pendingDataset?: string
  onPendingDatasetConsumed?: () => void
  onPreparePublication?: (draft: BacktestReady) => void
  onChooseVersion?: () => void
}

export function BacktestPanel({ strategyPackage = null, pendingDataset, onPendingDatasetConsumed, onPreparePublication, onChooseVersion }: BacktestProps) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shortPeriod, setShortPeriod] = useState(5)
  const [longPeriod, setLongPeriod] = useState(20)
  const [initialCash, setInitialCash] = useState(100)
  const [datasetText, setDatasetText] = useState('')
  const lock = useRef(false)
  // Track which pendingDataset string we last consumed so we don't re-run the same one.
  const consumedDataset = useRef<string | undefined>(undefined)

  const runInput = async (readBytes: () => Promise<ArrayBuffer>, sample = false) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setReport(null)
    try {
      const snapshot = sample ? null : strategyPackage
      const config = snapshot?.config
      const bytes = await readBytes()
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      const input = JSON.parse(text) as HistoricalDataset
      if (snapshot && (input.symbol !== snapshot.market.symbol || input.quoteCurrency !== snapshot.market.quoteAsset
        || typeof input.source !== 'string' || input.source.trim().toLowerCase() !== snapshot.market.provider.toLowerCase())) {
        throw new Error('This version requires data attributed to Binance, with symbol BTCUSDT and quoteCurrency USDT. Attribution does not authenticate prices.')
      }
      if (!Array.isArray(input.candles) || input.candles.length > 50_000) throw new Error('Expected at most 50,000 candles.')
      const inputSha256 = await sha256(bytes)
      const result = runSmaBacktest(input, {
        shortPeriod: sample ? 5 : config?.shortPeriod ?? shortPeriod,
        longPeriod: sample ? 20 : config?.longPeriod ?? longPeriod, intervalMs: 60_000,
        initialCash: sample ? 100 : initialCash, orderCash: config?.orderSizeUsdc ?? 10,
        maxAllocationPct: sample ? 80 : config?.maxAllocationPct ?? 100,
        stopLossPct: sample ? 5 : config?.stopLossPct ?? 0,
        feeBps: snapshot?.assumptions.simFeeBps ?? 10, slippageBps: snapshot?.assumptions.simSlippageBps ?? 5,
      })
      const content = { ...result, inputSha256, strategyPackage: snapshot }
      const reportSha256 = await sha256(new TextEncoder().encode(JSON.stringify(content)))
      setReport({ ...content, reportSha256 }); setDatasetText(text)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read this dataset.') }
    finally { lock.current = false; setBusy(false) }
  }

  // Auto-run a pre-fetched dataset supplied by the overview starter flow.
  // Guard: only consume once per unique string value; ignore rerenders.
  useEffect(() => {
    if (!pendingDataset || pendingDataset === consumedDataset.current) return
    consumedDataset.current = pendingDataset
    onPendingDatasetConsumed?.()
    const text = pendingDataset
    void runInput(() => Promise.resolve(new TextEncoder().encode(text).buffer as ArrayBuffer))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDataset])

  const runFile = (file: File | undefined) => {
    if (file) void runInput(async () => {
      if (file.size > 6 * 1024 * 1024) throw new Error('Please use a JSON file smaller than 6 MB.')
      return file.arrayBuffer()
    })
  }
  const download = () => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url
    link.download = report.dataset.source === DEMO_SOURCE ? 'arctradelab-SYNTHETIC-DEMO-report.json' : 'arctradelab-backtest-report.json'
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const runSample = () => { void runInput(() => Promise.resolve(new TextEncoder().encode(JSON.stringify(createDemoDataset())).buffer as ArrayBuffer), true) }
  const isSample = report?.dataset.source === DEMO_SOURCE

  return <section aria-labelledby="backtest-title">
    <h2 className="sr-only" id="backtest-title">Historical backtest</h2>
    <div className="results-grid">
      <div className="panel panel-padding space-y-5">
        <div><p className="eyebrow">Bot</p><p className="text-sm font-semibold">{strategyPackage ? `${strategyPackage.name} · v${strategyPackage.version}` : 'Moving average bot'}</p><p className="panel-subtitle">{strategyPackage ? 'Versioned rules' : 'Choose a saved bot to prepare it for sale.'}</p><button className="btn btn-quiet mt-2" onClick={onChooseVersion}><Layers3 size={13} />{strategyPackage ? 'Change version' : 'Choose a saved version'}<ArrowRight size={12} /></button></div>
        <div className="fields-grid">
          <label className="field-label">Fast average<input aria-label="Backtest short SMA" type="number" min={1} max={499} disabled={busy || !!strategyPackage} value={strategyPackage?.config.shortPeriod ?? shortPeriod} onChange={e => setShortPeriod(Number(e.target.value))} /></label>
          <label className="field-label">Slow average<input aria-label="Backtest long SMA" type="number" min={2} max={500} disabled={busy || !!strategyPackage} value={strategyPackage?.config.longPeriod ?? longPeriod} onChange={e => setLongPeriod(Number(e.target.value))} /></label>
        </div>
        <label className="field-label">Starting cash (quote currency)<input aria-label="Backtest initial cash" type="number" min={.01} max={1_000_000} disabled={busy} value={initialCash} onChange={e => setInitialCash(Number(e.target.value))} /></label>
        <div><button className="btn btn-primary w-full" disabled={busy} onClick={() => { void runInput(async () => new TextEncoder().encode(JSON.stringify(await fetchRecentDataset())).buffer as ArrayBuffer) }}><Play size={14} />{busy ? 'Running backtest…' : 'Run with recent BTC data'}</button><p className="small-note mt-2">Latest 1,000 one-minute candles from Binance. The open candle is excluded. About 16 hours, not a long-term performance record.</p></div>
        <details className="disclosure"><summary>Use a different dataset</summary><label className="upload-zone"><FileUp size={22} style={{ color: 'var(--accent)' }} /><strong className="text-xs">Import candles &amp; run</strong><span className="small-note">Closed one-minute candles · JSON · up to 6 MB</span><input aria-label="Import historical candle JSON" type="file" accept=".json,application/json" disabled={busy} onChange={e => { runFile(e.target.files?.[0]); e.target.value = '' }} /></label></details>
        <details className="small-note"><summary>Try a tutorial (synthetic)</summary><button className="btn btn-soft" disabled={busy} onClick={runSample}>Run synthetic sample</button><p className="small-note mt-2">Generated prices, not market performance. Cannot be sold.</p></details>
        <details className="small-note"><summary>Dataset format &amp; fill assumptions</summary><pre className="overflow-auto text-[10px]">{JSON.stringify({ source: 'Binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT', retrievedAt: 'ISO-8601 timestamp', candles: [{ openTime: 0, open: 100, high: 101, low: 99, close: 100 }] }, null, 2)}</pre><p className="mt-2">At least long SMA + 2 consecutive closed one-minute candles. This format example is synthetic. Signals and stops use closes; modeled fills use the next open. Fee 0.10%, slippage 0.05%. Live fills use the fresh observed quote after a signal.</p></details>
      </div>
      <div className="panel panel-padding" aria-busy={busy}>
        {error && <p role="alert" className="notice notice-amber mb-4">{error}</p>}
        {report ? <>
          <div className="panel-topline"><div><p className="eyebrow">{isSample ? 'SYNTHETIC DEMO · NOT MARKET PERFORMANCE' : 'HISTORICAL SIMULATION'}</p><h3 className="panel-title">{isSample ? 'A sample strategy report' : report.strategyPackage ? `${report.strategyPackage.name} · v${report.strategyPackage.version}` : 'Standalone strategy report'}</h3></div><FlaskConical size={20} style={{ color: 'var(--accent)' }} /></div>
          {isSample && <p className="notice notice-amber">These prices are generated for the tutorial. Results are not historical market performance and cannot be prepared for sale. Your live experiment is unchanged.</p>}
          <dl className="report-metrics">
            <div><dt>Strategy return</dt><dd style={{ color: report.returnPct >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{report.returnPct.toFixed(2)}%</dd></div>
            <div><dt>Max drawdown · closes</dt><dd>{report.maxDrawdownPct.toFixed(2)}%</dd></div>
            <div><dt>Buy &amp; hold return</dt><dd>{report.buyAndHoldReturnPct.toFixed(2)}%</dd></div>
            <div><dt>Completed trades</dt><dd>{report.completedTrades}</dd></div>
          </dl>
          <div className="flex justify-between items-center"><h4 className="text-xs font-semibold">Simulated portfolio value</h4><span className="chart-legend"><span><i className="chart-key" />Strategy</span><span><i className="chart-key" style={{ background: '#a3b3b7' }} />Initial cash</span></span></div>
          <EquityChart equity={report.equityCurve} initialCash={report.config.initialCash} quote={report.dataset.quoteCurrency} />
          <p className="small-note mb-1">{new Date(report.startedAt).toISOString().slice(0, 16).replace('T', ' ')} – {new Date(report.endedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</p><p className="small-note mb-4">{report.dataset.symbol} · {report.evaluatedCandles.toLocaleString()} evaluated candles + {report.warmupCandles} warm-up · {report.config.feeBps / 100}% fee · {report.config.slippageBps / 100}% slippage</p>
          <div className="form-actions"><button className="btn" onClick={download}><Download size={13} />Download full report</button>{report.strategyPackage && !isSample && onPreparePublication && <button className="btn btn-primary" onClick={() => onPreparePublication({ strategy: report.strategyPackage!, reportText: JSON.stringify(report, null, 2), datasetText })}>Sell this bot<ArrowRight size={13} /></button>}</div>
          <details className="disclosure"><summary>Source, checksums &amp; calculation limits</summary><p className="small-note break-all">Source: {report.dataset.source}. Retrieved: {report.dataset.retrievedAt}. Attribution does not authenticate prices.</p><p className="small-note mono break-all mt-2">Dataset SHA-256: {report.inputSha256}</p>{report.strategyPackage && <p className="small-note mono break-all mt-2">Strategy content SHA-256: {report.strategyPackage.digest.value}</p>}<p className="small-note mono break-all mt-2">Report content SHA-256: {report.reportSha256}</p><p className="small-note mt-2">Report checksum covers compact JSON excluding the checksum field. No blockchain record has been created.</p><p className="small-note mt-2">{report.disclosure}</p></details>
        </> : <div className="empty-state" style={{ paddingTop: 72, paddingBottom: 72 }}><div className="empty-icon"><BarChart3 size={22} /></div><h3>Ready to test</h3><p>Run with recent BTC data to see return,<br />risk and every simulated trade.</p></div>}
      </div>
    </div>
  </section>
}

function EquityChart({ equity, initialCash, quote }: { equity: { timestamp: number; value: number }[]; initialCash: number; quote: string }) {
  const { ref: plotRef, width: plotWidth } = usePlotWidth()
  if (equity.length < 2) return null
  const values = equity.map(point => point.value)
  const min = Math.min(initialCash, ...values), max = Math.max(initialCash, ...values)
  const pad = Math.max((max - min) * .15, .01), low = min - pad, high = max + pad
  const x = (index: number) => 10 + index / (equity.length - 1) * (plotWidth - 70)
  const y = (value: number) => 180 - (value - low) / (high - low) * 155
  const path = equity.map((point, i) => `${i ? 'L' : 'M'}${x(i)},${y(point.value)}`).join(' ')
  return <div ref={plotRef}><svg className="w-full my-3" viewBox={`0 0 ${plotWidth} 212`} role="img" aria-label={`Calculated strategy portfolio, initial ${initialCash} ${quote}, final ${equity[equity.length - 1].value.toFixed(2)} ${quote}`}>
    {[0, 1, 2, 3].map(i => { const value = high - (high - low) * i / 3; return <g key={i}><line x1="10" x2={plotWidth - 60} y1={y(value)} y2={y(value)} stroke="#e4ecea" strokeDasharray="3 4" /><text x={plotWidth - 52} y={y(value) + 3} fontSize="10" fill="#6b7e85">{value.toFixed(2)}</text></g> })}
    <line x1="10" x2={plotWidth - 60} y1={y(initialCash)} y2={y(initialCash)} stroke="#a3b3b7" strokeDasharray="5 4" />
    <path d={path} fill="none" stroke="#3182f6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    <text x="10" y="205" fontSize="10" fill="#6b7e85">{new Date(equity[0].timestamp).toISOString().slice(11, 16)} UTC</text><text x={plotWidth - 60} y="205" fontSize="10" textAnchor="end" fill="#6b7e85">{new Date(equity[equity.length - 1].timestamp).toISOString().slice(11, 16)} UTC · {quote}</text>
  </svg></div>
}
