/**
 * useWithdrawUsdc — send USDC back to the connected wallet.
 *
 * In the testnet MVP the "lab balance" is the user's own wallet (self-custody).
 * The user deposited test USDC and it stayed in their wallet; the lab tracks
 * the deposit as an accounting entry. Withdrawing simply records the withdrawal
 * in the lab state — the USDC never actually left the wallet, so no on-chain
 * transfer is needed for withdrawals.
 *
 * This is clearly labeled in the UI. There is no custodied contract.
 * Consequence: the user can only "withdraw" up to their depositedUsdc amount,
 * and withdrawing zeros out that portion of the lab balance.
 */

import { useCallback, useState } from 'react'

export type WithdrawStatus = 'idle' | 'confirmed' | 'error'

export interface WithdrawHook {
  withdraw: (amount: number) => void
  status: WithdrawStatus
  error: string | null
  reset: () => void
}

export function useWithdrawUsdc(
  depositedUsdc: number,
  freeUsdc: number,
  onConfirmed: (amount: number) => void,
): WithdrawHook {
  const [status, setStatus] = useState<WithdrawStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const withdraw = useCallback(
    (amount: number) => {
      setError(null)
      if (amount <= 0) { setError('Enter a positive amount.'); return }
      if (amount > depositedUsdc) {
        setError(`Cannot withdraw more than your deposited amount (${depositedUsdc.toFixed(2)} USDC).`)
        return
      }
      if (amount > freeUsdc) {
        setError(`${(freeUsdc).toFixed(2)} USDC is free. Close your position first to free the rest.`)
        return
      }
      // Record withdrawal: reduce deposited amount in lab state
      onConfirmed(amount)
      setStatus('confirmed')
    },
    [depositedUsdc, freeUsdc, onConfirmed],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
  }, [])

  return { withdraw, status, error, reset }
}
