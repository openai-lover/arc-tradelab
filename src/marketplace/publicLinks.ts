import { getAddress } from 'viem'
import type { Address, Hash } from 'viem'
import type { Network } from '../onchain/contracts.ts'

export interface PublicSelection { chainId: Network; market: Address; listingId?: bigint; transaction?: Hash }
/** A link supplies candidates, never trust or permission. Fixed RPC/runtime checks follow. */
export function parsePublicSelection(search: string): PublicSelection | null {
  const q = new URLSearchParams(search)
  if (!q.has('market')) return null
  for (const key of ['chain', 'market', 'listing', 'tx']) if (q.getAll(key).length > 1) throw new Error('Ambiguous shared link.')
  const chain = q.get('chain')
  if (chain !== '5042' && chain !== '5042002') throw new Error('This link must select an Arc network.')
  const market = getAddress(q.get('market')!)
  if (/^0x0{40}$/i.test(market)) throw new Error('Missing marketplace address.')
  const listing = q.get('listing'); const tx = q.get('tx')
  if (listing !== null && (!/^[1-9]\d{0,30}$/.test(listing))) throw new Error('Invalid shared listing ID.')
  if (tx !== null && !/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new Error('Invalid shared transaction hash.')
  return { chainId: Number(chain) as Network, market, ...(listing ? { listingId: BigInt(listing) } : {}), ...(tx ? { transaction: tx as Hash } : {}) }
}
export function publicLink(base: string, selection: PublicSelection) {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use the public app address.')
  if (url.hostname.endsWith('.preview.studio.arc.io') || url.hostname === 'studio.arc.io') throw new Error('Open the published app to share a public buyer link. Studio preview links are session-scoped.')
  // Never copy Studio preview tokens or unrelated account/query state into shared links.
  url.search = ''; url.hash = ''
  url.searchParams.set('chain', String(selection.chainId)); url.searchParams.set('market', selection.market)
  if (selection.listingId !== undefined) url.searchParams.set('listing', String(selection.listingId))
  if (selection.transaction) url.searchParams.set('tx', selection.transaction)
  parsePublicSelection(url.search)
  return url.href
}
