/** Pure paper accounting. These numbers never authorize a wallet transaction. */
export interface PaperLedger {
  initialCash: number
  cash: number
  btc: number
  costBasis: number // includes buy fees; slippage is already in execution price
  realizedPnl: number
  filledIds: string[]
}

export interface PaperOrder {
  id: string
  side: 'buy' | 'sell'
  referencePrice: number
  /** Buy: maximum cash debit including fee. Sell: BTC quantity. */
  amount: number
}

export interface FillAssumptions {
  feeBps: number
  slippageBps: number
}

export interface PaperFill {
  id: string
  side: 'buy' | 'sell'
  btc: number
  referencePrice: number
  executionPrice: number
  notional: number
  fee: number
  cashDelta: number
  realizedPnl: number
  networkGas: 0
  chainStatus: 'not_submitted'
}

export type FillResult =
  | { ok: true; ledger: PaperLedger; fill: PaperFill }
  | { ok: false; reason: string }

const positive = (v: number) => Number.isFinite(v) && v > 0

export function createPaperLedger(initialCash: number): PaperLedger {
  if (!positive(initialCash)) throw new Error('Initial cash must be finite and positive')
  return { initialCash, cash: initialCash, btc: 0, costBasis: 0, realizedPnl: 0, filledIds: [] }
}

export function fillPaperOrder(
  ledger: PaperLedger,
  order: PaperOrder,
  assumptions: FillAssumptions,
): FillResult {
  if (![ledger.initialCash, ledger.cash, ledger.btc, ledger.costBasis, ledger.realizedPnl].every(Number.isFinite)
      || ledger.initialCash <= 0 || ledger.cash < 0 || ledger.btc < 0 || ledger.costBasis < 0) {
    return { ok: false, reason: 'Invalid ledger' }
  }
  if (!order.id || ledger.filledIds.includes(order.id)) return { ok: false, reason: 'Missing or duplicate order ID' }
  if (!['buy', 'sell'].includes(order.side)) return { ok: false, reason: 'Invalid side' }
  if (!positive(order.amount) || !positive(order.referencePrice)) return { ok: false, reason: 'Invalid order' }
  if (![assumptions.feeBps, assumptions.slippageBps].every(v => Number.isFinite(v) && v >= 0 && v < 10_000)) {
    return { ok: false, reason: 'Invalid simulation assumptions' }
  }
  const feeRate = assumptions.feeBps / 10_000
  const price = order.referencePrice * (1 + (order.side === 'buy' ? 1 : -1) * assumptions.slippageBps / 10_000)
  if (!positive(price)) return { ok: false, reason: 'Invalid execution price' }
  let quantity: number, notional: number, fee: number, cashDelta: number, basisRemoved = 0, realized = 0
  if (order.side === 'buy') {
    if (order.amount > ledger.cash) return { ok: false, reason: 'Insufficient simulation cash' }
    notional = order.amount / (1 + feeRate)
    fee = order.amount - notional
    quantity = notional / price
    cashDelta = -order.amount
  } else {
    if (order.amount > ledger.btc) return { ok: false, reason: 'Insufficient virtual BTC' }
    quantity = order.amount
    notional = quantity * price
    fee = notional * feeRate
    cashDelta = notional - fee
    basisRemoved = ledger.costBasis * (quantity / ledger.btc)
    realized = cashDelta - basisRemoved
  }
  if (![quantity, notional, fee, cashDelta, realized].every(Number.isFinite) || !positive(quantity)) {
    return { ok: false, reason: 'Unrepresentable fill' }
  }
  const remainingBtc = order.side === 'buy' ? ledger.btc + quantity : ledger.btc - quantity
  return {
    ok: true,
    ledger: {
      ...ledger,
      cash: ledger.cash + cashDelta,
      btc: remainingBtc,
      costBasis: order.side === 'buy'
        ? ledger.costBasis + order.amount
        : remainingBtc === 0 ? 0 : ledger.costBasis - basisRemoved,
      realizedPnl: ledger.realizedPnl + realized,
      filledIds: [...ledger.filledIds, order.id],
    },
    fill: {
      id: order.id, side: order.side, btc: quantity,
      referencePrice: order.referencePrice, executionPrice: price,
      notional, fee, cashDelta, realizedPnl: realized,
      networkGas: 0, chainStatus: 'not_submitted',
    },
  }
}

export function markPaperLedger(ledger: PaperLedger, referencePrice: number) {
  if (!positive(referencePrice)) throw new Error('Mark price must be finite and positive')
  const positionValue = ledger.btc * referencePrice
  return {
    equity: ledger.cash + positionValue,
    unrealizedPnl: positionValue - ledger.costBasis,
    realizedPnl: ledger.realizedPnl,
  }
}
