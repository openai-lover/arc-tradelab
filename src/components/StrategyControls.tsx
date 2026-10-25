import { useState } from 'react'
import { isValidLiveConfig } from '../trading/liveGuards'
import { Play, Pause, Square, Settings2, RotateCcw, Download, ArrowRight, Clock3, CheckCircle2, ChevronDown, Save } from 'lucide-react'
import type { StrategyConfig, StrategySnapshot } from '../trading/engine'
import { SIM_FEE_BPS, SIM_SLIPPAGE_BPS } from '../trading/engine'
import type { StrategyStatus } from '../hooks/useTradingState'
import { BotGlyph } from './Brand'

interface Props {
  config: StrategyConfig
  status: StrategyStatus
  strategySnapshot: StrategySnapshot | null
  freeUsdc: number
  hasPosition: boolean
  hasTrades: boolean
  isStale: boolean
  closedCandleCount: number
  warmupRequired: number
  settingsOpen: boolean
  onToggleSettings: () => void
  onStart: () => void
  onPause: () => void
  onStop: () => void
  onUpdateConfig: (config: Partial<StrategyConfig>) => boolean
  onManualBuy: () => void
  onManualSell: () => void
  onSaveVersion: () => void
  onResetExperiment: () => void
  onExportTrades: () => void
}

export function StrategyControls({
  config, status, strategySnapshot, freeUsdc, hasPosition, hasTrades, isStale,
  closedCandleCount, warmupRequired, settingsOpen, onToggleSettings,
  onStart, onPause, onStop, onUpdateConfig, onManualBuy, onManualSell, onSaveVersion, onResetExperiment, onExportTrades,
}: Props) {
  const [draft, setDraft] = useState<{ base: StrategyConfig; values: Record<string, string> } | null>(null)
  const [settingsError, setSettingsError] = useState('')
  const values = draft?.base === config ? draft.values : Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value)]))
  const hasDraft = draft?.base === config && Object.entries(values).some(([key, value]) => value !== String(config[key as keyof StrategyConfig]))
  const running = status === 'running'
  const locked = running || hasPosition || hasTrades
  const ready = closedCandleCount >= warmupRequired
  // A held position can still be sold even when free cash is below one cent.
  const canStart = !hasDraft && !isStale && (freeUsdc >= .01 || hasPosition)
  return <section className="panel panel-padding" id="strategy-controls" aria-labelledby="strategy-title">
    <div className="panel-topline"><span className="quiet-label">Your live test</span><span className={`pill ${running ? 'pill-green' : ''}`}>{running ? 'Running' : status === 'paused' ? 'Paused' : 'Ready to set up'}</span></div>
    <div className="strategy-identity"><BotGlyph variant={1} /><div><h2 className="panel-title" id="strategy-title">BTC trend bot</h2><p>SMA {config.shortPeriod} / {config.longPeriod} · 1-minute candles</p></div></div>
    
    <div className="flex gap-2 mt-4">
      {running ? <button className="btn btn-primary strategy-run" onClick={onPause}><Pause size={14} />Pause live test</button> : <button className="btn btn-primary strategy-run" onClick={onStart} disabled={!canStart}><Play size={14} />{status === 'paused' ? 'Resume live test' : 'Start live test'}</button>}
      {status !== 'idle' && <button className="btn" aria-label="Stop strategy" onClick={onStop}><Square size={13} /></button>}
    </div>
    {hasDraft && <p className="small-note mt-2" style={{ color: 'var(--warn)' }}>Apply your rule changes below before starting or saving.</p>}
    <div className="rule-flow">
      <div className="rule-row"><span className="rule-tag">BUY</span><span>SMA {config.shortPeriod} crosses <strong>above</strong> SMA {config.longPeriod}</span></div>
      <div className="rule-row"><span className="rule-tag sell">SELL</span><span>SMA {config.shortPeriod} crosses <strong>below</strong> SMA {config.longPeriod}</span></div>
    </div>
    <dl className="rule-facts"><div><dt>Per order</dt><dd>{config.orderSizeUsdc} <span className="small-note">sim USDC</span></dd></div><div><dt>Allocation limit</dt><dd>{config.maxAllocationPct}%</dd></div><div><dt>Candle interval</dt><dd>1 minute</dd></div><div><dt>Close-based stop loss</dt><dd>{config.stopLossPct === 0 ? 'Off' : `${config.stopLossPct}%`}</dd></div></dl>
    <p className="status-note mt-3">{isStale ? <><Clock3 size={12} />Waiting for a fresh price before trading.</> : !ready ? <><Clock3 size={12} />Loading candles ({Math.min(closedCandleCount, warmupRequired)}/{warmupRequired})</> : running ? <><ActivityDot />Watching for the next new crossover.</> : <><CheckCircle2 size={12} />Market data ready · simulated trades only</>}</p>
    <button className="btn btn-quiet w-full mt-3" aria-expanded={settingsOpen} aria-controls="strategy-rule-settings" onClick={onToggleSettings}><Settings2 size={13} />Edit rules<ChevronDown size={13} /></button>
    <div id="strategy-rule-settings" hidden={!settingsOpen} className="pt-3">
      {locked && <p className="notice notice-amber mb-3">Rules are locked for this experiment. Export your records and reset before changing them.</p>}
      <div className="fields-grid">
        {([
          { key: 'shortPeriod', label: 'Fast average (candles)', min: 1, max: config.longPeriod - 1, step: 1 },
          { key: 'longPeriod', label: 'Slow average (candles)', min: config.shortPeriod + 1, max: 500, step: 1 },
          { key: 'orderSizeUsdc', label: 'Order size (sim USDC)', min: 1, max: 100, step: 1 },
          { key: 'maxAllocationPct', label: 'Allocation limit (%)', min: 10, max: 100, step: 5 },
          { key: 'stopLossPct', label: 'Close-based stop (%)', min: 0, max: 100, step: 1 },
        ] as const).map(field => <label className="field-label" key={field.key}>{field.label}<input type="number" aria-label={field.label} disabled={locked} min={field.min} max={field.max} step={field.step} value={values[field.key]} onChange={event => { setDraft({ base: config, values: { ...values, [field.key]: event.target.value } }); setSettingsError('') }} /></label>)}
      </div>
            {settingsError && <p className="small-note mt-3" role="alert" style={{ color: 'var(--danger)' }}>{settingsError}</p>}
      <button className="btn btn-primary w-full mt-3" disabled={locked || !hasDraft} onClick={() => {
        const next = { ...config, shortPeriod: Number(values.shortPeriod), longPeriod: Number(values.longPeriod), orderSizeUsdc: Number(values.orderSizeUsdc), maxAllocationPct: Number(values.maxAllocationPct), stopLossPct: Number(values.stopLossPct) }
        if (Object.values(values).some(value => value.trim() === '') || !isValidLiveConfig(next)) { setSettingsError('Use valid numbers: fast average must be below slow average (maximum 500). Order size must be positive; allocation 0–100% (above zero), stop 0–100%.'); return }
        if (onUpdateConfig(next)) { setDraft(null); setSettingsError('') }
        else setSettingsError('Rules are locked. Export and reset the experiment before changing them.')
      }}>Apply rule changes</button>
      <p className="small-note mt-3">Buy when flat; sell the held position on a new downward crossover or a candle-close stop. Moving averages use completed candles.</p>
    </div>
    <button className="btn btn-soft w-full mt-3" disabled={hasDraft} onClick={onSaveVersion}><Save size={13} />Save & backtest <ArrowRight size={12} /></button>
    <details className="disclosure"><summary>Manual paper order</summary><p className="small-note mb-3">Manual fills are labeled separately in your report.</p><div className="flex gap-2"><button className="btn btn-soft flex-1" disabled={isStale || freeUsdc < .01} onClick={onManualBuy}>Paper buy</button><button className="btn flex-1" disabled={isStale || !hasPosition} onClick={onManualSell}>Paper sell</button></div></details>
    <details className="disclosure"><summary>Costs & experiment details</summary><dl className="space-y-2 small-note"><div>Modeled fee: {SIM_FEE_BPS / 100}% per fill</div><div>Adverse slippage: {SIM_SLIPPAGE_BPS / 100}%</div><div>Live fills use the fresh observed quote after a signal. Gas is not measured; no chain transaction is sent.</div>{strategySnapshot && <div>Strategy snapshot v{strategySnapshot.version} · started {new Date(strategySnapshot.startedAt).toLocaleString()}</div>}</dl><div className="form-actions mt-4"><button className="btn" onClick={onExportTrades}><Download size={12} />Export CSV</button><button className="btn" onClick={onResetExperiment}><RotateCcw size={12} />Reset experiment</button></div></details>
  </section>
}
function ActivityDot() { return <span className="eyebrow-dot" /> }
