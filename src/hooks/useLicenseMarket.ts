import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { createPublicClient, createWalletClient, custom, http } from 'viem'
import type { EIP1193Provider, Hash, PublicClient, TransactionReceipt } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import {
  ARC_USDC_ADDRESS, LICENSE_MARKET_ABI, TOKEN_READ_ABI,
  assertConfirmedLicenseApproval, assertConfirmedLicensePurchase, assertLicenseBuyable, assertLicenseHash,
  assertLicensePrice, assertListingId, assertWalletContext, createdLicenseListingId,
  readVerifiedLicenseMarket, requireLicenseDeployment, sameAddress, validateCreateListing,
} from '../marketplace/licenseMarket.ts'
import type {
  CreateLicenseListingInput, LicenseMarketDeployment, LicenseMarketSnapshot,
} from '../marketplace/licenseMarket.ts'

export type LicenseMarketStatus = 'idle' | 'reading' | 'ready' | 'simulating' | 'signing' | 'confirming' | 'confirmed' | 'error'
export type LicenseMarketAction = 'approve' | 'create' | 'buy' | null

interface HookState {
  contextKey: string
  status: LicenseMarketStatus
  action: LicenseMarketAction
  error: string | null
  txHash: Hash | null
  createdListingId: bigint | null
  snapshot: LicenseMarketSnapshot | null
}

const initialState: HookState = {
  contextKey: '', status: 'idle', action: null, error: null,
  txHash: null, createdListingId: null, snapshot: null,
}

/** All chain reads and wallet requests are explicit calls. No auto-switches or auto-writes. */
export function useLicenseMarket(
  deploymentKey?: string, options: { mainnetAcknowledged?: boolean } = {},
) {
  const account = useAccount()
  const [state, setState] = useState<HookState>(initialState)
  const inFlight = useRef(false)
  const current = useRef({ deploymentKey, account, mainnetAcknowledged: options.mainnetAcknowledged === true })
  // Synchronize only context identity after render; this effect cannot read chains or request a signature.
  useLayoutEffect(() => {
    current.current = { deploymentKey, account, mainnetAcknowledged: options.mainnetAcknowledged === true }
  }, [deploymentKey, account, options.mainnetAcknowledged])

  const contextKey = `${deploymentKey ?? ''}:${account.address?.toLowerCase() ?? ''}:${account.chainId ?? ''}:${account.connector?.uid ?? ''}`
  const deployment = useMemo<LicenseMarketDeployment | null>(() => {
    try { return requireLicenseDeployment(deploymentKey) } catch { return null }
  }, [deploymentKey])

  function capture(requireWallet: boolean) {
    const selected = requireLicenseDeployment(current.current.deploymentKey)
    const connected = current.current.account
    if (requireWallet && (!connected.address || !connected.connector || !connected.isConnected)) {
      throw new Error('Connect your wallet before requesting a transaction.')
    }
    if (requireWallet) {
      assertWalletContext(selected, connected.chainId ?? 0, connected.address, connected.address!, current.current.mainnetAcknowledged)
    }
    return {
      deployment: selected,
      address: connected.address,
      connector: connected.connector,
      walletChainId: connected.chainId,
      contextKey: `${selected.key}:${connected.address?.toLowerCase() ?? ''}:${connected.chainId ?? ''}:${connected.connector?.uid ?? ''}`,
    }
  }

  type Context = ReturnType<typeof capture>

  function assertCurrent(context: Context, requireWallet = false) {
    const live = current.current
    if (live.deploymentKey !== context.deployment.key || live.account.chainId !== context.walletChainId
        || live.account.address?.toLowerCase() !== context.address?.toLowerCase()
        || live.account.connector?.uid !== context.connector?.uid) {
      throw new Error('Wallet or marketplace selection changed. Review the current selection again.')
    }
    if (requireWallet) {
      assertWalletContext(context.deployment, live.account.chainId ?? 0, live.account.address,
        context.address!, live.mainnetAcknowledged)
    }
  }

  function publicClient(context: Context): PublicClient {
    const chain = context.deployment.chainId === arc.id ? arc : arcTestnet
    // RPC destinations are fixed official chain definitions, never user-provided URLs.
    return createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0], { retryCount: 1, timeout: 15_000 }) })
  }

  async function checkedWallet(context: Context) {
    assertCurrent(context, true)
    if (!context.address || !context.connector) throw new Error('Connect your wallet first.')
    const provider = await context.connector.getProvider({ chainId: context.deployment.chainId })
    const chain = context.deployment.chainId === arc.id ? arc : arcTestnet
    const wallet = createWalletClient({ account: context.address, chain, transport: custom(provider as EIP1193Provider) })
    const [actualChainId, addresses] = await Promise.all([wallet.getChainId(), wallet.getAddresses()])
    assertCurrent(context, true)
    assertWalletContext(context.deployment, actualChainId, addresses[0], context.address, current.current.mainnetAcknowledged)
    return wallet
  }

  async function begin<T>(action: LicenseMarketAction, work: (context: Context) => Promise<T>): Promise<T> {
    if (inFlight.current) throw new Error('A marketplace request is already in progress.')
    inFlight.current = true
    let operationKey = contextKey
    try {
      const context = capture(action !== null)
      operationKey = context.contextKey
      setState(previous => ({
        ...initialState, contextKey: operationKey, action,
        status: action ? 'simulating' : 'reading',
        snapshot: previous.contextKey === operationKey ? previous.snapshot : null,
      }))
      return await work(context)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Marketplace request failed.'
      setState(previous => ({ ...previous, contextKey: operationKey, action, status: 'error', error: message }))
      throw error
    } finally {
      inFlight.current = false
    }
  }

  async function confirmedReceipt(context: Context, client: PublicClient, hash: Hash): Promise<TransactionReceipt> {
    setState(previous => ({ ...previous, status: 'confirming', txHash: hash }))
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 })
    if (receipt.status !== 'success') throw new Error('The transaction reverted on-chain.')
    assertCurrent(context)
    return receipt
  }

  async function refresh(listingId?: bigint): Promise<LicenseMarketSnapshot> {
    if (listingId !== undefined) assertListingId(listingId)
    return begin(null, async context => {
      const snapshot = await readVerifiedLicenseMarket(publicClient(context), context.deployment, listingId, context.address)
      assertCurrent(context)
      setState(previous => ({ ...previous, status: 'ready', snapshot }))
      return snapshot
    })
  }

  async function approveExact(price6: bigint): Promise<LicenseMarketSnapshot> {
    assertLicensePrice(price6)
    return begin('approve', async context => {
      const client = publicClient(context)
      const listingId = state.contextKey === context.contextKey ? state.snapshot?.listingId ?? undefined : undefined
      const before = await readVerifiedLicenseMarket(client, context.deployment, listingId, context.address)
      if (before.listing && before.listing.price6 !== price6) throw new Error('Approval amount differs from the selected listing price.')
      const { request, result } = await client.simulateContract({
        account: context.address!, address: ARC_USDC_ADDRESS, abi: TOKEN_READ_ABI,
        functionName: 'approve', args: [context.deployment.address, price6],
      })
      if (result !== true) throw new Error('USDC approval simulation did not return success.')
      const wallet = await checkedWallet(context)
      setState(previous => ({ ...previous, status: 'signing' }))
      const hash = await wallet.writeContract({ ...request, account: context.address!, chain: wallet.chain })
      const receipt = await confirmedReceipt(context, client, hash)
      const snapshot = await readVerifiedLicenseMarket(client, context.deployment, listingId, context.address)
      assertCurrent(context)
      if (snapshot.allowance6 !== price6) throw new Error('Confirmed allowance differs from the exact amount requested. Refresh and review.')
      assertConfirmedLicenseApproval(receipt, context.deployment, context.address!, price6)
      setState(previous => ({ ...previous, status: 'confirmed', snapshot }))
      return snapshot
    })
  }

  async function buyLicense(listingId: bigint, expectedPrice6: bigint, expectedStrategyHash: Hash): Promise<LicenseMarketSnapshot> {
    assertListingId(listingId)
    assertLicensePrice(expectedPrice6)
    assertLicenseHash(expectedStrategyHash)
    return begin('buy', async context => {
      const client = publicClient(context)
      const before = await readVerifiedLicenseMarket(client, context.deployment, listingId, context.address)
      assertLicenseBuyable(before, listingId, expectedPrice6, expectedStrategyHash, context.address!)
      const { request } = await client.simulateContract({
        account: context.address!, address: context.deployment.address, abi: LICENSE_MARKET_ABI,
        functionName: 'buyLicense', args: [listingId, expectedPrice6, expectedStrategyHash],
      })
      const wallet = await checkedWallet(context)
      setState(previous => ({ ...previous, status: 'signing' }))
      const hash = await wallet.writeContract({ ...request, account: context.address!, chain: wallet.chain })
      const receipt = await confirmedReceipt(context, client, hash)
      const snapshot = await readVerifiedLicenseMarket(client, context.deployment, listingId, context.address)
      assertCurrent(context)
      assertConfirmedLicensePurchase(receipt, context.deployment, snapshot, listingId, expectedPrice6, expectedStrategyHash, context.address!)
      setState(previous => ({ ...previous, status: 'confirmed', snapshot }))
      return snapshot
    })
  }

  async function createListing(input: CreateLicenseListingInput): Promise<LicenseMarketSnapshot> {
    const reviewed = validateCreateListing(input)
    return begin('create', async context => {
      const client = publicClient(context)
      await readVerifiedLicenseMarket(client, context.deployment, undefined, context.address)
      const { request } = await client.simulateContract({
        account: context.address!, address: context.deployment.address, abi: LICENSE_MARKET_ABI,
        functionName: 'createListing', args: [
          reviewed.strategySha256, reviewed.reportSha256, reviewed.termsSha256, reviewed.price6,
          reviewed.artifactURI, reviewed.reportURI,
        ],
      })
      const wallet = await checkedWallet(context)
      setState(previous => ({ ...previous, status: 'signing' }))
      const hash = await wallet.writeContract({ ...request, account: context.address!, chain: wallet.chain })
      const receipt = await confirmedReceipt(context, client, hash)
      const listingId = createdLicenseListingId(receipt, context.deployment, context.address!, reviewed)
      const snapshot = await readVerifiedLicenseMarket(client, context.deployment, listingId, context.address)
      assertCurrent(context)
      if (!snapshot.listing || !sameAddress(snapshot.listing.seller, context.address!)
          || snapshot.listing.strategySha256.toLowerCase() !== reviewed.strategySha256.toLowerCase()
          || snapshot.listing.reportSha256.toLowerCase() !== reviewed.reportSha256.toLowerCase()
          || snapshot.listing.termsSha256.toLowerCase() !== reviewed.termsSha256.toLowerCase()
          || snapshot.listing.price6 !== reviewed.price6 || snapshot.listing.artifactURI !== reviewed.artifactURI
          || snapshot.listing.reportURI !== reviewed.reportURI) {
        throw new Error('Confirmed listing state differs from the reviewed version.')
      }
      setState(previous => ({ ...previous, status: 'confirmed', createdListingId: listingId, snapshot }))
      return snapshot
    })
  }

  function reset() {
    if (inFlight.current) return
    setState(initialState)
  }

  // A prior account/network's license never carries into the currently selected wallet.
  const sameContext = state.contextKey === contextKey
  const pending = ['reading', 'simulating', 'signing', 'confirming'].includes(state.status)
  return {
    deployment,
    snapshot: sameContext ? state.snapshot : null,
    status: sameContext || pending ? state.status : 'idle' as LicenseMarketStatus,
    action: sameContext || pending ? state.action : null,
    error: sameContext ? state.error : null,
    txHash: sameContext ? state.txHash : null,
    createdListingId: sameContext ? state.createdListingId : null,
    isPending: pending,
    refresh, approveExact, buyLicense, createListing, reset,
  }
}
