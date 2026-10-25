/**
 * Arc TradeLab — main application shell.
 *
 * PAPER MODE (no wallet):
 *   Trading is available immediately with a 100 USDC virtual simulation budget.
 *   No wallet connection, no deposit, no onchain activity.
 *   Label: "Sim Cash" — simulated virtual cash, not a real asset.
 *
 * Connecting a wallet does not fund the paper simulation. The separate Test on
 * Arc panel uses a bounded testnet vault. License payments require a verified deployment.
 *
 * ALL BTC positions are paper trades — no real BTC is ever bought or sold.
 * This app runs only while the browser tab is open. There is no background worker.
 */

import { useEffect, useCallback, useState } from 'react'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { Activity, ArrowUpRight, BookOpen, FlaskConical, Layers3, LayoutDashboard, ShieldCheck, Store } from 'lucide-react'
import { Brand } from './components/Brand'
import { useBtcPrice } from './hooks/useBtcPrice'
import { useTradingState } from './hooks/useTradingState'
import { Header } from './components/Header'
import { PriceChart } from './components/PriceChart'
import { PortfolioStats } from './components/PortfolioStats'
import { StrategyControls } from './components/StrategyControls'
import { TradeHistory } from './components/TradeHistory'
import { BacktestPanel } from './components/BacktestPanel'
import { StrategyPackagePanel } from './components/StrategyPackagePanel'
import type { StrategyPackage } from './marketplace/strategyPackage'
import { packageToConfig } from './marketplace/strategyPackage'
import { MarketplacePanel } from './components/MarketplacePanel'
import { ForwardEvidencePanel } from './components/ForwardEvidencePanel'
import { TestnetBotPanel } from './components/TestnetBotPanel'
import { OverviewPanel } from './components/OverviewPanel'
import { ProjectPanel } from './components/ProjectPanel'
import type { BacktestReady } from './components/BacktestPanel'

const ARC_CHAIN_ID = 5042002

type AppView = 'overview' | 'lab' | 'marketplace' | 'evidence' | 'project'

function initialView(): AppView {
  const params = new URLSearchParams(window.location.search)
  if (params.has('market')) return 'marketplace'
  if (params.has('experiment')) return 'lab'
  if (params.has('project')) return 'project'
  return 'overview'
}

function initialLabView() {
  return new URLSearchParams(window.location.search).has('experiment') ? 'testnet' : 'live'
}

export default function App() {
  const [reportPackage, setReportPackage] = useState<StrategyPackage | null>(null)
  const [publicationDraft, setPublicationDraft] = useState<BacktestReady | null>(null)
  // pendingDataset carries a pre-fetched dataset string from OverviewPanel into BacktestPanel.
  const [pendingDataset, setPendingDataset] = useState<{ pkg: StrategyPackage; text: string } | null>(null)
  const [view, setView] = useState<AppView>(initialView)
  const [labView, setLabView] = useState<'live' | 'backtest' | 'versions' | 'testnet'>(initialLabView)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { isConnected, chainId } = useAccount()
  const isWrongChain = isConnected && chainId !== ARC_CHAIN_ID

  // 1. Live BTC/USDT price (Binance public API)
  const btcState = useBtcPrice()

  // 2. Trading state — wallet address optional (undefined = paper mode)
  // Wallet connection never changes the paper portfolio or enables legacy self-transfers.
  const trading = useTradingState(btcState.price, btcState.history, undefined, btcState)
  const { state, unrealizedPnl, portfolioValue, freeUsdc, isPaperMode,
    closedCandleCount, warmupRequired, buyAndHoldReturn } = trading

  const strategyStatus = state.strategyStatus

  // Pause strategy when price is stale
  useEffect(() => {
    if (btcState.isStale && strategyStatus === 'running') {
      trading.pauseStrategy()
      toast.warning('Strategy paused: price data is stale')
    }
  }, [btcState.isStale, strategyStatus, trading])

  // ---- Trade guards ----
  // Paper mode: only need a live, non-stale price.
  // Wallet mode: also need connected + correct chain.
  // ---- Manual trade handlers ----
  const handleManualBuy = useCallback(() => {
    if (!btcState.price) { toast.error('Waiting for live price data.'); return }
    if (btcState.isStale) { toast.error('Cannot trade with stale price data.'); return }
    if (!isPaperMode && !isConnected) { toast.error('Connect wallet to trade with testnet USDC.'); return }
    if (!isPaperMode && isWrongChain) { toast.error('Switch to Arc Testnet to trade.'); return }
    if (freeUsdc < 0.01) { toast.error('Insufficient balance. Add USDC or reset experiment.'); return }
    const t = trading.executeTrade('buy', 'manual')
    if (!t) { toast.error('Order blocked: max allocation reached or duplicate.'); return }
    toast.success(`Paper Buy: ${t.btcAmount.toFixed(6)} BTC @ $${t.execPrice.toLocaleString()} USDT`)
  }, [btcState.price, btcState.isStale, isPaperMode, isConnected, isWrongChain, freeUsdc, trading])

  const handleManualSell = useCallback(() => {
    if (!btcState.price) { toast.error('Waiting for live price data.'); return }
    if (btcState.isStale) { toast.error('Cannot trade with stale price data.'); return }
    if (!isPaperMode && !isConnected) { toast.error('Connect wallet to trade with testnet USDC.'); return }
    if (!isPaperMode && isWrongChain) { toast.error('Switch to Arc Testnet to trade.'); return }
    if (state.position.btcAmount <= 0) { toast.error('No open BTC position to sell.'); return }
    const t = trading.executeTrade('sell', 'manual')
    if (!t) { toast.error('Order blocked.'); return }
    const pnl = t.realizedPnl ?? 0
    toast.success(`Paper Sell: P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} sim USDC`)
  }, [btcState.price, btcState.isStale, isPaperMode, isConnected, isWrongChain, state.position.btcAmount, trading])

  const section: Record<AppView, string> = {
    overview: 'Overview',
    lab: 'Strategy lab',
    marketplace: 'Bot marketplace',
    evidence: 'Results & proof',
    project: 'Project & evidence',
  }
  const navigate = (next: AppView) => { setView(next); window.scrollTo({ top: 0, behavior: 'auto' }) }

  return <div className="app-shell">
    <a href="#workspace-main" className="sr-only focus:not-sr-only">Skip to workspace</a>
    <aside className="sidebar">
      <button className="brand-home" aria-label="TradeLab home" onClick={() => navigate('overview')}><Brand /></button>
      <nav aria-label="TradeLab sections">
        <button className="side-link" aria-current={view === 'overview' ? 'page' : undefined} onClick={() => navigate('overview')}><LayoutDashboard size={17} />Overview</button>
        <button className="side-link" aria-current={view === 'lab' ? 'page' : undefined} onClick={() => navigate('lab')}><FlaskConical size={17} />Test a bot</button>
        <button className="side-link" aria-current={view === 'evidence' ? 'page' : undefined} onClick={() => navigate('evidence')}><ShieldCheck size={17} />Results</button>
        <button className="side-link" aria-current={view === 'marketplace' ? 'page' : undefined} onClick={() => navigate('marketplace')}><Store size={17} />Bot market</button>
        <button className="side-link" aria-current={view === 'project' ? 'page' : undefined} onClick={() => navigate('project')}><ShieldCheck size={17} />Project</button>
      </nav>
      <Header btcState={btcState} section={section[view]} />
    </aside>
    <div className="workspace">
      <main className="workspace-content" id="workspace-main">

        {/* Overview — default landing, wallet-free */}
        <div hidden={view !== 'overview'}>
          <OverviewPanel
            onRunRealBacktest={(pkg, text) => {
              setReportPackage(pkg)
              setPendingDataset({ pkg, text })
              setLabView('backtest')
              navigate('lab')
            }}
            onGoMarketplace={() => navigate('marketplace')}
          />
        </div>

        {/* Lab */}
        <div hidden={view !== 'lab'}>
          <div className="lab-heading"><div><h1>{labView === 'live' ? 'Test your trading bot' : labView === 'backtest' ? 'See how your bot would perform' : labView === 'versions' ? 'Your bots, all in one place' : 'Run your bot on Arc'}</h1><p>{labView === 'live' ? 'Real BTC prices. A simulated portfolio.' : labView === 'backtest' ? 'Check the rules against historical BTC candles.' : labView === 'versions' ? 'Create a version. Test it. Make it yours.' : 'Live signals with real testnet transaction records.'}</p></div><a className="proof-shortcut" href="https://explorer.testnet.arc.io/address/0x36920c4ddaee26ec039a653ec78520c4b27a64e3" target="_blank" rel="noreferrer"><ShieldCheck size={16} /><span>See a completed test</span><ArrowUpRight size={14} /></a></div>
          <nav className="section-nav" aria-label="Strategy lab tools">
            <button aria-current={labView === 'live' ? 'page' : undefined} onClick={() => setLabView('live')}><Activity size={14} />Live test</button>
            <button aria-current={labView === 'backtest' ? 'page' : undefined} onClick={() => setLabView('backtest')}><BookOpen size={14} />Backtest</button>
            <button aria-current={labView === 'versions' ? 'page' : undefined} onClick={() => setLabView('versions')}><Layers3 size={14} />My bots{reportPackage && <span className="count-badge">Selected</span>}</button>
            <button aria-current={labView === 'testnet' ? 'page' : undefined} onClick={() => setLabView('testnet')}><ShieldCheck size={14} />Test on Arc</button>
          </nav>

          <div hidden={labView !== 'live'}>
            <div className="lab-grid">
              <div className="lab-chart-column">
                <PriceChart candles={btcState.chartCandles} price={btcState.price} trades={state.trades} updatedAt={btcState.candlesUpdatedAt} />
                <PortfolioStats state={state} unrealizedPnl={unrealizedPnl} portfolioValue={portfolioValue} freeUsdc={freeUsdc} currentPrice={btcState.price} buyAndHoldReturn={buyAndHoldReturn} />
                <TradeHistory trades={state.trades} onExport={trading.exportTrades} />
                <details className="panel panel-padding small-note"><summary>Portfolio breakdown & buy-and-hold comparison</summary><dl className="grid grid-cols-2 gap-4"><div><dt>Realized profit / loss</dt><dd className="text-sm font-semibold mt-1">{state.realizedPnl.toFixed(4)} sim USDC</dd></div><div><dt>Unrealized profit / loss</dt><dd className="text-sm font-semibold mt-1">{unrealizedPnl.toFixed(4)} sim USDC</dd></div><div><dt>Virtual BTC held</dt><dd className="text-sm font-semibold mt-1">{state.position.btcAmount.toFixed(8)} BTC</dd></div><div><dt>Buy & hold since experiment start</dt><dd className="text-sm font-semibold mt-1">{buyAndHoldReturn !== null && state.trades.length > 0 ? `${buyAndHoldReturn.toFixed(2)}%` : 'Awaiting experiment fills'}</dd></div></dl><p className="mt-4">USDT price quotes use a 1:1 sim USDC modeling assumption. Wallet balances remain separate from this simulated portfolio.</p></details>
              </div>
              <aside>
                <StrategyControls config={state.strategyConfig} status={strategyStatus} strategySnapshot={state.meta.strategySnapshot} freeUsdc={freeUsdc} hasPosition={state.position.btcAmount > 0} hasTrades={state.trades.length > 0} isStale={btcState.isStale || btcState.price === null} closedCandleCount={closedCandleCount} warmupRequired={warmupRequired} settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen(value => !value)} onStart={trading.startStrategy} onPause={trading.pauseStrategy} onStop={trading.stopStrategy} onUpdateConfig={trading.updateStrategyConfig} onManualBuy={handleManualBuy} onManualSell={handleManualSell} onSaveVersion={() => setLabView('versions')} onResetExperiment={() => {
                  if (confirm('Reset experiment? Virtual budget resets to 100 sim USDC and trade history clears. Export any records you want to keep first.')) trading.resetExperiment()
                }} onExportTrades={trading.exportTrades} />
                <button className="arc-test-shortcut" onClick={() => setLabView('testnet')}><span className="arc-test-icon"><ShieldCheck size={20} /></span><span><strong>Take your test onchain</strong><small>Run with Arc Testnet USDC</small></span><ArrowUpRight size={16} /></button>
              </aside>
            </div>
          </div>
          <div hidden={labView !== 'versions'}><StrategyPackagePanel config={state.strategyConfig} canApply={strategyStatus !== 'running' && state.position.btcAmount === 0 && state.trades.length === 0} selected={reportPackage} onSelect={setReportPackage} onApply={trading.updateStrategyConfig} onBacktest={() => setLabView('backtest')} /></div>
          <div hidden={labView !== 'backtest'}>
            <BacktestPanel
              strategyPackage={reportPackage}
              pendingDataset={pendingDataset?.pkg === reportPackage ? pendingDataset.text : undefined}
              onPendingDatasetConsumed={() => setPendingDataset(null)}
              onChooseVersion={() => setLabView('versions')}
              onPreparePublication={draft => { setPublicationDraft(draft); setView('marketplace') }}
            />
          </div>
          <div hidden={labView !== 'testnet'}><TestnetBotPanel strategy={reportPackage} feed={btcState} onChooseBot={() => setLabView('versions')} /></div>
        </div>

        {/* Marketplace */}
        <div hidden={view !== 'marketplace'} className="marketplace">
          <MarketplacePanel draft={publicationDraft} onBackToLab={() => { setView('lab'); setLabView('versions') }} onTryTemplate={pkg => { setReportPackage(pkg); setLabView('backtest'); navigate('lab') }} onImport={(pkg, target) => {
            if (target === 'paper' && !trading.updateStrategyConfig(packageToConfig(pkg))) return false
            setReportPackage(pkg); setLabView(target === 'testnet' ? 'testnet' : 'live'); navigate('lab'); return true
          }} />
        </div>

        {/* Results / forward evidence */}
        <div hidden={view !== 'evidence'}>
          <ForwardEvidencePanel state={state} onBackToLab={() => { setView('lab'); setLabView('live') }} market={{ provider: 'Binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT', source: btcState.source, price: btcState.price, lastUpdated: btcState.lastUpdated, lastMarketTime: btcState.lastMarketTime, isStale: btcState.isStale }} />
        </div>

        {/* Project & evidence */}
        <div hidden={view !== 'project'}>
          <ProjectPanel />
        </div>

      </main>
      <footer className="app-footer"><span>TradeLab</span><span>Simulated BTC trades · No exchange account needed</span></footer>
    </div>
  </div>
}
