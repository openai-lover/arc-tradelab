import { decodeEventLog, formatUnits, getAddress, keccak256, parseAbi, parseUnits } from 'viem'
import type { Address, Hash, Hex, Log, PublicClient, TransactionReceipt } from 'viem'
import { artifact, runtimeHash, verifyContract } from '../onchain/contracts.ts'

export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const LICENSE_USDC_DECIMALS = 6 as const
export const MAX_LICENSE_PRICE6 = 1_000_000_000_000n // 1,000,000 USDC; no floating point on payment paths.
export type LicenseMarketChainId = 5042 | 5042002

export interface LicenseMarketDeployment {
  readonly key: string
  readonly label: string
  readonly chainId: LicenseMarketChainId
  readonly address: Address
  /** Exact deployed runtime bytecode hash, registered only after source verification. */
  readonly runtimeCodeHash: Hash
  /** Reviewed Solidity source SHA-256; a review record, not an audit/performance guarantee. */
  readonly sourceSha256: Hash
}

// Addresses are untrusted candidates. Only an exact compiled runtime match (including
// constructor-bound chain ID) can register one; every read/write rechecks that runtime.
export let LICENSE_MARKET_DEPLOYMENTS: readonly LicenseMarketDeployment[] = Object.freeze([])
export async function registerVerifiedMarket(chainId: LicenseMarketChainId, candidate: Address) {
  const address = getAddress(candidate)
  await verifyContract('StrategyLicenseMarket', chainId, address)
  const deployment = validateLicenseDeployment({ key: `arc-${chainId}-${address.toLowerCase()}`,
    label: `${chainId === 5042 ? 'Arc mainnet' : 'Arc Testnet'} · ${address.slice(0, 8)}`, chainId, address,
    runtimeCodeHash: runtimeHash('StrategyLicenseMarket', chainId),
    sourceSha256: artifact('StrategyLicenseMarket').sourceSha256 as Hash })
  LICENSE_MARKET_DEPLOYMENTS = Object.freeze([...LICENSE_MARKET_DEPLOYMENTS.filter(d => d.key !== deployment.key), deployment])
  return deployment
}

export const LICENSE_MARKET_ABI = parseAbi([
  'function expectedChainId() view returns (uint256)',
  'function USDC() view returns (address)',
  'function USDC_DECIMALS() view returns (uint8)',
  'function getListing(uint256 listingId) view returns ((address seller, bytes32 strategySha256, bytes32 reportSha256, bytes32 termsSha256, uint256 price6, string artifactURI, string reportURI, bool salesPaused) listing)',
  'function hasLicense(uint256 listingId, address buyer) view returns (bool)',
  'function purchases(uint256 listingId, address buyer) view returns (uint256 paidPrice6, uint256 purchasedAt)',
  'function createListing(bytes32 strategySha256, bytes32 reportSha256, bytes32 termsSha256, uint256 price6, string artifactURI, string reportURI) returns (uint256 listingId)',
  'function buyLicense(uint256 listingId, uint256 expectedPrice6, bytes32 expectedStrategySha256)',
  'event ListingCreated(uint256 indexed listingId, address indexed seller, bytes32 strategySha256, bytes32 reportSha256, bytes32 termsSha256, uint256 price6, string artifactURI, string reportURI)',
  'event LicensePurchased(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 paidPrice6, bytes32 strategySha256, bytes32 reportSha256, bytes32 termsSha256)',
  'error UnsupportedChain(uint256 chainId)',
  'error WrongChain(uint256 expected, uint256 actual)',
  'error WrongTokenDecimals(uint8 actual)',
  'error MissingCommitment()',
  'error InvalidURI()',
  'error InvalidPrice()',
  'error ListingNotFound()',
  'error NotSeller()',
  'error SalesPaused()',
  'error SelfPurchase()',
  'error AlreadyLicensed()',
  'error PriceMismatch()',
  'error StrategyMismatch()',
  'error ReentrancyGuardReentrantCall()',
])

export interface CreateLicenseListingInput {
  readonly strategySha256: Hash
  readonly reportSha256: Hash
  readonly termsSha256: Hash
  readonly price6: bigint
  readonly artifactURI: string
  readonly reportURI: string
}

export interface LicenseListing extends CreateLicenseListingInput {
  readonly seller: Address
  readonly salesPaused: boolean
}

export interface LicensePurchase {
  readonly paidPrice6: bigint
  readonly purchasedAt: bigint
}

export interface LicenseMarketSnapshot {
  readonly deploymentKey: string
  readonly chainId: LicenseMarketChainId
  readonly marketAddress: Address
  readonly blockNumber: bigint
  readonly verifiedAt: number
  readonly account: Address | null
  readonly listingId: bigint | null
  readonly listing: LicenseListing | null
  readonly hasLicense: boolean
  readonly purchase: LicensePurchase | null
  readonly balance6: bigint | null
  readonly allowance6: bigint | null
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const UINT256_MAX = (1n << 256n) - 1n

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function assertLicenseHash(value: unknown, name = 'SHA-256 digest'): asserts value is Hash {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error(`${name} must be a nonzero 32-byte hexadecimal value.`)
  }
}

export function assertLicensePrice(price6: unknown): asserts price6 is bigint {
  if (typeof price6 !== 'bigint' || price6 <= 0n || price6 > MAX_LICENSE_PRICE6) {
    throw new Error('Price must be positive and at most 1,000,000 USDC in six-decimal base units.')
  }
}

export function parseLicensePrice(value: string): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('Enter a plain USDC amount with at most six decimal places.')
  }
  const result = parseUnits(value, LICENSE_USDC_DECIMALS)
  assertLicensePrice(result)
  return result
}

export function formatLicensePrice(price6: bigint): string {
  return formatUnits(price6, LICENSE_USDC_DECIMALS)
}

export function assertListingId(value: unknown): asserts value is bigint {
  if (typeof value !== 'bigint' || value <= 0n || value > UINT256_MAX) {
    throw new Error('Listing ID must be a positive uint256 integer.')
  }
}

export function assertLicenseURI(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 2048
      || /[\s\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error('Content URI must contain 1–2048 UTF-8 bytes without whitespace or controls.')
  }
  let uri: URL
  try { uri = new URL(value) } catch { throw new Error('Content URI must be an absolute HTTPS or IPFS URL.') }
  if (!['https:', 'ipfs:'].includes(uri.protocol) || !uri.hostname || uri.username || uri.password) {
    throw new Error('Content URI must be an HTTPS or IPFS URL without embedded credentials.')
  }
}

export function validateCreateListing(input: CreateLicenseListingInput): Readonly<CreateLicenseListingInput> {
  assertLicenseHash(input.strategySha256, 'Strategy digest')
  assertLicenseHash(input.reportSha256, 'Report digest')
  assertLicenseHash(input.termsSha256, 'License terms digest')
  assertLicensePrice(input.price6)
  assertLicenseURI(input.artifactURI)
  assertLicenseURI(input.reportURI)
  return Object.freeze({
    strategySha256: input.strategySha256, reportSha256: input.reportSha256,
    termsSha256: input.termsSha256, price6: input.price6,
    artifactURI: input.artifactURI, reportURI: input.reportURI,
  })
}

export function validateLicenseDeployment(deployment: LicenseMarketDeployment): LicenseMarketDeployment {
  if (deployment.chainId !== 5042 && deployment.chainId !== 5042002) throw new Error('Unsupported marketplace chain.')
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(deployment.key) || !deployment.label.trim()) {
    throw new Error('Invalid reviewed deployment metadata.')
  }
  const address = getAddress(deployment.address)
  if (sameAddress(address, ZERO_ADDRESS) || sameAddress(address, ARC_USDC_ADDRESS)) {
    throw new Error('Invalid marketplace address.')
  }
  assertLicenseHash(deployment.runtimeCodeHash, 'Reviewed runtime code hash')
  assertLicenseHash(deployment.sourceSha256, 'Reviewed source digest')
  return Object.freeze({ ...deployment, address })
}

export function requireLicenseDeployment(key?: string): LicenseMarketDeployment {
  const registered = LICENSE_MARKET_DEPLOYMENTS.find(deployment => deployment.key === key)
  if (!registered) throw new Error('No reviewed marketplace deployment is registered. Wallet transactions are unavailable.')
  return validateLicenseDeployment(registered)
}

type ReadClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBytecode' | 'readContract'>

/** Single-block reads; an RPC chain ID, runtime code, constants and ERC20 precision must all match. */
export async function readVerifiedLicenseMarket(
  client: ReadClient, deployment: LicenseMarketDeployment, listingId?: bigint, account?: Address,
): Promise<LicenseMarketSnapshot> {
  const reviewed = validateLicenseDeployment(deployment)
  if (listingId !== undefined) assertListingId(listingId)
  if (account) getAddress(account)
  if (await client.getChainId() !== reviewed.chainId) throw new Error('Public RPC is connected to the wrong chain.')
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  const bytecode = await client.getBytecode({ address: reviewed.address, blockNumber })
  if (!bytecode || bytecode === '0x') throw new Error('No marketplace bytecode exists at the registered address.')
  if (keccak256(bytecode).toLowerCase() !== reviewed.runtimeCodeHash.toLowerCase()) {
    throw new Error('Marketplace runtime bytecode does not match the reviewed deployment.')
  }
  const [expectedChain, tokenAddress, tokenPrecision, actualPrecision] = await Promise.all([
    client.readContract({ address: reviewed.address, abi: LICENSE_MARKET_ABI, functionName: 'expectedChainId', blockNumber }),
    client.readContract({ address: reviewed.address, abi: LICENSE_MARKET_ABI, functionName: 'USDC', blockNumber }),
    client.readContract({ address: reviewed.address, abi: LICENSE_MARKET_ABI, functionName: 'USDC_DECIMALS', blockNumber }),
    client.readContract({ address: ARC_USDC_ADDRESS, abi: TOKEN_READ_ABI, functionName: 'decimals', blockNumber }),
  ])
  if (expectedChain !== BigInt(reviewed.chainId) || !sameAddress(tokenAddress, ARC_USDC_ADDRESS)
      || tokenPrecision !== LICENSE_USDC_DECIMALS || actualPrecision !== LICENSE_USDC_DECIMALS) {
    throw new Error('Marketplace network or USDC interface verification failed.')
  }
  const listing = listingId !== undefined
    ? await client.readContract({ address: reviewed.address, abi: LICENSE_MARKET_ABI, functionName: 'getListing', args: [listingId], blockNumber })
    : null
  if (listing) {
    validateCreateListing(listing)
    if (sameAddress(listing.seller, ZERO_ADDRESS)) throw new Error('Listing has no seller.')
  }
  const [hasLicense, purchase, balance6, allowance6] = account ? await Promise.all([
    listingId !== undefined
      ? client.readContract({ address: reviewed.address, abi: LICENSE_MARKET_ABI, functionName: 'hasLicense', args: [listingId, account], blockNumber })
      : Promise.resolve(false),
    listingId !== undefined
      ? client.readContract({ address: reviewed.address, abi: LICENSE_MARKET_ABI, functionName: 'purchases', args: [listingId, account], blockNumber })
      : Promise.resolve(null),
    client.readContract({ address: ARC_USDC_ADDRESS, abi: TOKEN_READ_ABI, functionName: 'balanceOf', args: [account], blockNumber }),
    client.readContract({ address: ARC_USDC_ADDRESS, abi: TOKEN_READ_ABI, functionName: 'allowance', args: [account, reviewed.address], blockNumber }),
  ]) : [false, null, null, null] as const
  const purchaseRecord = purchase ? Object.freeze({ paidPrice6: purchase[0], purchasedAt: purchase[1] }) : null
  if (purchaseRecord && (hasLicense !== (purchaseRecord.paidPrice6 > 0n)
      || (purchaseRecord.paidPrice6 === 0n && purchaseRecord.purchasedAt !== 0n)
      || (hasLicense && (!listing || purchaseRecord.paidPrice6 !== listing.price6 || purchaseRecord.purchasedAt <= 0n)))) {
    throw new Error('License entitlement and purchase record do not agree.')
  }
  if (await client.getChainId() !== reviewed.chainId) throw new Error('Public RPC chain changed while reading the marketplace.')
  return Object.freeze({
    deploymentKey: reviewed.key, chainId: reviewed.chainId, marketAddress: reviewed.address,
    blockNumber, verifiedAt: Date.now(), account: account ?? null, listingId: listingId ?? null,
    listing: listing ? Object.freeze({ ...listing }) : null, hasLicense,
    purchase: purchaseRecord, balance6, allowance6,
  })
}

export const TOKEN_READ_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
])

export function assertWalletContext(
  deployment: LicenseMarketDeployment, actualChainId: number, actualAccount: string | undefined,
  expectedAccount: Address, mainnetAcknowledged = false,
): void {
  if (actualChainId !== deployment.chainId) throw new Error('Switch your wallet to the selected Arc network first.')
  if (!actualAccount || !sameAddress(actualAccount, expectedAccount)) throw new Error('Wallet account changed. Review again before signing.')
  if (deployment.chainId === 5042 && !mainnetAcknowledged) {
    throw new Error('Acknowledge the real USDC payment before requesting a mainnet wallet transaction.')
  }
}

/** Fresh chain reads, never imported JSON or cached browser state, authorize a purchase request. */
export function assertLicenseBuyable(
  snapshot: LicenseMarketSnapshot, listingId: bigint, expectedPrice6: bigint, strategyHash: Hash, account: Address,
): void {
  assertListingId(listingId)
  assertLicensePrice(expectedPrice6)
  assertLicenseHash(strategyHash)
  if (!snapshot.account || !sameAddress(snapshot.account, account) || snapshot.listingId !== listingId || !snapshot.listing) {
    throw new Error('Refresh this listing and wallet before purchasing.')
  }
  if (snapshot.listing.price6 !== expectedPrice6 || snapshot.listing.strategySha256.toLowerCase() !== strategyHash.toLowerCase()) {
    throw new Error('Listing price or strategy version differs from what you reviewed.')
  }
  if (snapshot.listing.salesPaused) throw new Error('Seller has paused new purchases.')
  if (sameAddress(snapshot.listing.seller, account)) throw new Error('You cannot purchase your own listing.')
  if (snapshot.hasLicense) throw new Error('This wallet already holds a license for this listing.')
  if (snapshot.balance6 === null || snapshot.balance6 < expectedPrice6) throw new Error('Insufficient USDC balance. Gas also requires USDC.')
  if (snapshot.allowance6 === null || snapshot.allowance6 < expectedPrice6) throw new Error('Approve the exact USDC price before purchasing.')
}

type Receipt = Pick<TransactionReceipt, 'status' | 'logs'>
type ReceiptLog = Pick<Log, 'address' | 'data' | 'topics'>

export function assertConfirmedLicenseApproval(
  receipt: Receipt, deployment: LicenseMarketDeployment, account: Address, price6: bigint,
): void {
  if (receipt.status !== 'success') throw new Error('USDC approval transaction reverted.')
  const events = receipt.logs.flatMap(log => {
    if (!sameAddress(log.address, ARC_USDC_ADDRESS)) return []
    try { return [decodeEventLog({ abi: TOKEN_READ_ABI, data: log.data, topics: log.topics })] }
    catch { return [] }
  })
  const matching = events.filter(event => event.eventName === 'Approval'
    && sameAddress(event.args.owner, account) && sameAddress(event.args.spender, deployment.address)
    && event.args.value === price6)
  if (matching.length !== 1) throw new Error('Expected one exact USDC approval event for the reviewed marketplace.')
}

function marketEvents(logs: readonly ReceiptLog[], deployment: LicenseMarketDeployment) {
  return logs.flatMap(log => {
    if (!sameAddress(log.address, deployment.address)) return []
    try { return [decodeEventLog({ abi: LICENSE_MARKET_ABI, data: log.data, topics: log.topics })] }
    catch { return [] }
  })
}

export function createdLicenseListingId(
  receipt: Receipt, deployment: LicenseMarketDeployment, account: Address, input: CreateLicenseListingInput,
): bigint {
  if (receipt.status !== 'success') throw new Error('Listing transaction reverted.')
  const matches = marketEvents(receipt.logs, deployment).filter(event => event.eventName === 'ListingCreated')
  if (matches.length !== 1 || matches[0].eventName !== 'ListingCreated') throw new Error('Expected one confirmed listing event.')
  const event = matches[0].args
  if (!sameAddress(event.seller, account) || event.strategySha256.toLowerCase() !== input.strategySha256.toLowerCase()
      || event.reportSha256.toLowerCase() !== input.reportSha256.toLowerCase()
      || event.termsSha256.toLowerCase() !== input.termsSha256.toLowerCase()
      || event.price6 !== input.price6 || event.artifactURI !== input.artifactURI || event.reportURI !== input.reportURI) {
    throw new Error('Confirmed listing event differs from the reviewed request.')
  }
  assertListingId(event.listingId)
  return event.listingId
}

export function assertConfirmedLicensePurchase(
  receipt: Receipt, deployment: LicenseMarketDeployment, snapshot: LicenseMarketSnapshot,
  listingId: bigint, price6: bigint, strategyHash: Hash, account: Address,
): void {
  if (receipt.status !== 'success') throw new Error('Purchase transaction reverted.')
  if (snapshot.deploymentKey !== deployment.key || snapshot.chainId !== deployment.chainId
      || !sameAddress(snapshot.marketAddress, deployment.address) || snapshot.listingId !== listingId
      || !snapshot.account || !sameAddress(snapshot.account, account) || !snapshot.listing
      || !snapshot.hasLicense || !snapshot.purchase || snapshot.purchase.paidPrice6 !== price6
      || snapshot.purchase.purchasedAt <= 0n || snapshot.listing.price6 !== price6
      || snapshot.listing.strategySha256.toLowerCase() !== strategyHash.toLowerCase()) {
    throw new Error('A confirmed receipt is insufficient: the correct-chain entitlement and purchase record must also match.')
  }
  const events = marketEvents(receipt.logs, deployment).filter(event => event.eventName === 'LicensePurchased')
  if (events.length !== 1 || events[0].eventName !== 'LicensePurchased') throw new Error('Expected one confirmed license purchase event.')
  const event = events[0].args
  if (event.listingId !== listingId || !sameAddress(event.buyer, account)
      || !sameAddress(event.seller, snapshot.listing.seller) || event.paidPrice6 !== price6
      || event.strategySha256.toLowerCase() !== strategyHash.toLowerCase()
      || event.reportSha256.toLowerCase() !== snapshot.listing.reportSha256.toLowerCase()
      || event.termsSha256.toLowerCase() !== snapshot.listing.termsSha256.toLowerCase()) {
    throw new Error('Purchase event differs from the reviewed software license request.')
  }
}

export function licenseTransactionUrl(chainId: LicenseMarketChainId, hash: Hex): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid transaction hash.')
  return `https://${chainId === 5042 ? 'explorer.arc.io' : 'explorer.testnet.arc.io'}/tx/${hash}`
}
