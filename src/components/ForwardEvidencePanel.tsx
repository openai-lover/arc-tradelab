import { useRef, useState } from 'react'
import { ArrowRight, Download, Camera } from 'lucide-react'
import { generateForwardReport } from '../trading/forwardReport'
import type { ForwardMarketMetadata } from '../trading/forwardReport'
import type { TradingState } from '../hooks/useTradingState'

type Export = Awaited<ReturnType<typeof generateForwardReport>>

export function ForwardEvidencePanel({ state, market, onBackToLab }: { state: TradingState; market: ForwardMarketMetadata; onBackToLab: () => void }) {
  const [result, setResult] = useState<Export | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const capture = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { setResult(await generateForwardReport(state, market)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not capture this experiment.') }
    finally { lock.current = false; setBusy(false) }
  }
  const download = () => {
    if (!result) return
    const url = URL.createObjectURL(new Blob([result.json], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `arctradelab-forward-${result.sha256.slice(0, 12)}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="panel panel-padding space-y-5">
    <div><h1 className="page-heading">Live results</h1><p className="panel-subtitle">Your current experiment, with every simulated fill.</p></div>
    <div className="notice">{state.trades.length === 0 ? 'Your experiment has no paper fills yet. Start a live test to begin collecting a record, or capture its empty state.' : `${state.trades.length} retained fills are available to capture from your current experiment.`}</div>
    <div className="form-actions"><button className="btn btn-primary" disabled={busy} onClick={() => { void capture() }}><Camera size={14} />{busy ? 'Checking the retained ledger…' : 'Capture current experiment'}</button>{result && <button className="btn" onClick={download}><Download size={13} />Download forward report</button>}<button className="btn btn-quiet" onClick={onBackToLab}>Go to live test<ArrowRight size={13} /></button></div>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    {result && <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Retained fills', result.report.summary.retainedTradeCount], ['Automated fills', result.report.summary.strategyTradeCount], ['Manual fills', result.report.summary.manualTradeCount], ['Realized P/L (sim)', result.report.summary.realizedPnl.toFixed(4)]].map(([label, value]) => <p className="p-3 rounded-lg text-xs" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }} key={label}><span>{label}</span><strong className="display block mt-1 text-lg" style={{ color: 'var(--ink)' }}>{value}</strong></p>)}</div>
      <p className="text-xs break-all mono" style={{ color: 'var(--muted)' }}>Exact report-file SHA-256: {result.sha256}</p>
      <p className="text-sm" style={{ color: 'var(--warn)' }}>No onchain registration has been submitted. A file hash alone does not prove uninterrupted execution or price accuracy.</p>
      <div className="overflow-auto"><table className="w-full text-xs text-left"><thead style={{ color: 'var(--muted)' }}><tr><th className="p-2">Local time (UTC)</th><th className="p-2">Source</th><th className="p-2">Side</th><th className="p-2">BTC</th><th className="p-2">Price (USDT)</th><th className="p-2">Arc record</th></tr></thead><tbody>{result.report.timeline.map(trade => <tr key={trade.id} style={{ borderTop: '1px solid var(--border)' }}><td className="p-2">{new Date(trade.timestamp).toISOString()}</td><td className="p-2">{trade.source}</td><td className="p-2">{trade.side}</td><td className="p-2 mono">{trade.btcAmount.toFixed(8)}</td><td className="p-2 mono">{trade.execPrice.toFixed(2)}</td><td className="p-2">Not submitted</td></tr>)}</tbody></table></div>
      {result.report.timeline.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No retained fills. This report makes no trading-performance claim.</p>}
      <details className="text-xs" style={{ color: 'var(--muted)' }}><summary>What this report can verify</summary><ul className="list-disc pl-5 mt-2 space-y-2">{result.report.disclosures.map(text => <li key={text}>{text}</li>)}</ul></details>
    </div>}
  </section>
}
