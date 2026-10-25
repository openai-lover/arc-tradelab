import { useEffect, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useReadContract, useSwitchChain } from 'wagmi'
import type { Connector } from 'wagmi'
import { erc20Abi, formatUnits } from 'viem'
import { USDC } from '../onchain/contracts'

/** Detect providers without requesting accounts. Only an explicit user click connects. */
export function WalletButton() {
  const account = useAccount()
  const { connectors, connectAsync, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const [available, setAvailable] = useState<Connector[]>([])
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const balance = useReadContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: account.address ? [account.address] : undefined, chainId: account.chainId === 5042 ? 5042 : 5042002, query: { enabled: open && !!account.address && (account.chainId === 5042 || account.chainId === 5042002), refetchInterval: 15000 } })
  useEffect(() => {
    if (!open || account.isConnected) return
    let alive = true
    void Promise.all(connectors.map(async c => ({ connector: c, provider: await c.getProvider().catch(() => undefined) }))).then(results => {
      if (!alive) return
      const installed = results.filter(r => r.provider)
      const unique = installed.filter((r, i) => installed.findIndex(other => other.provider === r.provider) === i)
      setAvailable(unique.map(r => r.connector)); setChecking(false)
    })
    return () => { alive = false }
  }, [open, connectors, account.isConnected])
  return <>
    <button className="btn btn-wallet" onClick={() => { setOpen(true); setChecking(true); setError('') }}>{account.address ? `${account.address.slice(0, 6)}…${account.address.slice(-4)}` : 'Connect wallet'}</button>
    {open && <div className="wallet-overlay" onClick={() => { if (!isPending) setOpen(false) }}><section role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title" className="wallet-dialog space-y-4" onClick={e => e.stopPropagation()}>
      <div className="flex justify-between gap-4"><h2 id="wallet-dialog-title" className="panel-title">{account.isConnected ? 'Your wallet' : 'Connect MetaMask'}</h2><button aria-label="Close wallet dialog" disabled={isPending} onClick={() => setOpen(false)}>✕</button></div>
      {account.isConnected ? <><p className="text-sm break-all">{account.address}</p><p className="small-note">{account.connector?.name} · {account.chain?.name ?? `Chain ${account.chainId}`}</p>
        {balance.data !== undefined && <p className="wallet-funds">{formatUnits(balance.data, 6)} <span>{account.chainId === 5042 ? 'USDC' : 'test USDC'}</span></p>}
        {balance.isError && <p className="small-note">Balance unavailable. Check your wallet.</p>}
        <div className="network-options">{([5042, 5042002] as const).map(id => <button key={id} className={`network-option ${account.chainId === id ? 'selected' : ''}`} disabled={switching || account.chainId === id} onClick={() => { setError(''); void switchChainAsync({ chainId: id }).catch(e => setError(e instanceof Error ? e.message : 'Network change cancelled.')) }}><strong>{id === 5042 ? 'Arc mainnet' : 'Arc Testnet'}</strong><span>{id === 5042 ? 'Buy & sell bot licenses · real USDC' : 'Test bots · test tokens only'}</span></button>)}</div>
        <p className="small-note">Switching networks moves no funds. Balances on other networks stay separate.</p><button className="btn btn-soft" onClick={() => { disconnect(); setOpen(false) }}>Disconnect</button></> : <>
        {checking ? <p className="small-note">Looking for installed wallets…</p> : available.length ? <><p className="small-note">Choose your wallet, then approve the connection in its extension.</p>{available.map(c => <button key={c.uid} className="btn btn-primary w-full" disabled={isPending} onClick={() => {
          setError(''); void connectAsync({ connector: c }).then(() => setOpen(false)).catch(e => setError(e instanceof Error ? e.message : 'Connection cancelled.'))
        }}>{isPending ? 'Check your wallet…' : `Connect ${c.id === 'metaMask' ? 'MetaMask' : c.name}`}</button>)}</> : <div className="space-y-3"><p className="notice">MetaMask is not detected in this browser.</p><p className="text-sm">Open this address in Chrome or Edge where the MetaMask extension is installed. The in-app preview may not have access to browser extensions.</p><button className="btn btn-soft w-full" onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => setError('Address copied. Paste it into Chrome or Edge.')).catch(() => setError('Copy the page address from your browser.'))}>Copy app address</button><a className="btn btn-soft w-full" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get MetaMask from the official site ↗</a></div>}
        <p className="small-note">Connecting shares your public address. It does not move tokens or grant a spending allowance.</p>
      </>}
      {error && <p role="status" className="small-note break-words">{error}</p>}
    </section></div>}
  </>
}
