import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Download, Layers3, Save } from 'lucide-react'
import { createStrategyPackage, exportStrategyPackage, importStrategyPackage, packageToConfig } from '../marketplace/strategyPackage'
import type { StrategyPackage } from '../marketplace/strategyPackage'
import type { StrategyConfig } from '../trading/engine'
import { STRATEGY_VERSION } from '../trading/engine'
import { StarterBots } from './StarterBots'

const STORAGE_KEY = `arctradelab.strategy-library.v1.engine${STRATEGY_VERSION}`
const MAX_PACKAGES = 20

interface Props {
  config: StrategyConfig
  canApply: boolean
  selected: StrategyPackage | null
  onSelect: (pkg: StrategyPackage) => void
  onApply: (config: StrategyConfig) => boolean
  onBacktest: () => void
}

export function StrategyPackagePanel({ config, canApply, selected, onSelect, onApply, onBacktest }: Props) {
  const [library, setLibrary] = useState<StrategyPackage[]>([])
  const [name, setName] = useState('My BTC strategy')
  const [version, setVersion] = useState('1.0.0')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const lock = useRef(false)
  const storageFingerprint = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const entries: unknown = raw === null ? [] : JSON.parse(raw)
        if (!Array.isArray(entries) || entries.length > MAX_PACKAGES || entries.some(item => typeof item !== 'string')) {
          throw new Error('Stored library has an unsupported format.')
        }
        const verified = await Promise.all(entries.map(item => importStrategyPackage(item as string)))
        for (let i = 0; i < verified.length; i++) {
          if (verified.slice(0, i).some(pkg => pkg.digest.value === verified[i].digest.value
            || (pkg.name === verified[i].name && pkg.version === verified[i].version))) {
            throw new Error('Stored library contains duplicate or conflicting versions.')
          }
        }
        if (!cancelled) { storageFingerprint.current = raw; setLibrary(verified) }
      } catch (cause) {
        if (!cancelled) {
          setStorageBlocked(true)
          setError(`${cause instanceof Error ? cause.message : 'Cannot read local storage.'} Existing storage was preserved; saving is disabled.`)
        }
      } finally { if (!cancelled) setReady(true) }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const add = async (makePackage: () => Promise<StrategyPackage>, proceed = false) => {
    if (lock.current || !ready || storageBlocked) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const pkg = await makePackage()
      const duplicate = library.find(item => item.digest.value === pkg.digest.value)
      if (duplicate) {
        onSelect(duplicate); setMessage('Version selected.'); if (proceed) onBacktest(); return
      }
      if (library.some(item => item.name === pkg.name && item.version === pkg.version)) {
        throw new Error('This name and version already identifies different rules. Choose a new version number.')
      }
      if (library.length >= MAX_PACKAGES) throw new Error(`The local library supports ${MAX_PACKAGES} versions. Export your files before managing browser storage.`)
      const next = [...library, pkg]
      if (!navigator.locks) throw new Error('This browser cannot safely coordinate library saves across tabs. Use a browser with Web Locks support.')
      await navigator.locks.request(STORAGE_KEY, () => {
        if (localStorage.getItem(STORAGE_KEY) !== storageFingerprint.current) {
          throw new Error('The library changed in another tab. Reload this page before saving so its versions are preserved.')
        }
        const serialized = JSON.stringify(next.map(exportStrategyPackage))
        localStorage.setItem(STORAGE_KEY, serialized)
        storageFingerprint.current = serialized
      })
      setLibrary(next); onSelect(pkg); if (proceed) onBacktest()
      setMessage('Verified version saved locally and selected for backtesting. Lab rules change only when you choose Load into lab.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this version.')
    } finally { lock.current = false; setBusy(false) }
  }

  const download = (pkg: StrategyPackage) => {
    const url = URL.createObjectURL(new Blob([exportStrategyPackage(pkg)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `arctradelab-strategy-${pkg.version}-${pkg.digest.value.slice(0, 8)}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section aria-labelledby="versions-title">
    <StarterBots onChoose={pkg => { onSelect(pkg); onBacktest() }} />
    <div className="panel-topline"><div><h2 className="panel-title" id="versions-title">My bots</h2><p className="panel-subtitle">Save a version before testing or selling.</p></div><span className="pill">Stored in this browser</span></div>
    <div className="strategy-library-grid">
      <div className="panel panel-padding space-y-4">
        <p className="eyebrow">SAVE CURRENT LAB RULES</p>
        <div className="notice"><strong className="text-xs">Moving average · SMA {config.shortPeriod}/{config.longPeriod}</strong><p className="small-note mt-1">{config.orderSizeUsdc} sim USDC per order · {config.maxAllocationPct}% allocation · {config.stopLossPct}% close-based stop</p></div>
        <label className="field-label">Strategy name<input aria-label="Strategy version name" maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="field-label">Version number<input aria-label="Strategy release version" maxLength={48} value={version} onChange={event => setVersion(event.target.value)} /></label>
        <button className="btn btn-primary w-full" disabled={!ready || busy || storageBlocked} onClick={() => { void add(() => createStrategyPackage({ name, version, config }), true) }}><Save size={14} />{busy ? 'Verifying…' : 'Save & backtest'}</button>
        {selected && !library.some(pkg => pkg.digest.value === selected.digest.value) && <button className="btn btn-soft w-full" disabled={!ready || busy || storageBlocked} onClick={() => void add(() => importStrategyPackage(exportStrategyPackage(selected)))}>Save selected bot to My bots</button>}
        <details className="disclosure"><summary>Import a strategy file</summary><p className="small-note mb-3">Settings only; no uploaded bot code executes.</p><input aria-label="Import strategy package JSON" type="file" accept=".json,application/json" disabled={!ready || busy || storageBlocked} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (file) void add(async () => {
            if (file.size > 16_384) throw new Error('Strategy files must be no larger than 16 KB.')
            return importStrategyPackage(await file.text())
          })
        }} /></details>
        
      </div>
      <div className="space-y-4">
        {error && <p role="alert" className="notice notice-amber">{error}</p>}
        {message && <p role="status" className="notice">{message}</p>}
        {!canApply && <p className="notice notice-amber">The current live experiment has locked rules. Export its history and reset before loading a different version.</p>}
        {ready && library.length === 0 && !error && <div className="panel empty-state"><div className="empty-icon"><Layers3 size={21} /></div><h3>No saved bots yet</h3><p>Name your bot to run its first backtest.</p></div>}
        {library.map(pkg => <article key={pkg.digest.value} className={`strategy-card ${selected?.digest.value === pkg.digest.value ? 'is-selected' : ''}`}>
          <div className="panel-topline"><div><p className="eyebrow">SMA CROSSOVER · BTC/USDT</p><h3>{pkg.name} <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>v{pkg.version}</span></h3></div><span className={`pill ${selected?.digest.value === pkg.digest.value ? 'pill-green' : ''}`}>{selected?.digest.value === pkg.digest.value ? 'Selected for backtest' : 'Saved locally'}</span></div>
          <p>Fast / slow: {pkg.config.shortPeriod} / {pkg.config.longPeriod} · Order: {pkg.config.orderSizeUsdc} sim USDC<br />Allocation cap: {pkg.config.maxAllocationPct}% · Stop: {pkg.config.stopLossPct}% · 1-minute closed candles</p>
          <div className="form-actions mt-4"><button className="btn btn-soft" disabled={busy} onClick={() => { onSelect(pkg); onBacktest() }}>Backtest this version<ArrowRight size={12} /></button><button className="btn" disabled={busy || !canApply} onClick={() => {
            setError(''); setMessage('')
            if (onApply(packageToConfig(pkg))) { onSelect(pkg); setMessage(`Loaded ${pkg.name} v${pkg.version} into the lab. No strategy was started.`) }
            else setError('Rules could not be loaded. Stop and reset the experiment before changing its rules.')
          }}>Load into live lab</button><button className="btn btn-quiet" onClick={() => download(pkg)}><Download size={12} />Export</button></div>
          <details className="disclosure"><summary>Version fingerprint</summary><p className="mono break-all">{pkg.digest.value}</p><p className="mt-2">SHA-256 checks content consistency. It does not prove authorship, ownership or performance. This version has not been published.</p></details>
        </article>)}
      </div>
    </div>
  </section>
}
