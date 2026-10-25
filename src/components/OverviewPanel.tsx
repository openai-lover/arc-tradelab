/**
 * OverviewPanel — first-visit landing.
 *
 * Layout: compact hero (~280px desktop), copy LEFT, glass-art image RIGHT.
 * Below: three actionable starter-strategy cards with strategy-objects art.
 *
 * Primary CTA: fetch real recent Binance candles and run the chosen starter.
 * No synthetic data on the primary path. Wallet-free throughout.
 * Simulation disclosure is one sentence, not a wall.
 */
import { useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Store } from 'lucide-react'
import { createStrategyPackage } from '../marketplace/strategyPackage'
import type { StrategyPackage } from '../marketplace/strategyPackage'
import { fetchRecentDataset } from '../trading/marketCandles'
import { BotGlyph } from './Brand'
import { DEFAULT_STRATEGY } from '../trading/engine'
import heroUrl from '../../public/brand/tradelab-hero.webp'
import objectsUrl from '../../public/brand/strategy-objects.webp'

const templates = [
  { name: 'Quick crossover', short: 3, long: 10, description: 'Reacts quickly to price changes. More signals, more noise.' },
  { name: 'BTC trend',       short: 5, long: 20, description: 'A simple starting point — two moving averages.' },
  { name: 'Slow crossover',  short: 10, long: 30, description: 'Smoother signals. Fewer trades, less whipsaw.' },
] as const

interface OverviewPanelProps {
  /** Called with (package, dataset-json-text) when user picks a starter and data loads. */
  onRunRealBacktest: (pkg: StrategyPackage, datasetText: string) => void
  onGoMarketplace: () => void
}

export function OverviewPanel({ onRunRealBacktest, onGoMarketplace }: OverviewPanelProps) {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const lock = useRef(false)

  async function pickAndRun(index: number) {
    if (lock.current) return
    lock.current = true; setBusy(index); setError('')
    try {
      const tpl = templates[index]
      // Create the package and fetch candles concurrently
      const [pkg, dataset] = await Promise.all([
        createStrategyPackage({
          name: tpl.name, version: '1.0.0',
          config: { ...DEFAULT_STRATEGY, shortPeriod: tpl.short, longPeriod: tpl.long },
        }),
        fetchRecentDataset(),
      ])
      onRunRealBacktest(pkg, JSON.stringify(dataset))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load market data. Check your connection and try again.')
    } finally {
      lock.current = false; setBusy(null)
    }
  }

  return (
    <div className="overview-shell">

      {/* ── Hero: copy LEFT, art RIGHT ─────────────────────────────── */}
      <header className="overview-hero">
        <div className="overview-hero-text">
          <p className="eyebrow"><span className="eyebrow-dot" />BTC / USDT · Arc Testnet &amp; Mainnet</p>
          <h1 className="overview-title">Test your bot.<br />Verify before you buy.</h1>
          <p className="overview-subtitle">
            Backtest a BTC strategy, reproduce its results, and license
            the exact version with USDC on Arc.
          </p>
          <p className="overview-sim-note">Historical backtests are simulated. No real BTC trades.</p>
          <div className="overview-ctas">
            <button className="btn btn-soft" onClick={onGoMarketplace}>
              <Store size={15} />Browse the marketplace<ArrowRight size={14} />
            </button>
          </div>
        </div>
        <div className="overview-hero-image" aria-hidden="true">
          <img
            src={heroUrl}
            alt=""
            width={480}
            height={280}
            loading="eager"
            decoding="sync"
          />
        </div>
      </header>

      {/* ── Starter strategy cards ────────────────────────────────── */}
      <section aria-labelledby="overview-starters-title">
        <div className="panel-topline" style={{ marginBottom: 16 }}>
          <div>
            <h2 className="panel-title" id="overview-starters-title">Pick a strategy and test it now</h2>
            <p className="panel-subtitle">Free templates. Runs real Binance data — about 16 hours of 1-minute candles.</p>
          </div>
          <span className="quiet-label">BTC / USDT</span>
        </div>
        {error && <p className="notice notice-amber mb-4" role="alert">{error}</p>}
        <div className="starter-grid">
          {templates.map((tpl, i) => (
            <article className="starter-card overview-starter-card" key={tpl.name}>
              <div className="starter-card-top">
                <BotGlyph variant={i} />
                <span className="template-tag">Free template</span>
              </div>
              <h3>{tpl.name}</h3>
              <p>{tpl.description}</p>
              <div className="starter-card-bottom">
                <span>SMA <b>{tpl.short} / {tpl.long}</b></span>
                <button
                  disabled={busy !== null}
                  onClick={() => { void pickAndRun(i) }}
                  className="btn btn-primary"
                  style={{ padding: '8px 14px', fontSize: 13 }}
                >
                  {busy === i ? 'Fetching data…' : 'Test with BTC data'}
                  {busy !== i && <ArrowUpRight size={14} />}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Strategy objects art ─────────────────────────────────── */}
      <div className="overview-objects-image" aria-hidden="true">
        <img
          src={objectsUrl}
          alt=""
          width={1200}
          height={340}
          loading="lazy"
          decoding="async"
        />
        <p className="overview-objects-caption">
          Strategy rules · Backtest report · License terms — each file SHA-256 committed onchain before purchase.
        </p>
      </div>

    </div>
  )
}
