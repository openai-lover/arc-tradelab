import { useEffect, useRef, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { WalletButton } from './WalletButton'
import { createWalletClient, erc20Abi, formatUnits, getAddress, http, parseUnits } from 'viem'
import type { Address, EIP1193Provider, Hash } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { PrivateKeyAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { checkedWallet, explorer, readVault, rpc, USDC, VAULT_ABI } from '../onchain/contracts'
import type { VaultSnapshot } from '../onchain/contracts'
import { nextBotSignal } from '../onchain/botSignal'
import { startCandleBoundary } from '../trading/liveGuards'
import type { BtcPriceState } from '../hooks/useBtcPrice'
import type { StrategyPackage } from '../marketplace/strategyPackage'
import { ContractDeployment } from './ContractDeployment'
import { PriceChart } from './PriceChart'
import { BotGlyph } from './Brand'

const CHAIN = 5042002
const GAS_FUNDING = parseUnits('0.10', 18)
const storageKey = 'tradelab_testnet_vaults_v1'
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const message = (e: unknown) => e instanceof Error ? e.message : 'Network request failed'
const json = (v: unknown) => JSON.stringify(v, (_, x: unknown) => typeof x === 'bigint' ? x.toString() : x, 2)

export function TestnetBotPanel({ strategy, feed, onChooseBot }: {
  strategy: StrategyPackage | null; feed: BtcPriceState; onChooseBot: () => void
}) {
  const account = useAccount(); const { switchChain } = useSwitchChain()
  // Generated testnet-only signer, kept in memory. Never import a user's keys.
  const signer = useRef<PrivateKeyAccount | null>(null)
  const [sessionAddress, setSessionAddress] = useState<Address | null>(null)
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null)
  const [sharedExperiment] = useState(() => new URLSearchParams(window.location.search).get('experiment'))
  const [vaultInput, setVaultInput] = useState('')
  const [saved, setSaved] = useState<string[]>(() => {
    try { const a: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return Array.isArray(a) ? a.filter((v): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)).slice(-30) : [] } catch { return [] }
  })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false); const [ack, setAck] = useState(false)
  const [hash, setHash] = useState<Hash | null>(null)
  const [history, setHistory] = useState<{ sequence: string; side: string; amount: string; hash: Hash }[]>([])
  const lock = useRef(false); const runner = useRef(false); const boundary = useRef(0)
  const live = useRef({ feed, snapshot, account })
  useEffect(() => { live.current = { feed, snapshot, account } }, [feed, snapshot, account])
  const stop = () => { runner.current = false; setRunning(false) }
  const own = snapshot && same(snapshot.owner, account.address)
  const canWrite = !!own && account.chainId === CHAIN
  const readySession = !!snapshot && same(snapshot.session, sessionAddress)
  useEffect(() => {
    if (!sharedExperiment) return
    let cancelled = false
    void (async () => {
      const value = await readVault(getAddress(sharedExperiment))
      const events = []; const client = rpc(CHAIN)
      for (let fromBlock = value.creationBlock; fromBlock <= value.blockNumber; fromBlock += 5000n) {
        if (cancelled) return
        const toBlock = fromBlock + 4999n < value.blockNumber ? fromBlock + 4999n : value.blockNumber
        events.push(...await client.getContractEvents({ address: value.address, abi: VAULT_ABI, eventName: 'Fill', fromBlock, toBlock, strict: true }))
      }
      if (BigInt(events.length) !== value.state.sequence) throw new Error('Incomplete chain history. Retry before treating this as verified.')
      if (cancelled) return
      setSnapshot(value); setVaultInput(value.address)
      setHistory(events.map(e => ({ sequence: e.args.sequence.toString(), side: e.args.buy ? 'buy' : 'sell', amount: formatUnits(e.args.transfer6, 6), hash: e.transactionHash })))
      setStatus(`${events.length} fills verified from Arc. ${value.state.closed ? 'Experiment closed.' : 'Read-only snapshot; refresh for the latest state.'}`)
    })().catch(e => { if (!cancelled) setError(message(e)) })
    return () => { cancelled = true }
  }, [sharedExperiment]) // Public read only. Never restores or generates a session signer.
  function makeSession() {
    if (runner.current || lock.current) return
    signer.current = privateKeyToAccount(generatePrivateKey())
    setSessionAddress(signer.current.address)
  }
  async function action(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await work() } catch (e) { setError(message(e)) }
    finally { lock.current = false; setBusy(false) }
  }
  async function refresh(address: Address) {
    const value = await readVault(address); setSnapshot(value); return value
  }
  async function adopt(address: Address) {
    stop(); setHistory([]); const s = await refresh(address); setVaultInput(address)
    const next = [...saved.filter(a => !same(a, address)), address].slice(-30)
    setSaved(next); localStorage.setItem(storageKey, JSON.stringify(next))
    setStatus(s.state.closed ? 'Experiment closed. Records remain on Arc.' : s.state.funded ? 'Funded. Start when market data is ready.' : 'Approve and deposit the test budget.')
  }
  async function wallet() {
    if (!account.address || !account.connector) throw new Error('Connect your wallet first.')
    return checkedWallet(await account.connector.getProvider() as EIP1193Provider, CHAIN, account.address)
  }
  async function confirm(tx: Hash) {
    setHash(tx); setStatus('Transaction submitted. Waiting for Arc confirmation…')
    const r = await rpc(CHAIN).waitForTransactionReceipt({ hash: tx, timeout: 180000 })
    if (r.status !== 'success') throw new Error('Transaction reverted; no successful action is recorded.')
    return r
  }
  async function ownerCall(fn: 'fund' | 'close' | 'setSession') {
    if (!snapshot) throw new Error('Choose an experiment.')
    const fresh = await readVault(snapshot.address)
    if (!same(fresh.owner, account.address)) throw new Error('Only the experiment owner can do this.')
    const w = await wallet()
    if (fn === 'setSession') {
      if (!sessionAddress) throw new Error('Create a new session first.')
      const request = await rpc(CHAIN).simulateContract({ address: fresh.address, abi: VAULT_ABI, functionName: 'setSession', args: [sessionAddress], account: w.account })
      await wallet(); await confirm(await w.writeContract(request.request))
    } else {
      const request = await rpc(CHAIN).simulateContract({ address: fresh.address, abi: VAULT_ABI, functionName: fn, account: w.account })
      await wallet(); await confirm(await w.writeContract(request.request))
    }
    await refresh(fresh.address)
    setStatus(fn === 'close' ? 'Closed. Cash and reserve returned to the owner.' : 'Confirmed on Arc Testnet.')
  }
  useEffect(() => {
    const timer = setInterval(() => {
      if (!runner.current || lock.current) return
      const { feed: f, snapshot: s, account: a } = live.current
      if (!s || !signer.current || !same(s.owner, a.address) || a.chainId !== CHAIN || !same(s.session, signer.current.address)) {
        runner.current = false; setRunning(false); return
      }
      if (f.isStale || !f.price || !f.lastUpdated || Date.now() - f.lastUpdated > 10000 || document.visibilityState !== 'visible') {
        runner.current = false; setRunning(false); setStatus('Paused: return to this tab and check live data before restarting.'); return
      }
      if (Date.now() >= Number(s.expiresAt) * 1000 || s.state.sequence >= 200n) {
        runner.current = false; setRunning(false); setStatus('Session limit reached. Close the experiment to recover funds.'); return
      }
      const decision = nextBotSignal(s, f.closedCandles, boundary.current, Date.now())
      if (!decision) return
      if (f.lastUpdated < decision.candle + 60000) return
      boundary.current = decision.candle
      if (!decision.side) return
      const side = decision.side
      const session = signer.current
      void action(async () => {
        try {
          const fresh = await readVault(s.address)
          const latest = live.current.feed
          if (!runner.current || !same(fresh.session, session.address) || !same(live.current.account.address, fresh.owner)
              || live.current.account.chainId !== CHAIN || latest.isStale || !latest.price || !latest.lastUpdated
              || Date.now() - latest.lastUpdated > 10000 || latest.lastUpdated < decision.candle + 60000) throw new Error('Execution context changed. Restart after review.')
          const args = [decision.side === 'buy', parseUnits(latest.price.toFixed(6), 6), BigInt(decision.candle / 1000), BigInt(Math.floor(latest.lastUpdated / 1000)), fresh.state.sequence + 1n] as const
          const client = rpc(CHAIN)
          const request = await client.simulateContract({ address: fresh.address, abi: VAULT_ABI, functionName: 'execute', args, account: session })
          if (!runner.current || document.visibilityState !== 'visible' || !same(live.current.account.address, fresh.owner)) throw new Error('Stopped before submission.')
          const w = createWalletClient({ account: session, chain: arcTestnet, transport: http() })
          const receipt = await confirm(await w.writeContract(request.request))
          const next = await refresh(fresh.address)
          if (next.state.sequence !== args[4]) throw new Error('Unexpected chain sequence; refresh the experiment.')
          setHistory(h => [...h, { sequence: args[4].toString(), side, amount: formatUnits(next.state.cash6, 6), hash: receipt.transactionHash }])
          setStatus(`${decision.side === 'buy' ? 'Buy' : 'Sell'} confirmed on Arc. Waiting for the next SMA signal.`)
        } catch (e) { runner.current = false; setRunning(false); throw e }
      })
    }, 1000)
    return () => { clearInterval(timer); runner.current = false }
  }, [])
  const supported = strategy && strategy.config.orderSizeUsdc <= 100 && strategy.config.orderSizeUsdc >= 0.01
    && Number.isSafeInteger(strategy.config.orderSizeUsdc * 1e6)
    && Number.isInteger(strategy.config.maxAllocationPct * 100) && Number.isInteger(strategy.config.stopLossPct * 100)
  const rules = strategy && supported ? { strategyHash: `0x${strategy.digest.value.replace(/^0x/, '')}`,
    budget6: 100000000n, reserve6: 50000000n, order6: parseUnits(strategy.config.orderSizeUsdc.toFixed(6), 6),
    allocationBps: Math.round(strategy.config.maxAllocationPct * 100), shortPeriod: strategy.config.shortPeriod,
    longPeriod: strategy.config.longPeriod, stopLossBps: Math.round(strategy.config.stopLossPct * 100) } : null
  const deployArgs = rules && account.address && sessionAddress ? [account.address, sessionAddress, rules] : null
  return <div className="space-y-5">
    {!snapshot && <div className="testnet-setup-grid"><section className="panel panel-padding space-y-5">
      <div className="panel-topline"><span className="setup-step">1 · Bot & budget</span><span className="pill">Arc Testnet</span></div>
      <div className="testnet-bot-choice"><BotGlyph variant={1} /><div><h2 className="panel-title">{strategy ? strategy.name : 'Choose your bot'}</h2><p className="panel-subtitle">{strategy ? `v${strategy.version} · SMA ${strategy.config.shortPeriod} / ${strategy.config.longPeriod}` : 'Select a version to start a test.'}</p></div><button className="btn btn-quiet" onClick={onChooseBot}>{strategy ? 'Change' : 'Choose bot'}</button></div>
      <dl className="testnet-budget"><div><dt>Test budget</dt><dd>100 <span>test USDC</span></dd></div><div><dt>Test reserve</dt><dd>50 <span>test USDC</span></dd></div></dl>
      <p className="small-note">Only test tokens move. BTC buys and sells are simulated.</p>
      <label className="session-consent"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /><span>Allow automatic test orders for up to <strong>24 hours / 200 orders.</strong><small>The temporary signer cannot withdraw your experiment funds. Keep this tab open and visible.</small></span></label>
      {strategy && !supported && <p className="notice">This test requires an order between 0.01 and 100 USDC, at most 6 decimal places, and risk percentages with at most 2 decimal places. Save a compatible version first.</p>}
      <button className="btn btn-primary" disabled={!supported || !ack || !!sessionAddress} onClick={makeSession}>{sessionAddress ? 'Session ready' : 'Prepare test session'}</button>
      <details className="small-note"><summary>Session recovery & gas</summary><p>The key stays in this tab’s memory. Reloading loses it; your wallet can close the experiment and recover its test funds. Session gas is funded separately, up to 0.10 test USDC.</p></details>
    </section><div className="testnet-deploy-step"><p className="setup-step">2 · Connect & create</p><ContractDeployment kind="TestnetBotVault" chainId={CHAIN} args={ack ? deployArgs : null} onVerified={adopt} /><a className="testnet-faucet" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Get free test USDC from Circle ↗</a></div></div>}
    <details className="panel panel-padding"><summary>Open an existing experiment</summary><div className="flex flex-wrap gap-2 mt-3"><input aria-label="Testnet experiment address" className="form-input flex-1" value={vaultInput} onChange={e => setVaultInput(e.target.value)} placeholder="0x…" /><button className="btn btn-soft" disabled={busy || running} onClick={() => void action(() => adopt(getAddress(vaultInput.trim())))}>Verify & open</button></div>{saved.map(a => <button key={a} className="btn btn-soft mt-2 mr-2" disabled={busy || running} onClick={() => void action(() => adopt(getAddress(a)))}>{a.slice(0, 10)}…</button>)}</details>
    {snapshot && <section className="panel panel-padding space-y-4">
      <div className="flex justify-between flex-wrap gap-2"><h2 className="panel-title">{snapshot.state.closed ? 'Completed experiment' : running ? 'Bot running' : 'Your testnet experiment'}</h2><a className="small-note" href={`${explorer(CHAIN)}/address/${snapshot.address}`} target="_blank" rel="noreferrer">View contract ↗</a></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[['Cash', `${formatUnits(snapshot.state.cash6, 6)} test USDC`], ['Virtual BTC', formatUnits(snapshot.state.btc8, 8)], ['Realized P/L', `${formatUnits(snapshot.state.realized6, 6)} test USDC`], ['Confirmed orders', snapshot.state.sequence.toString()]].map(([label, v]) => <div key={label}><p className="small-note">{label}</p><strong>{v}</strong></div>)}</div>
      <p className="small-note">Reserve: {formatUnits(snapshot.reserve6, 6)} test USDC · expires {new Date(Number(snapshot.expiresAt) * 1000).toLocaleString()} · SMA {snapshot.rules.shortPeriod}/{snapshot.rules.longPeriod}</p>
      {!account.isConnected ? <WalletButton /> : account.chainId !== CHAIN ? <button className="btn btn-primary" onClick={() => switchChain({ chainId: CHAIN })}>Switch to Arc Testnet</button> : !own ? <p className="notice">Read only. Connect the experiment owner to operate it.</p> : null}
      {!snapshot.state.closed && <div className="flex flex-wrap gap-2">
        {!snapshot.state.funded && <><button className="btn btn-soft" disabled={!canWrite || busy} onClick={() => void action(async () => {
          const fresh = await readVault(snapshot.address); const w = await wallet(); const amount = fresh.rules.budget6 + fresh.rules.reserve6
          const request = await rpc(CHAIN).simulateContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [fresh.address, amount], account: w.account })
          await wallet(); await confirm(await w.writeContract(request.request)); setStatus(`Exact ${formatUnits(amount, 6)} test USDC allowance confirmed. Deposit the budget next.`)
        })}>1. Approve {formatUnits(snapshot.rules.budget6 + snapshot.rules.reserve6, 6)} test USDC</button><button className="btn btn-primary" disabled={!canWrite || busy} onClick={() => void action(() => ownerCall('fund'))}>2. Deposit test budget</button></>}
        {!readySession && <><button className="btn btn-soft" disabled={!canWrite || busy} onClick={makeSession}>New temporary session</button><button className="btn btn-soft" disabled={!canWrite || !sessionAddress || busy} onClick={() => void action(() => ownerCall('setSession'))}>Authorize replacement session</button></>}
        {readySession && <button className="btn btn-soft" disabled={!canWrite || busy || running} onClick={() => void action(async () => {
          const fresh = await readVault(snapshot.address); if (!same(fresh.session, sessionAddress)) throw new Error('Session changed.')
          const balance = await rpc(CHAIN).getBalance({ address: sessionAddress! })
          if (balance >= GAS_FUNDING) { setStatus('Session already has 0.10 test USDC for gas.'); return }
          const w = await wallet(); await confirm(await w.sendTransaction({ to: sessionAddress!, value: GAS_FUNDING - balance })); setStatus('Gas funded. Start the bot when ready.')
        })}>3. Fund session gas · up to 0.10 test USDC</button>}
        <button className="btn btn-primary" disabled={!canWrite || !readySession || !snapshot.state.funded || busy || running || feed.isStale} onClick={() => void action(async () => {
          const fresh = await refresh(snapshot.address)
          if (fresh.state.closed || Date.now() >= Number(fresh.expiresAt) * 1000 || !same(fresh.session, signer.current?.address)) throw new Error('Session is unavailable.')
          if (await rpc(CHAIN).getBalance({ address: fresh.session }) === 0n) throw new Error('Fund session gas first.')
          boundary.current = startCandleBoundary(Date.now(), Number(fresh.state.lastCandle) * 1000)
          runner.current = true; setRunning(true); setStatus('Watching new closed candles. No old signals will be replayed.')
        })}>4. Start bot</button>
        <button className="btn btn-soft" disabled={!running} onClick={() => { stop(); setStatus('Paused. A submitted transaction may still confirm. Funds stay recoverable.') }}>Pause</button>
        <button className="btn btn-soft" disabled={!canWrite || busy || running} onClick={() => void action(() => ownerCall('close'))}>Close & return all test funds</button>
      </div>}
      <div className="flex flex-wrap gap-2"><button className="btn btn-soft" disabled={busy || running} onClick={() => void action(async () => { await refresh(snapshot.address) })}>Refresh chain state</button><button className="btn btn-soft" disabled={busy || running} onClick={() => void action(async () => {
        const fresh = await readVault(snapshot.address); const client = rpc(CHAIN); const fills = []
        for (let fromBlock = fresh.creationBlock; fromBlock <= fresh.blockNumber; fromBlock += 5000n) {
          const toBlock = fromBlock + 4999n < fresh.blockNumber ? fromBlock + 4999n : fresh.blockNumber
          fills.push(...await client.getContractEvents({ address: fresh.address, abi: VAULT_ABI, eventName: 'Fill', fromBlock, toBlock, strict: true }))
        }
        if (BigInt(fills.length) !== fresh.state.sequence) throw new Error('Incomplete event history. Retry the RPC before exporting.')
        const output = { schema: 'arctradelab.testnet-run.v1', network: CHAIN, snapshot: fresh, fills,
          disclosure: 'Actual test-USDC transfers. BTC/USDT quotes and SMA signals are client attestations, not authenticated oracle prices. USDT/USDC modeled 1:1. 0.10% simulated fee and 0.05% adverse slippage; integer rounding differs from floating-point backtests. Closing returns cash plus reserve; it is not a real profit payout.' }
        const url = URL.createObjectURL(new Blob([json(output)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `arc-test-${fresh.address}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        setHistory(fills.map(f => ({ sequence: f.args.sequence.toString(), side: f.args.buy ? 'buy' : 'sell', amount: formatUnits(f.args.transfer6, 6), hash: f.transactionHash })))
        setStatus(`${fills.length} confirmed fills verified and exported.`)
      })}>Export verified chain results</button></div>
      {readySession && <button className="btn btn-soft" disabled={busy || running || !own} onClick={() => void action(async () => {
        if (!signer.current || !same(signer.current.address, snapshot.session)) throw new Error('Session unavailable in this tab.')
        const client = rpc(CHAIN); const fresh = await readVault(snapshot.address)
        if (!same(fresh.owner, account.address)) throw new Error('Owner changed.')
        const fees = await client.estimateFeesPerGas()
        const balance = await client.getBalance({ address: signer.current.address })
        const gas = (await client.estimateGas({ account: signer.current.address, to: fresh.owner, value: 0n })) * 12n / 10n
        const value = balance - gas * fees.maxFeePerGas
        if (value <= 0n) throw new Error('Session balance is too small to recover after gas.')
        const w = createWalletClient({ account: signer.current, chain: arcTestnet, transport: http() })
        await confirm(await w.sendTransaction({ to: fresh.owner, value, gas, ...fees })); setStatus('Unused session gas returned to the experiment owner.')
      })}>Return unused session gas</button>}
      <details className="small-note"><summary>Execution limits & recovery</summary><p className="mt-2">SMA rules and market prices are asserted by this browser, not validated by a price oracle. A compromised session can rearrange only this experiment’s own test balances. It cannot withdraw them. If reserve is insufficient the order fails and the bot pauses. Close returns both balances and marks any open BTC position abandoned. Refresh does not resume trading. The old session gas may be lost if the tab is closed.</p></details>
    </section>}
    {snapshot && <PriceChart candles={feed.chartCandles} price={feed.price} trades={[]} updatedAt={feed.candlesUpdatedAt} />}
    {status && <p role="status" className="notice">{status}</p>}{error && <p role="alert" className="notice">{error}</p>}
    {hash && <a className="small-note" href={`${explorer(CHAIN)}/tx/${hash}`} target="_blank" rel="noreferrer">Latest transaction ↗</a>}
    {history.length > 0 && <section className="panel panel-padding"><h3 className="panel-title">Confirmed on Arc</h3>{history.map(h => <div key={h.hash} className="flex justify-between mt-3 text-sm"><span>#{h.sequence} · {h.side}</span><a href={`${explorer(CHAIN)}/tx/${h.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a></div>)}</section>}
  </div>
}
