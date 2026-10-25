/**
 * useDepositUsdc — USDC deposit flow for Arc TradeLab.
 *
 * Status is DERIVED during render from wagmi hook state + manual overrides,
 * so no setState-in-effect pattern is needed. Side effects (crediting the
 * lab balance, showing the explorer URL) run in a single effect keyed to
 * the stable tx hash.
 */

import { useCallback, useState, useEffect, useRef } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi } from 'viem'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { parseAmount } from '@/onchain-money'

const ARC_TESTNET_CHAIN_ID = 5042002

export type DepositStatus = 'idle' | 'switching' | 'signing' | 'confirming' | 'confirmed' | 'error'

export interface DepositHook {
  deposit: (amountUsdc: number) => void
  status: DepositStatus
  error: string | null
  txHash: string | null
  explorerUrl: string | null
  isConfirming: boolean
  pendingAmount: number
  reset: () => void
}

function loadCreditedTxHashes(address: string): Set<string> {
  try {
    const raw = localStorage.getItem(`tradelab_credited_txs_${address.toLowerCase()}`)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function saveCreditedTxHash(address: string, txHash: string) {
  try {
    const set = loadCreditedTxHashes(address)
    set.add(txHash.toLowerCase())
    localStorage.setItem(`tradelab_credited_txs_${address.toLowerCase()}`, JSON.stringify([...set].slice(-50)))
  } catch { /* storage full */ }
}

export function useDepositUsdc(onConfirmed: (amount: number) => void): DepositHook {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  // Only truly manual state — things wagmi can't tell us
  const [isSwitching, setIsSwitching] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null)
  const [pendingAmount, setPendingAmount] = useState(0)
  const pendingRetryRef = useRef<number | null>(null)
  const prevChainId = useRef<number | undefined>(undefined)
  // Track which tx hash we've already credited to prevent double-fire
  const creditedHashRef = useRef<string | null>(null)

  const usdc = getUsdc(ARC_TESTNET_CHAIN_ID)!

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    isError: isWriteError,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess,
    isError: isTxError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  // --- Derived status (no setState, pure computation) ---
  const writeErrorMsg = isWriteError && writeError ? (writeError.message ?? '') : ''
  const isUserRejected = writeErrorMsg.toLowerCase().includes('user rejected') || writeErrorMsg.includes('4001')

  const status: DepositStatus = (() => {
    if (isSwitching) return 'switching'
    if (isWriteError && !isUserRejected) return 'error'
    if (isTxError) return 'error'
    if (isSuccess && explorerUrl) return 'confirmed'
    if (isWritePending) return 'signing'
    if (isConfirming) return 'confirming'
    return 'idle'
  })()

  const error = isTxError
    ? 'Transaction failed on-chain.'
    : (isWriteError && !isUserRejected)
    ? 'Transaction rejected. Try again.'
    : manualError

  // --- Side effect: credit lab balance once per confirmed tx hash ---
  useEffect(() => {
    if (!isSuccess || !txHash || !address) return
    const normalized = txHash.toLowerCase()
    if (creditedHashRef.current === normalized) return // already handled
    const credited = loadCreditedTxHashes(address)
    creditedHashRef.current = normalized
    setExplorerUrl(buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, txHash))
    if (!credited.has(normalized)) {
      saveCreditedTxHash(address, txHash)
      onConfirmed(pendingAmount)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, txHash, address])
  // ^^ pendingAmount and onConfirmed deliberately excluded:
  //    this effect must only run once when the specific tx confirms,
  //    not re-run if the user later clicks deposit again with a different amount.

  // --- Auto-retry deposit after chain switch ---
  useEffect(() => {
    if (
      prevChainId.current !== chainId &&
      chainId === ARC_TESTNET_CHAIN_ID &&
      pendingRetryRef.current !== null &&
      isSwitching
    ) {
      const amount = pendingRetryRef.current
      pendingRetryRef.current = null
      setIsSwitching(false)
      const parsed = parseAmount(ARC_TESTNET_CHAIN_ID, String(amount))
      writeContract({
        address: usdc.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [address as `0x${string}`, parsed.raw],
        chainId: ARC_TESTNET_CHAIN_ID,
      })
    }
    prevChainId.current = chainId
  }, [chainId, isSwitching, address, usdc.address, writeContract])

  const deposit = useCallback(
    (amountUsdc: number) => {
      if (!address) { setManualError('Connect your wallet first.'); return }
      if (amountUsdc < 0.01) { setManualError('Minimum deposit is 0.01 USDC.'); return }

      setManualError(null)
      setExplorerUrl(null)
      setPendingAmount(amountUsdc)
      creditedHashRef.current = null
      resetWrite()

      if (chainId !== ARC_TESTNET_CHAIN_ID) {
        pendingRetryRef.current = amountUsdc
        setIsSwitching(true)
        switchChain({ chainId: ARC_TESTNET_CHAIN_ID })
        return
      }

      setIsSwitching(false)
      const parsed = parseAmount(ARC_TESTNET_CHAIN_ID, String(amountUsdc))
      writeContract({
        address: usdc.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [address, parsed.raw],
        chainId: ARC_TESTNET_CHAIN_ID,
      })
    },
    [address, chainId, switchChain, writeContract, usdc, resetWrite],
  )

  const reset = useCallback(() => {
    setIsSwitching(false)
    setManualError(null)
    setExplorerUrl(null)
    setPendingAmount(0)
    pendingRetryRef.current = null
    creditedHashRef.current = null
    resetWrite()
  }, [resetWrite])

  return {
    deposit,
    status,
    error,
    txHash: txHash ?? null,
    explorerUrl,
    isConfirming,
    pendingAmount,
    reset,
  }
}
