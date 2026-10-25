import { useEffect, useRef, useState } from 'react'
import type { Hash } from 'viem'
import { readPurchaseProof } from '../marketplace/purchaseProof'
import type { PurchaseProof } from '../marketplace/purchaseProof'
import type { LicenseMarketDeployment } from '../marketplace/licenseMarket'
import { publicLink } from '../marketplace/publicLinks'
import { explorer } from '../onchain/contracts'

export function PurchaseProofPanel({ deployment, initialHash }: { deployment: LicenseMarketDeployment; initialHash?: Hash }) {
  const [hash, setHash] = useState(initialHash ?? '')
  const [proof, setProof] = useState<PurchaseProof | null>(null)
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  const revision = useRef(0)
  async function check(value: string) {
    const id = ++revision.current; setBusy(true); setMessage(''); setProof(null)
    try { const next = await readPurchaseProof(deployment, value as Hash); if (id === revision.current) setProof(next) }
    catch (e) { if (id === revision.current) setMessage(e instanceof Error ? e.message : 'Could not verify this purchase.') }
    finally { if (id === revision.current) setBusy(false) }
  }
  // Read only: opening shared proof never connects a wallet or requests a signature.
  useEffect(() => {
    const id = ++revision.current
    if (!initialHash) return
    let cancelled = false
    void readPurchaseProof(deployment, initialHash).then(next => { if (!cancelled && id === revision.current) { setHash(initialHash); setProof(next) } })
      .catch(e => { if (!cancelled && id === revision.current) setMessage(e instanceof Error ? e.message : 'Could not verify this purchase.') })
    return () => { cancelled = true }
  }, [initialHash, deployment])
  async function copyReceipt(value: PurchaseProof) {
    try {
      const url = publicLink(window.location.href, { chainId: value.chainId, market: value.market, listingId: BigInt(value.listingId), transaction: value.transactionHash })
      await navigator.clipboard.writeText(url)
      setMessage('Receipt link copied.')
    } catch { setMessage('Copy the explorer link instead. Public receipt links need the published app.') }
  }
  return <section className="panel panel-padding space-y-4">
    <div className="panel-topline"><div><h2 className="panel-title">Payment receipt</h2><p className="panel-subtitle">Check the payment, seller and delivered version. No wallet needed.</p></div><span className="pill">{deployment.chainId === 5042 ? 'Mainnet' : 'Testnet'}</span></div>
    <div className="flex gap-2 flex-wrap"><input className="form-input flex-1" aria-label="License purchase transaction hash" placeholder="Purchase transaction · 0x…" value={hash} onChange={e => { revision.current++; setBusy(false); setHash(e.target.value); setProof(null) }} /><button className="btn btn-soft" disabled={busy || !hash} onClick={() => void check(hash)}>{busy ? 'Checking Arc…' : 'Verify receipt'}</button></div>
    {proof && <div className="space-y-4"><div className="receipt-total"><span className="pill pill-green">Payment & license verified</span><strong>{proof.paidUSDC} <small>{proof.chainId === 5042 ? 'USDC' : 'test USDC'}</small></strong><span>One-time software license · Bot #{proof.listingId}</span></div><dl className="receipt-details"><dt>Buyer</dt><dd>{proof.buyer}</dd><dt>Seller received</dt><dd>{proof.seller}</dd><dt>Network fee (separate)</dt><dd>{proof.gasUSDC} {proof.chainId === 5042 ? 'USDC' : 'test USDC'}</dd><dt>Confirmed</dt><dd>{new Date(proof.timestamp * 1000).toLocaleString()} · Block {proof.blockNumber}</dd></dl>
      <div className="form-actions"><a className="btn btn-soft" href={`${explorer(proof.chainId)}/tx/${proof.transactionHash}`} target="_blank" rel="noreferrer">Open on Arc explorer ↗</a><button className="btn btn-soft" onClick={() => void copyReceipt(proof)}>Copy receipt link</button><button className="btn btn-quiet" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(proof, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'arctradelab-purchase-proof.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>Export proof</button></div><p className="small-note">A confirmed payment does not verify trading returns or establish that the buyer is an independent customer.</p></div>}
    {message && <p role="status" className="notice break-words">{message}</p>}
  </section>
}
