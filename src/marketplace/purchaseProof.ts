import { decodeEventLog, erc20Abi, formatUnits } from 'viem'
import type { Address, Hash, TransactionReceipt } from 'viem'
import { ARC_USDC_ADDRESS, LICENSE_MARKET_ABI, assertConfirmedLicensePurchase, readVerifiedLicenseMarket, sameAddress } from './licenseMarket.ts'
import type { LicenseMarketDeployment, LicenseMarketSnapshot } from './licenseMarket.ts'
import { rpc } from '../onchain/contracts.ts'

export function purchaseEvent(receipt: Pick<TransactionReceipt, 'status' | 'logs'>, market: Address) {
  if (receipt.status !== 'success') throw new Error('This transaction did not succeed.')
  const events = receipt.logs.flatMap(log => {
    if (!sameAddress(log.address, market)) return []
    try { const decoded = decodeEventLog({ abi: LICENSE_MARKET_ABI, data: log.data, topics: log.topics }); return decoded.eventName === 'LicensePurchased' ? [decoded.args] : [] } catch { return [] }
  })
  if (events.length !== 1) throw new Error('This is not a single license purchase through this marketplace.')
  return events[0]
}
export function verifyPurchaseMovement(receipt: Pick<TransactionReceipt, 'status' | 'logs'>, deployment: LicenseMarketDeployment, snapshot: LicenseMarketSnapshot) {
  const event = purchaseEvent(receipt, deployment.address)
  assertConfirmedLicensePurchase(receipt, deployment, snapshot, event.listingId, event.paidPrice6, event.strategySha256, event.buyer)
  if (sameAddress(event.buyer, event.seller)) throw new Error('Buyer and seller must differ.')
  const transfers = receipt.logs.flatMap(log => {
    if (!sameAddress(log.address, ARC_USDC_ADDRESS)) return []
    try { const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics }); return decoded.eventName === 'Transfer' ? [decoded.args] : [] } catch { return [] }
  }).filter(t => sameAddress(t.from, event.buyer) && sameAddress(t.to, event.seller) && t.value === event.paidPrice6)
  if (transfers.length !== 1) throw new Error('The receipt must contain the exact buyer-to-seller USDC transfer.')
  return event
}
export async function readPurchaseProof(deployment: LicenseMarketDeployment, hash: Hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Enter a transaction hash.')
  const client = rpc(deployment.chainId)
  if (await client.getChainId() !== deployment.chainId) throw new Error('RPC network mismatch.')
  const receipt = await client.getTransactionReceipt({ hash })
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || !receipt.to || !sameAddress(receipt.to, deployment.address)) throw new Error('The transaction is not addressed to this marketplace.')
  const event = purchaseEvent(receipt, deployment.address)
  const [snapshot, block] = await Promise.all([
    readVerifiedLicenseMarket(client, deployment, event.listingId, event.buyer), client.getBlock({ blockNumber: receipt.blockNumber }),
  ])
  if (block.hash !== receipt.blockHash) throw new Error('Receipt is no longer in the current chain.')
  verifyPurchaseMovement(receipt, deployment, snapshot)
  return Object.freeze({ schema: 'arc-tradelab.purchase-proof.v1', chainId: deployment.chainId, market: deployment.address, transactionHash: hash,
    blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, timestamp: Number(block.timestamp),
    buyer: event.buyer, seller: event.seller, listingId: event.listingId.toString(), paidUSDC: formatUnits(event.paidPrice6, 6),
    gasUSDC: formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18), strategySha256: event.strategySha256,
    reportSha256: event.reportSha256, termsSha256: event.termsSha256, runtimeCodeHash: deployment.runtimeCodeHash,
    entitlementCheckedAtBlock: snapshot.blockNumber.toString(), verifiedAt: new Date().toISOString(),
    disclosure: 'Verified USDC payment and software-use entitlement. Does not prove independent customers, strategy performance, authorship or exclusive ownership.',
  })
}
export type PurchaseProof = Awaited<ReturnType<typeof readPurchaseProof>>
