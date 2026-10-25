import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, FileCheck2, Settings2, ShieldCheck, Store } from 'lucide-react'
import { StarterBots } from './StarterBots'
import { useAccount, useSwitchChain } from 'wagmi'
import { formatUnits, parseUnits, getAddress } from 'viem'
import type { EIP1193Provider } from 'viem'
import { WalletButton } from './WalletButton'
import { preparePublication, importPublicationBundle, exportPublicationBundle } from '../marketplace/publication'
import type { PreparedPublication } from '../marketplace/publication'
import { downloadEvidence } from '../marketplace/evidenceDownload'
import { LICENSE_MARKET_DEPLOYMENTS, LICENSE_MARKET_ABI, registerVerifiedMarket, resolveMarketCandidate } from '../marketplace/licenseMarket'
import { ContractDeployment } from './ContractDeployment'
import { rpc, verifyContract, checkedWallet } from '../onchain/contracts'
import { publishEvidence } from '../marketplace/publishEvidence'
import { parsePublicSelection, publicLink } from '../marketplace/publicLinks'
import { PurchaseProofPanel } from './PurchaseProofPanel'
import { useLicenseMarket } from '../hooks/useLicenseMarket'
import type { StrategyPackage } from '../marketplace/strategyPackage'
import type { BacktestReady } from './BacktestPanel'

const button = { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontWeight: 600 }
const field = { background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--ink)', width: '100%' }
const box = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }
const digest = async (text: string): Promise<`0x${string}`> => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return `0x${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Evidence({ publication }: { publication: PreparedPublication }) {
  const s = publication.summary
  return <div className="space-y-4">
    <div><span className="text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Backtest recalculated</span><h3 className="display text-xl font-semibold mt-1">{s.name} <span style={{ color: 'var(--muted)' }}>v{s.version}</span></h3></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
      {[['Historical return', `${s.returnPct.toFixed(2)}%`], ['Max drawdown (closes)', `${s.maxDrawdownPct.toFixed(2)}%`], ['Buy & hold', `${s.buyAndHoldReturnPct.toFixed(2)}%`], ['Closed trades', String(s.completedTrades)]].map(([label, value]) => <div key={label} className="p-3 rounded-lg" style={{ background: 'var(--surface-muted)' }}><p className="text-xs" style={{ color: 'var(--muted)' }}>{label}</p><p className="mono text-lg mt-1">{value}</p></div>)}
    </div>
    <p className="text-sm" style={{ color: 'var(--muted)' }}>BTC/USDT · {s.evaluatedCandles.toLocaleString()} evaluated one-minute candles · {new Date(s.startedAt).toISOString()} — {new Date(s.endedAt).toISOString()} · starting cash {s.initialCash} USDT</p>
    <p className="text-sm" style={{ color: 'var(--muted)' }}>SMA {publication.strategy.config.shortPeriod}/{publication.strategy.config.longPeriod} · order {publication.strategy.config.orderSizeUsdc} · allocation cap {publication.strategy.config.maxAllocationPct}% · candle-close stop loss {publication.strategy.config.stopLossPct}%</p>
    <details className="text-xs"><summary>Test assumptions</summary><p className="text-sm" style={{ color: 'var(--muted)' }}>Modeled fee: {publication.strategy.assumptions.simFeeBps / 100}% per fill · adverse slippage: {publication.strategy.assumptions.simSlippageBps / 100}%. Signals and stops use candle closes; fills use the next open. Drawdown samples closes and excludes intrabar lows. Live experiments use a fresh observed quote after the signal.</p></details>
    <p className="text-xs" style={{ color: 'var(--warn)' }}>Historical simulation, not a forecast. Source prices and authorship are not authenticated.</p>
    <details className="text-xs"><summary>Committed files and execution assumptions</summary><div className="space-y-2 mt-3 break-all mono" style={{ color: 'var(--muted)' }}><p>Strategy file: {publication.strategySha256}</p><p>Report file: {publication.reportSha256}</p><p>Dataset file: {publication.datasetSha256}</p><p>License terms: {publication.termsSha256}</p></div><p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>{s.disclosure}</p></details>
    <details className="text-sm"><summary>Read the exact license terms</summary><pre className="whitespace-pre-wrap text-xs p-3 mt-2 rounded-lg" style={{ background: 'var(--surface-muted)' }}>{publication.termsText}</pre></details>
  </div>
}

export function MarketplacePanel({ draft, onBackToLab, onImport, onTryTemplate }: {
  draft: BacktestReady | null
  onBackToLab: () => void
  onImport: (strategy: StrategyPackage, target: 'paper' | 'testnet') => boolean
  onTryTemplate: (strategy: StrategyPackage) => void
}) {
  const [shared] = useState(() => { try { return { selection: parsePublicSelection(window.location.search), error: '' } } catch (e) { return { selection: null, error: e instanceof Error ? e.message : 'Invalid shared link.' } } })
  const [modeState, setModeState] = useState<{ draft: BacktestReady | null; value: 'publish' | 'inspect' }>({ draft, value: draft ? 'publish' : 'inspect' })
  const mode = modeState.draft === draft ? modeState.value : 'publish'
  const setMode = (value: 'publish' | 'inspect') => setModeState({ draft, value })
  const [terms, setTerms] = useState('')
  const [preparedState, setPreparedState] = useState<{ draft: BacktestReady; termsText: string; publication: PreparedPublication; bundle: string } | null>(null)
  const prepared = preparedState?.draft === draft && preparedState?.termsText === terms ? preparedState.publication : null
  const preparedBundle = prepared ? preparedState!.bundle : ''
  const [buyerEvidenceState, setBuyerEvidence] = useState<{ publication: PreparedPublication; binding: string | null; selection: string } | null>(null)
  const [deploymentKey, setDeploymentKey] = useState('')
  const [setupChain, setSetupChain] = useState<5042 | 5042002>(shared.selection?.chainId ?? 5042)
  const [setupOpen, setSetupOpen] = useState(false)
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const [linkMessage, setLinkMessage] = useState('')
  const [catalogState, setCatalog] = useState<{ key: string; rows: { id: bigint; price6: bigint; seller: string; paused: boolean; publication: PreparedPublication | null; error: string }[] } | null>(null)
  const [listingInput, setListingInput] = useState(shared.selection?.listingId?.toString() ?? '1')
  const [mainnetAcknowledged, setMainnetAcknowledged] = useState(false)
  const [termsApproval, setTermsApproval] = useState<{ key: string; accepted: boolean } | null>(null)
  const [price, setPrice] = useState('0.10')
  const [artifactURI, setArtifactURI] = useState('')
  const [reportURI, setReportURI] = useState('')
  const [error, setError] = useState(shared.error)
  const [busy, setBusy] = useState(false)
  const [checkingSeeded, setCheckingSeeded] = useState(false)
  const lock = useRef(false)
  const revision = useRef(0)
  const { address, chainId, isConnected, connector } = useAccount()
  const selectionKey = `${deploymentKey}:${listingInput}:${address ?? ''}:${chainId ?? ''}`
  const buyerEvidence = buyerEvidenceState?.selection === selectionKey ? buyerEvidenceState : null
  const { switchChain } = useSwitchChain()
  const market = useLicenseMarket(deploymentKey || undefined, { mainnetAcknowledged })
  const deployment = market.deployment
  const catalog = catalogState && catalogState.key === deployment?.key ? catalogState.rows : null
  const snapshot = market.snapshot
  const requestedListingId = /^[1-9]\d{0,30}$/.test(listingInput) ? BigInt(listingInput) : null
  const listing = snapshot?.listingId === requestedListingId ? snapshot?.listing : null
  const transacting = market.isPending
  const binding = deployment && listing && snapshot ? `${deployment.key}:${snapshot.listingId}:${listing.strategySha256}:${listing.reportSha256}:${listing.termsSha256}` : null
  const currentBinding = useRef(binding)
  useLayoutEffect(() => { currentBinding.current = binding }, [binding])
  const chainBound = !!binding && buyerEvidence?.binding === binding
  const acceptanceKey = `${selectionKey}:${binding ?? ''}:${buyerEvidence?.publication.termsSha256 ?? ''}`
  const termsAccepted = termsApproval?.key === acceptanceKey && termsApproval.accepted
  const setTermsAccepted = (accepted: boolean) => setTermsApproval({ key: acceptanceKey, accepted })
  const walletMatches = !!address && snapshot?.account?.toLowerCase() === address.toLowerCase() && chainId === deployment?.chainId
  const hasLicense = chainBound && walletMatches && snapshot?.hasLicense === true
  const ownListing = !!address && listing?.seller.toLowerCase() === address.toLowerCase()
  const canBuy = chainBound && walletMatches && termsAccepted && !listing?.salesPaused && !ownListing && !hasLicense && !busy && !transacting && (deployment?.chainId !== 5042 || mainnetAcknowledged)
  const marketError = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Marketplace request failed.')
  const readListing = () => {
    setError('')
    if (!/^[1-9]\d{0,30}$/.test(listingInput)) { setError('Enter a positive listing ID.'); return }
    void market.refresh(BigInt(listingInput)).catch(marketError)
  }
  useLayoutEffect(() => { revision.current++ }, [draft, terms, selectionKey, binding])

  useEffect(() => {
    let cancelled = false
    if (shared.error) return
    const initialChain = shared.selection?.chainId ?? 5042
    const candidate = resolveMarketCandidate(
      initialChain,
      shared.selection?.market as string | undefined,
      key => { try { return localStorage.getItem(key) } catch { return null } },
    )
    if (!candidate) return
    // Show a checking indicator only when falling back to a seeded address (no shared URL and no
    // localStorage entry) so fresh visitors know the marketplace is being verified, not just inactive.
    const isSeededFallback = !shared.selection?.market && !(() => { try { return localStorage.getItem(`tradelab_market_candidate_${initialChain}`) } catch { return null } })()
    if (isSeededFallback) setCheckingSeeded(true)
    void Promise.resolve()
      .then(() => registerVerifiedMarket(initialChain, getAddress(candidate)))
      .then(item => { if (!cancelled) { setDeploymentKey(item.key); setCheckingSeeded(false) } })
      .catch(e => { if (!cancelled) { setCheckingSeeded(false); marketError(e) } })
    return () => { cancelled = true }
  }, [shared]) // One read-only initial candidate resolution; never opens a wallet.
  const autoRead = useRef('')
  useEffect(() => {
    if (!deployment || !shared.selection?.listingId || !requestedListingId) return
    const key = `${selectionKey}:${requestedListingId}`
    if (autoRead.current === key) return
    autoRead.current = key
    void market.refresh(requestedListingId).catch(marketError)
  }, [deployment, shared, selectionKey, market, requestedListingId]) // Guard above avoids repeated reads on render.

  const shareListing = async (id: bigint) => {
    if (!deployment) return
    try { await navigator.clipboard.writeText(publicLink(window.location.href, { chainId: deployment.chainId, market: deployment.address, listingId: id })); setLinkMessage(['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'Local link copied. Use the published app for a link others can open.' : 'Bot link copied. Anyone can inspect it without connecting a wallet.') }
    catch (e) { setLinkMessage(e instanceof Error ? e.message : 'Could not copy this link.') }
  }

  const prepare = async () => {
    if (!draft || lock.current) return
    lock.current = true; setBusy(true); setError('')
    const current = revision.current
    try {
      const result = await preparePublication({ ...draft, termsText: terms })
      const bundleText = exportPublicationBundle(result)
      if (revision.current === current) setPreparedState({ draft, termsText: terms, publication: result, bundle: bundleText })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not verify this publication.') }
    finally { lock.current = false; setBusy(false) }
  }
  const inspectEvidence = async (readText: () => Promise<string>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setBuyerEvidence(null); setTermsAccepted(false)
    const current = revision.current
    try {
      const text = await readText()
      let expected
      const reviewedBinding = binding
      if (listing) expected = { strategySha256: listing.strategySha256, reportSha256: listing.reportSha256, termsSha256: listing.termsSha256 }
      else {
        const data = JSON.parse(text) as Record<string, unknown>
        if (typeof data.strategyText !== 'string' || typeof data.reportText !== 'string' || typeof data.termsText !== 'string') throw new Error('This is not an Arc TradeLab evidence bundle.')
        expected = { strategySha256: await digest(data.strategyText), reportSha256: await digest(data.reportText), termsSha256: await digest(data.termsText) }
      }
      const publication = await importPublicationBundle(text, expected)
      if (revision.current === current && currentBinding.current === reviewedBinding) setBuyerEvidence({ publication, binding: reviewedBinding, selection: selectionKey })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not verify this bundle.') }
    finally { lock.current = false; setBusy(false) }
  }

  return <div className="space-y-5">
<section className="page-intro"><div><h1>Find your next trading bot</h1><p className="intro-description">Inspect the results. Buy the exact version.</p></div><button className="btn btn-quiet" aria-expanded={setupOpen} onClick={() => setSetupOpen(v => !v)}><Settings2 size={15} />Marketplace setup</button></section>
    {shared.selection && !deployment && !error && <p role="status" className="notice">Checking this marketplace against the reviewed contract…</p>}
    {checkingSeeded && !deployment && !error && <p role="status" className="notice">Verifying known marketplace on Arc mainnet…</p>}
    <details className="panel panel-padding market-setup" open={setupOpen} onToggle={e => setSetupOpen(e.currentTarget.open)} hidden={!setupOpen}><summary>{deployment ? 'Network & contract' : 'Activate the marketplace'}</summary><div className="space-y-3 mt-3">
      <label className="text-sm">Network <select aria-label="Marketplace setup network" value={setupChain} onChange={e => setSetupChain(Number(e.target.value) as 5042 | 5042002)}><option value={5042002}>Arc Testnet · rehearse first</option><option value={5042}>Arc mainnet · real USDC</option></select></label>
      <ContractDeployment key={setupChain} kind="StrategyLicenseMarket" chainId={setupChain} args={[BigInt(setupChain)]} onVerified={async address => {
        const item = await registerVerifiedMarket(setupChain, address); setDeploymentKey(item.key); setSetupOpen(false); market.reset()
        localStorage.setItem(`tradelab_market_candidate_${setupChain}`, address)
      }} />
      <button className="btn btn-soft" disabled={busy || transacting} onClick={() => {
        const address = localStorage.getItem(`tradelab_market_candidate_${setupChain}`)
        if (!address) { setError('No saved deployment on this network.'); return }
        setBusy(true); void registerVerifiedMarket(setupChain, getAddress(address)).then(item => { setDeploymentKey(item.key); market.reset() }).catch(marketError).finally(() => setBusy(false))
      }}>Verify saved deployment</button>
    </div></details>
    <nav className="section-nav" aria-label="Marketplace workflow">{(['inspect', 'publish'] as const).map(value => <button aria-current={mode === value ? 'page' : undefined} key={value} onClick={() => setMode(value)} >{value === 'publish' ? 'Sell a bot' : 'Explore bots'}</button>)}</nav>
    {deployment && <section className="notice market-network">
      {LICENSE_MARKET_DEPLOYMENTS.length > 0 && <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm flex-1">Network & reviewed market<select aria-label="Reviewed marketplace deployment" value={deploymentKey} disabled={transacting || busy} onChange={event => { setDeploymentKey(event.target.value); market.reset() }} style={{ ...field, marginTop: 6 }}><option value="">No deployed marketplace selected</option>{LICENSE_MARKET_DEPLOYMENTS.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label>
        {!isConnected && <WalletButton />}
        {deployment && chainId !== deployment.chainId && <button style={button} onClick={() => switchChain({ chainId: deployment.chainId })}>Switch to {deployment.label}</button>}
      </div>}
      {deployment?.chainId === 5042 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={mainnetAcknowledged} onChange={event => setMainnetAcknowledged(event.target.checked)} disabled={transacting} /><span>Arc mainnet uses real USDC. I will review the exact price, recipient, contract and wallet request before signing.</span></label>}
      {deployment && <p className="text-xs break-all mono" style={{ color: 'var(--muted)' }}>Chain {deployment.chainId} · market {deployment.address}</p>}
      {deployment && <><button className="btn btn-soft" disabled={busy || transacting} onClick={() => {
        const d = deployment; setBusy(true); setError('')
        void (async () => {
          await verifyContract('StrategyLicenseMarket', d.chainId, d.address)
          const client = rpc(d.chainId)
          const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
          const next = await client.readContract({ address: d.address, abi: [{ type: 'function', name: 'nextListingId', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }], functionName: 'nextListingId', blockNumber })
          const rows = []
          for (let id = next - 1n; id > 0n && rows.length < 3; id--) {
            const row = await client.readContract({ address: d.address, abi: LICENSE_MARKET_ABI, functionName: 'getListing', args: [id], blockNumber })
            let publication: PreparedPublication | null = null; let error = ''
            try { publication = await importPublicationBundle(await downloadEvidence(row.artifactURI), row) }
            catch { error = 'Evidence unavailable or does not match. Inspect before purchasing.' }
            rows.push({ id, price6: row.price6, seller: row.seller, paused: row.salesPaused, publication, error })
          }
          setCatalog({ key: d.key, rows })
        })().catch(marketError).finally(() => setBusy(false))
      }}>{busy ? 'Checking published bots…' : 'Browse latest bots'}</button></>}
    </section>}
    {mode === 'inspect' && !deployment && !buyerEvidence && <>
      <StarterBots onChoose={onTryTemplate} />
      <section className="market-opening"><div className="market-opening-icon"><Store size={24} /></div><div><h2>Be the first to publish a bot</h2><p>Paid listings open after marketplace deployment. Templates above are free to test.</p></div><button className="btn btn-soft" onClick={() => setMode('publish')}>Prepare a listing <ArrowRight size={15} /></button></section>
      <div className="market-inspect-link"><span>Already have a test report?</span><button onClick={() => setInspectionOpen(v => !v)} aria-expanded={inspectionOpen}>{inspectionOpen ? 'Close report inspector' : 'Inspect an evidence file'} <ArrowRight size={14} /></button></div>
    </>}
    {catalog && <section className="bot-catalog" aria-label="Latest verified bot listings">{catalog.length === 0 && <p className="notice">No bots listed yet. Backtest your saved bot to prepare the first listing.</p>}{catalog.map(row => <article className="strategy-card space-y-4" key={row.id.toString()}><div className="panel-topline"><span className="eyebrow">BTC · SMA STRATEGY</span><span className="pill">{row.paused ? 'Sales paused' : `#${row.id}`}</span></div><h3>{row.publication?.summary.name ?? `Bot #${row.id}`}</h3>{row.publication ? <><p>v{row.publication.summary.version} · SMA {row.publication.strategy.config.shortPeriod}/{row.publication.strategy.config.longPeriod}</p><dl className="catalog-metrics"><div><dt>Backtest return</dt><dd>{row.publication.summary.returnPct.toFixed(2)}%</dd></div><div><dt>Max drawdown</dt><dd>{row.publication.summary.maxDrawdownPct.toFixed(2)}%</dd></div></dl><p>{row.publication.summary.evaluatedCandles.toLocaleString()} one-minute bars · {row.publication.summary.completedTrades} closed trades<br />Historical simulation · not a forecast</p></> : <p>{row.error}</p>}<div className="panel-topline"><strong>{formatUnits(row.price6, 6)} {deployment?.chainId === 5042 ? 'USDC' : 'test USDC'}</strong><button className="btn btn-soft" disabled={busy || transacting} onClick={() => { setListingInput(row.id.toString()); setMode('inspect'); setBuyerEvidence(null); void market.refresh(row.id).catch(marketError) }}>See results →</button></div></article>)}</section>}

    {mode === 'publish' ? <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <section className="p-5 space-y-4 lg:col-span-2" style={box}>
        <h2 className="panel-title">Prepare your bot</h2>
        {draft ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{draft.strategy.name} · v{draft.strategy.version}<br />Backtest and original data attached.</p> : <div className="space-y-3"><p className="text-sm" style={{ color: 'var(--muted)' }}>Save a bot and run its backtest first.</p><button style={button} onClick={onBackToLab}>Choose a bot <ArrowRight size={12} className="inline ml-1" /></button></div>}
        {draft && <><label className="block text-sm">Your license terms<textarea aria-label="License terms for this strategy version" rows={7} maxLength={50_000} value={terms} onChange={event => setTerms(event.target.value)} disabled={busy || transacting} placeholder="Describe what this software-use license permits, its limits, support, and delivery. These exact terms will be committed with this version." style={{ ...field, marginTop: 6 }} /></label>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>The current package contains SMA settings. A software-use entitlement does not make public settings secret or prove authorship. Use terms you have the right to offer.</p>
        <button style={button} disabled={!draft || !terms.trim() || busy || transacting} onClick={() => { void prepare() }}>{busy ? 'Recomputing the report…' : 'Recompute & prepare files'}</button></>}
      </section>
      <section className="p-5 space-y-5 lg:col-span-3" style={box}>
        {prepared ? <><Evidence publication={prepared} /><div className="flex flex-wrap gap-2 text-sm"><button style={button} onClick={() => download('arctradelab-evidence-bundle.json', preparedBundle)}>Download evidence bundle</button><button style={button} onClick={() => download('arctradelab-report.json', prepared.reportText)}>Download report</button><button style={button} onClick={() => download('arctradelab-publication-manifest.json', prepared.manifestText)}>Download file manifest</button><button style={button} onClick={() => { setBuyerEvidence({ publication: prepared, binding: null, selection: selectionKey }); setMode('inspect') }}>Preview buyer view</button></div>
          <div className="space-y-3 pt-4" style={{ borderTop: '1px solid var(--border)' }}><h2 className="display text-lg font-semibold">Listing details</h2><p className="text-sm" style={{ color: 'var(--muted)' }}>Publish the exact bundle and report for buyers to verify. Publishing makes the settings, license terms and test data public.</p>
            <button className="btn btn-soft" disabled={busy || transacting || !address || !connector} onClick={() => {
              if (!address || !connector || (chainId !== 5042 && chainId !== 5042002)) { setError('Connect a wallet on Arc first.'); return }
              const current = revision.current; setBusy(true); setError('')
              void publishEvidence(preparedBundle, address, async message => {
                const w = await checkedWallet(await connector.getProvider() as EIP1193Provider, chainId, address)
                if (revision.current !== current) throw new Error('Publication changed. Review the files again.')
                return w.signMessage({ message })
              }).then(result => { if (revision.current === current) { setArtifactURI(result.artifactURI); setReportURI(result.reportURI) } }).catch(marketError).finally(() => setBusy(false))
            }}>Publish files · sign upload permission</button>
            <p className="small-note">Requires public hosting. Or enter your existing public HTTPS/IPFS file URLs below.</p>
            <label className="block text-sm">Evidence bundle URL<input aria-label="Published evidence bundle URL" type="text" style={field} value={artifactURI} onChange={event => setArtifactURI(event.target.value)} disabled={transacting} placeholder="https://… or ipfs://…" /></label>
            <label className="block text-sm">Report URL<input aria-label="Published report URL" type="text" style={field} value={reportURI} onChange={event => setReportURI(event.target.value)} disabled={transacting} placeholder="https://… or ipfs://…" /></label>
            <label className="block text-sm">One-time price (USDC)<input aria-label="Strategy license price USDC" style={field} value={price} onChange={event => setPrice(event.target.value)} disabled={transacting} inputMode="decimal" /></label>
            <p className="text-xs break-all" style={{ color: 'var(--muted)' }}>Seller / payment recipient: {address ?? 'Connect your wallet'} · the version, price and terms become immutable in the contract.</p>
            <button style={button} disabled={!deployment || !isConnected || chainId !== deployment.chainId || transacting || busy || (deployment.chainId === 5042 && !mainnetAcknowledged)} onClick={() => {
              setError('')
              try {
                if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(price)) throw new Error('Use a positive USDC amount with at most six decimal places.')
                const price6 = parseUnits(price, 6)
                void market.createListing({ strategySha256: prepared.strategySha256, reportSha256: prepared.reportSha256, termsSha256: prepared.termsSha256, price6, artifactURI, reportURI }).catch(marketError)
              } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid listing.') }
            }}>Review listing in wallet</button>
          </div></> : <div className="empty-state"><div className="empty-icon"><FileCheck2 size={22} /></div><h3>Your bot’s sale preview</h3><p>Add license terms to review the bot,<br />its results and files together.</p></div>}
      </section>
    </div> : <div className="grid grid-cols-1 lg:grid-cols-5 gap-5" hidden={!deployment && !buyerEvidence && !inspectionOpen}>
      <section className="p-5 space-y-4 lg:col-span-2" style={box}>
        <h2 className="display text-lg font-semibold">Find a bot</h2>
        <label className="block text-sm">Listing ID<input aria-label="Marketplace listing ID" style={field} value={listingInput} onChange={event => setListingInput(event.target.value)} disabled={transacting || busy} inputMode="numeric" /></label>
        <button style={button} disabled={!deployment || transacting || busy} onClick={readListing}>Read listing from Arc</button>
        {listing && <div className="space-y-2 text-sm"><p>Price: <strong>{formatUnits(listing.price6, 6)} {deployment?.chainId === 5042002 ? 'test USDC' : 'USDC'}</strong></p><p className="break-all">Seller: {listing.seller}</p><p>{listing.salesPaused ? 'New sales paused' : 'Open for new purchases'}</p><button className="btn btn-soft" onClick={() => { if (requestedListingId) void shareListing(requestedListingId) }}>Share this bot</button><details><summary>Published files</summary><p className="text-xs break-all" style={{ color: 'var(--muted)' }}>Bundle: {listing.artifactURI}<br />Report: {listing.reportURI}</p></details></div>}
        <button style={button} disabled={!listing || busy || transacting} onClick={() => { if (listing) void inspectEvidence(() => downloadEvidence(listing.artifactURI)) }}>Load & verify evidence</button>
        <label className="block text-sm" style={button}>Import evidence bundle<input aria-label="Import marketplace evidence bundle" className="block text-xs mt-2" type="file" accept=".json,application/json" disabled={busy || transacting} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectEvidence(async () => { if (file.size > 20 * 1024 * 1024) throw new Error('Use a bundle smaller than 20 MB.'); return file.text() }) }} /></label>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Files are treated as data. No imported bot code or remote scripts execute.</p>
      </section>
      <section className="p-5 space-y-5 lg:col-span-3" style={box}>{buyerEvidence ? <><p className="text-xs font-semibold" style={{ color: chainBound ? 'var(--success)' : 'var(--warn)' }}>{chainBound ? 'Files match this listing’s onchain commitments' : 'Local evidence preview · no verified onchain listing'}</p><Evidence publication={buyerEvidence.publication} />
        <div className="space-y-3 pt-4" style={{ borderTop: '1px solid var(--border)' }}><h2 className="display text-lg font-semibold">Purchase license</h2>
          {listing && <p className="text-sm break-all">Pay {formatUnits(listing.price6, 6)} {deployment?.chainId === 5042002 ? 'test USDC' : 'USDC'} once to {listing.seller}. The contract transfers the payment directly; network gas is separate.</p>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={!chainBound || transacting} checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} /><span>I have read the exact license terms and reviewed the price, seller and strategy version. Historical results are simulations.</span></label>
          <div className="flex flex-wrap gap-2 text-sm"><button style={button} disabled={!canBuy || !listing || (snapshot?.allowance6 ?? 0n) >= listing.price6} onClick={() => { if (listing && snapshot?.listingId != null) { const id = snapshot.listingId; void market.approveExact(listing.price6).then(() => market.refresh(id)).catch(marketError) } }}>Approve exact USDC price</button><button style={button} disabled={!canBuy || !listing || (snapshot?.allowance6 ?? 0n) < listing.price6 || (snapshot?.balance6 ?? 0n) < listing.price6} onClick={() => { if (listing && snapshot?.listingId != null) void market.buyLicense(snapshot.listingId, listing.price6, listing.strategySha256).catch(marketError) }}>Review purchase in wallet</button></div>
          {ownListing && <p className="notice">You are the seller. Use a different buyer wallet to purchase this license.</p>}
          {hasLicense && <div className="space-y-3"><p style={{ color: 'var(--success)' }}>You own a license to this version.</p><div className="form-actions">{(['testnet', 'paper'] as const).map(target => <button key={target} className={target === 'testnet' ? 'btn btn-primary' : 'btn btn-soft'} disabled={busy || transacting} onClick={() => {
            const current = revision.current; setBusy(true)
            void market.refresh(snapshot!.listingId!).then(fresh => {
              if (revision.current !== current || !fresh.hasLicense) throw new Error('Wallet or listing changed. Verify your license again.')
              if (!onImport(buyerEvidence.publication.strategy, target)) throw new Error('Export and reset the current paper experiment before loading different rules.')
            }).catch(marketError).finally(() => setBusy(false))
          }}>{target === 'testnet' ? 'Test purchased bot on Arc' : 'Load into paper lab'}</button>)}<button className="btn btn-quiet" onClick={() => download('arctradelab-licensed-bot-evidence.json', exportPublicationBundle(buyerEvidence.publication))}>Download bot & evidence</button></div></div>}
        </div></> : <div className="empty-state"><div className="empty-icon"><ShieldCheck size={23} /></div><h3>Select a bot to see its results</h3><p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>Enter its listing ID, then load its evidence.</p></div>}</section>
    </div>}
    {(error || market.error) && <p role="alert" className="p-4 rounded-lg" style={{ color: 'var(--danger)', background: 'var(--surface)' }}>{error || market.error}</p>}
    {linkMessage && <p role="status" className="notice">{linkMessage}</p>}
    {transacting && <p role="status" style={{ color: 'var(--warn)' }}>{market.action}: {market.status}. Review your wallet; no entitlement is shown until confirmation is checked.</p>}
    {market.txHash && deployment && <p className="text-sm break-all">Transaction: <a style={{ color: 'var(--accent)' }} target="_blank" rel="noreferrer" href={`${deployment.chainId === 5042 ? 'https://explorer.arc.io' : 'https://explorer.testnet.arc.io'}/tx/${market.txHash}`}>{market.txHash}</a></p>}
    {market.createdListingId != null && <div className="notice"><p role="status">Listed on Arc · ID {market.createdListingId.toString()}</p><button className="btn btn-soft mt-2" onClick={() => { setListingInput(market.createdListingId!.toString()); setMode('inspect'); void market.refresh(market.createdListingId!).catch(marketError) }}>View this listing</button><button className="btn btn-soft mt-2" onClick={() => void shareListing(market.createdListingId!)}>Copy buyer link</button></div>}
    {deployment && <PurchaseProofPanel key={`${deployment.key}:${market.action === 'buy' && market.status === 'confirmed' && market.txHash ? market.txHash : shared.selection?.transaction ?? ''}`} deployment={deployment} initialHash={market.action === 'buy' && market.status === 'confirmed' && market.txHash ? market.txHash : shared.selection?.transaction} />}
  </div>
}
