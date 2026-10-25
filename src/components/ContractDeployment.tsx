import { useRef, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { WalletButton } from './WalletButton'
import { formatUnits, getAddress } from 'viem'
import type { Address, EIP1193Provider, Hash, Hex } from 'viem'
import { checkedWallet, deploymentData, explorer, rpc, verifyContract } from '../onchain/contracts'
import type { ContractKind, Network } from '../onchain/contracts'

export function ContractDeployment({ kind, chainId, args, onVerified }: {
  kind: ContractKind; chainId: Network; args: readonly unknown[] | null
  onVerified: (address: Address, hash?: Hash) => Promise<void> | void
}) {
  const account = useAccount(); const { switchChain } = useSwitchChain()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  // Load both address and tx hash from the persisted receipt so the explorer link
  // survives HMR, page refresh, and re-mount. Never trust the address without a
  // subsequent verifyContract call (done in the "Verify & use" path below).
  const [savedReceipt] = useState<{ address: string; hash: Hash } | null>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(`tradelab_deployment_receipt_${kind}_${chainId}`) ?? 'null')
      if (value && typeof value === 'object' && 'address' in value && 'hash' in value
          && typeof value.address === 'string' && typeof value.hash === 'string') {
        return { address: value.address, hash: value.hash as Hash }
      }
    } catch { /* ignore */ }
    return null
  })
  const [hash, setHash] = useState<Hash | null>(() => savedReceipt?.hash ?? null)
  const [candidate, setCandidate] = useState(() => savedReceipt?.address ?? '')
  // True only after this session has confirmed the saved receipt: tx success + contractAddress
  // matches saved address + runtime bytecode verified. Never set from localStorage alone.
  const [savedReceiptVerified, setSavedReceiptVerified] = useState(false)
  const [ack, setAck] = useState(false)
  const [review, setReview] = useState<{
    data: Hex; owner: Address; gas: bigint
    maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; expires: number
  } | null>(null)

  const data = args ? deploymentData(kind, chainId, args) : null
  const validReview = review && review.data === data && review.owner === account.address
  const isMainnet = chainId === 5042
  const connected = account.isConnected && account.chainId === chainId

  async function run(work: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'Deployment failed') }
    finally { setBusy(false); lock.current = false }
  }
  async function wallet() {
    if (!account.address || !account.connector) throw new Error('Connect your wallet first.')
    return checkedWallet(await account.connector.getProvider() as EIP1193Provider, chainId, account.address)
  }

  return (
    <section className="panel panel-padding space-y-3">
      <h3 className="panel-title">
        {kind === 'TestnetBotVault' ? 'Create testnet experiment' : 'Activate bot marketplace'}
      </h3>
      <p className="small-note">
        {isMainnet
          ? 'Arc mainnet · deployment uses real USDC gas. No payment is sent to a seller.'
          : 'Arc Testnet · deployment uses test USDC for gas.'}
      </p>

      {!account.isConnected ? (
        <WalletButton />
      ) : account.chainId !== chainId ? (
        <button className="btn btn-primary" onClick={() => switchChain({ chainId })}>
          Switch to {isMainnet ? 'Arc mainnet' : 'Arc Testnet'}
        </button>
      ) : (
        <>
          {/* Step 1 — Check fee (RPC only, no wallet prompt, no consent required) */}
          <button
            className="btn btn-soft"
            disabled={!data || busy || !connected}
            onClick={() => void run(async () => {
              if (!data || !account.address) return
              // Read-only RPC: no wallet prompt, no signing, no transaction.
              const client = rpc(chainId)
              if (await client.getChainId() !== chainId) throw new Error('RPC network mismatch')
              const gas = (await client.estimateGas({ account: account.address, data, value: 0n })) * 12n / 10n
              const fees = await client.estimateFeesPerGas()
              setReview({
                data, owner: account.address, gas,
                maxFeePerGas: fees.maxFeePerGas,
                maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
                expires: Date.now() + 120000,
              })
            })}
          >
            Check deployment fee
          </button>

          {/* Fee estimate — shown as soon as RPC returns, before consent */}
          {validReview && (
            <div className="notice space-y-2">
              <p>
                Maximum gas budget:{' '}
                <strong>
                  {formatUnits(review.gas * review.maxFeePerGas, 18)}{' '}
                  {isMainnet ? 'USDC' : 'test USDC'}
                </strong>
              </p>
              <p className="small-note break-all">Owner / signer: {review.owner}</p>
            </div>
          )}

          {/* Step 2 — Consent checkbox (mainnet only), required before Deploy */}
          {isMainnet && (
            <label className="flex gap-2 text-sm" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={ack}
                onChange={e => setAck(e.target.checked)}
              />
              I reviewed this custom contract. Mainnet gas costs real USDC; it has not had
              an independent security audit.
            </label>
          )}

          {/* Step 3 — Deploy (requires estimate + consent) */}
          {validReview && (
            <button
              className="btn btn-primary"
              disabled={busy || (isMainnet && !ack)}
              onClick={() => void run(async () => {
                if (!validReview || !data || review.expires <= Date.now())
                  throw new Error('Refresh the deployment review.')
                const w = await wallet(); const client = rpc(chainId)
                const tx = await w.sendTransaction({
                  data, value: 0n, gas: review.gas,
                  maxFeePerGas: review.maxFeePerGas,
                  maxPriorityFeePerGas: review.maxPriorityFeePerGas,
                })
                setHash(tx)
                const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 180000 })
                if (receipt.status !== 'success' || !receipt.contractAddress)
                  throw new Error('Deployment did not succeed.')
                setCandidate(receipt.contractAddress)
                localStorage.setItem(
                  `tradelab_deployment_receipt_${kind}_${chainId}`,
                  JSON.stringify({ address: receipt.contractAddress, hash: tx }),
                )
                await verifyContract(kind, chainId, receipt.contractAddress)
                setSavedReceiptVerified(true)
                await onVerified(receipt.contractAddress, tx); setReview(null)
              })}
            >
              Deploy · sign in wallet
            </button>
          )}
        </>
      )}

      <details open={!!savedReceipt && !savedReceiptVerified}>
        <summary className="small-note">
          {savedReceipt && !savedReceiptVerified
            ? 'Saved receipt found — verify to re-confirm'
            : 'Already deployed? Verify an address'}
        </summary>
        <div className="flex flex-wrap gap-2 mt-2">
          <input
            aria-label={`${kind} address`}
            className="form-input flex-1"
            value={candidate}
            onChange={e => { setCandidate(e.target.value); setSavedReceiptVerified(false) }}
            placeholder="0x…"
          />
          <button
            className="btn btn-soft"
            disabled={busy || !candidate}
            onClick={() => void run(async () => {
              const address = getAddress(candidate.trim())
              // If a saved receipt exists and its address matches, also verify the tx receipt
              // on chain before accepting: tx must be successful and contractAddress must match.
              if (savedReceipt && savedReceipt.address.toLowerCase() === address.toLowerCase()) {
                const client = rpc(chainId)
                const receipt = await client.getTransactionReceipt({ hash: savedReceipt.hash })
                if (!receipt || receipt.status !== 'success' || !receipt.contractAddress) {
                  throw new Error('Saved deployment transaction is not confirmed successful on this chain.')
                }
                if (receipt.contractAddress.toLowerCase() !== address.toLowerCase()) {
                  throw new Error('Saved transaction deployed a different address than the candidate. Clear and re-enter.')
                }
                await verifyContract(kind, chainId, address)
                setSavedReceiptVerified(true)
                await onVerified(address, savedReceipt.hash)
              } else {
                await verifyContract(kind, chainId, address)
                await onVerified(address)
              }
            })}
          >
            Verify &amp; use
          </button>
        </div>
        {savedReceipt && !savedReceiptVerified && (
          <p className="small-note mt-1" style={{ color: 'var(--warn)' }}>
            Loaded from saved receipt — unverified until you click Verify &amp; use above.
          </p>
        )}
      </details>

      {busy && <p role="status" className="small-note">Checking the network…</p>}
      {hash && (
        <p className="small-note">
          <a href={`${explorer(chainId)}/tx/${hash}`} target="_blank" rel="noreferrer">
            View deployment transaction ↗
          </a>
          {!savedReceiptVerified && savedReceipt?.hash === hash && !busy && (
            <span style={{ marginLeft: 8, color: 'var(--warn)' }}>(unverified — click Verify &amp; use to confirm)</span>
          )}
          {savedReceiptVerified && savedReceipt?.hash === hash && (
            <span style={{ marginLeft: 8, color: 'var(--cobalt)' }}>(verified this session)</span>
          )}
        </p>
      )}
      {error && <p role="alert" className="notice text-sm">{error}</p>}
    </section>
  )
}
