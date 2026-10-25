import { useId, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { createStrategyPackage } from '../marketplace/strategyPackage'
import type { StrategyPackage } from '../marketplace/strategyPackage'
import { DEFAULT_STRATEGY } from '../trading/engine'
import { BotGlyph } from './Brand'

const templates = [
  { name: 'Quick crossover', short: 3, long: 10, description: 'Short moving averages. More responsive to recent price changes.' },
  { name: 'BTC trend', short: 5, long: 20, description: 'A simple starting point. Compare two moving averages.' },
  { name: 'Slow crossover', short: 10, long: 30, description: 'Longer moving averages. Smooth out more short-term movement.' },
] as const

export function StarterBots({ onChoose }: { onChoose: (pkg: StrategyPackage) => void }) {
  const titleId = useId()
  const lock = useRef(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  return <section className="starter-section" aria-labelledby={titleId}>
    <div className="panel-topline"><div><h2 className="panel-title" id={titleId}>Start with a simple bot</h2><p className="panel-subtitle">Free templates. Run a backtest to see their results.</p></div><span className="quiet-label">BTC / USDT</span></div>
    <div className="starter-grid">{templates.map((bot, index) => <article className="starter-card" key={bot.name}>
      <div className="starter-card-top"><BotGlyph variant={index} /><span className="template-tag">Template</span></div>
      <h3>{bot.name}</h3><p>{bot.description}</p>
      <div className="starter-card-bottom"><span>SMA <b>{bot.short} / {bot.long}</b></span><button disabled={busy !== null} onClick={() => {
        if (lock.current) return
        lock.current = true; setBusy(index); setError('')
        void createStrategyPackage({ name: bot.name, version: '1.0.0', config: { ...DEFAULT_STRATEGY, shortPeriod: bot.short, longPeriod: bot.long } })
          .then(onChoose).catch(e => setError(e instanceof Error ? e.message : 'Could not open this template.'))
          .finally(() => { lock.current = false; setBusy(null) })
      }}>{busy === index ? 'Opening…' : 'Backtest'}<ArrowUpRight size={15} /></button></div>
    </article>)}</div>
    {error && <p className="notice notice-amber mt-3" role="alert">{error}</p>}
  </section>
}
