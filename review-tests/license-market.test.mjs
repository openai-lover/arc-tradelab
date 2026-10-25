import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiParameters } from 'viem'
import {
  ARC_USDC_ADDRESS, LICENSE_MARKET_ABI, LICENSE_MARKET_DEPLOYMENTS, MAX_LICENSE_PRICE6, TOKEN_READ_ABI,
  assertConfirmedLicenseApproval, assertConfirmedLicensePurchase, assertLicenseBuyable, assertLicenseHash, assertLicensePrice,
  assertLicenseURI, assertListingId, assertWalletContext, createdLicenseListingId,
  formatLicensePrice, licenseTransactionUrl, parseLicensePrice, readVerifiedLicenseMarket,
  requireLicenseDeployment, validateCreateListing, validateLicenseDeployment,
} from '../src/marketplace/licenseMarket.ts'

const hash = byte => `0x${byte.repeat(64)}`
const strategyHash = hash('1')
const reportHash = hash('2')
const termsHash = hash('3')
const marketAddress = '0x1000000000000000000000000000000000000001'
const buyer = '0x2000000000000000000000000000000000000002'
const seller = '0x3000000000000000000000000000000000000003'
const other = '0x4000000000000000000000000000000000000004'
const bytecode = '0x60006000'
const price6 = 7_500_000n
const deployment = {
  key: 'reviewed-rehearsal', label: 'Arc Testnet rehearsal', chainId: 5042002,
  address: marketAddress, runtimeCodeHash: keccak256(bytecode), sourceSha256: hash('4'),
}
const input = {
  strategySha256: strategyHash, reportSha256: reportHash, termsSha256: termsHash,
  price6, artifactURI: 'ipfs://bafyArtifact/strategy.json', reportURI: 'https://example.com/report.json',
}
const listing = { ...input, seller, salesPaused: false }

function rpc(overrides = {}) {
  const calls = []
  const values = {
    expectedChainId: 5042002n, USDC: ARC_USDC_ADDRESS, USDC_DECIMALS: 6, decimals: 6,
    getListing: listing, hasLicense: false, purchases: [0n, 0n],
    balanceOf: 100_000_000n, allowance: price6, ...overrides.values,
  }
  let chainCalls = 0
  return {
    calls,
    async getChainId() {
      calls.push({ method: 'getChainId' })
      return overrides.chainIds?.[chainCalls++] ?? overrides.chainId ?? 5042002
    },
    async getBlockNumber(options) { calls.push({ method: 'getBlockNumber', options }); return 123n },
    async getBytecode(options) { calls.push({ method: 'getBytecode', ...options }); return overrides.bytecode ?? bytecode },
    async readContract(options) {
      calls.push({ method: 'readContract', ...options })
      if (overrides.failFunction === options.functionName) throw new Error('RPC read failure')
      if (!(options.functionName in values)) throw new Error('Unexpected function')
      return values[options.functionName]
    },
  }
}

const read = overrides => readVerifiedLicenseMarket(rpc(overrides), deployment, 9n, buyer)
const licensedRead = overrides => read({ values: { hasLicense: true, purchases: [price6, 123456n], ...overrides } })

function purchaseLog(overrides = {}, address = marketAddress) {
  const event = {
    listingId: 9n, buyer, seller, paidPrice6: price6, strategySha256: strategyHash,
    reportSha256: reportHash, termsSha256: termsHash, ...overrides,
  }
  return {
    address,
    topics: encodeEventTopics({ abi: LICENSE_MARKET_ABI, eventName: 'LicensePurchased', args: event }),
    data: encodeAbiParameters(parseAbiParameters('uint256,bytes32,bytes32,bytes32'), [
      event.paidPrice6, event.strategySha256, event.reportSha256, event.termsSha256,
    ]),
  }
}

function listingLog(overrides = {}, address = marketAddress) {
  const event = { listingId: 9n, seller, ...input, ...overrides }
  return {
    address,
    topics: encodeEventTopics({ abi: LICENSE_MARKET_ABI, eventName: 'ListingCreated', args: event }),
    data: encodeAbiParameters(parseAbiParameters('bytes32,bytes32,bytes32,uint256,string,string'), [
      event.strategySha256, event.reportSha256, event.termsSha256,
      event.price6, event.artifactURI, event.reportURI,
    ]),
  }
}

test('unregistered arbitrary contract addresses cannot enable wallet transactions', () => {
  assert.equal(LICENSE_MARKET_DEPLOYMENTS.length, 0)
  assert.ok(Object.isFrozen(LICENSE_MARKET_DEPLOYMENTS))
  for (const key of [undefined, '', 'reviewed-rehearsal', marketAddress, 'https://example.com']) {
    assert.throws(() => requireLicenseDeployment(key), /No reviewed marketplace deployment/)
  }
  for (const changed of [
    { chainId: 1 }, { address: ARC_USDC_ADDRESS }, { address: '0x0000000000000000000000000000000000000000' },
    { address: 'bad' }, { runtimeCodeHash: hash('0') }, { sourceSha256: '0x12' }, { key: '../../untrusted' },
  ]) assert.throws(() => validateLicenseDeployment({ ...deployment, ...changed }))
  assert.ok(Object.isFrozen(validateLicenseDeployment(deployment)))
})

test('payment amounts preserve exact six-decimal units and reject rounding, exponents, negatives and oversized payments', () => {
  for (const [text, exact] of [['0.000001', 1n], ['7.500001', 7_500_001n], ['1000000', MAX_LICENSE_PRICE6]]) {
    assert.equal(parseLicensePrice(text), exact)
    assert.equal(parseLicensePrice(formatLicensePrice(exact)), exact)
  }
  for (const invalid of ['', '0', '-1', '+1', '01', '1e2', 'NaN', 'Infinity', ' 1 ', '1.0000001', '1000000.000001', '1000001', 7.5]) {
    assert.throws(() => parseLicensePrice(invalid))
  }
  for (const invalid of [1, 0n, -1n, MAX_LICENSE_PRICE6 + 1n]) assert.throws(() => assertLicensePrice(invalid))
  for (const invalid of [0n, -1n, 1, 2n ** 256n]) assert.throws(() => assertListingId(invalid))
  assertListingId(2n ** 256n - 1n)
})

test('listing creation requires all commitments, bounded immutable inputs and non-executable content URLs', () => {
  const reviewed = validateCreateListing(input)
  assert.ok(Object.isFrozen(reviewed))
  for (const field of ['strategySha256', 'reportSha256', 'termsSha256']) {
    for (const digest of [hash('0'), '11'.repeat(32), '0x1234', undefined]) {
      assert.throws(() => validateCreateListing({ ...input, [field]: digest }))
    }
  }
  for (const uri of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a', 'http://example.com/a',
    'https://user:password@example.com/a', 'https://example.com/a b', 'ipfs://', 'https://example.com/\nhi',
    `https://example.com/${'한'.repeat(800)}`]) assert.throws(() => assertLicenseURI(uri))
  assertLicenseURI('https://example.com/report.json')
  assertLicenseURI('ipfs://bafyExample/report.json')
  assertLicenseHash(hash('a'))
})

test('RPC reads verify the actual chain, reviewed runtime code, fixed token and both precisions at a single block', async () => {
  const client = rpc()
  const snapshot = await readVerifiedLicenseMarket(client, deployment, 9n, buyer)
  assert.equal(snapshot.chainId, 5042002)
  assert.equal(snapshot.listingId, 9n)
  assert.equal(snapshot.account, buyer)
  assert.equal(snapshot.listing.price6, price6)
  assert.equal(snapshot.hasLicense, false)
  assert.deepEqual(snapshot.purchase, { paidPrice6: 0n, purchasedAt: 0n })
  assert.equal(snapshot.balance6, 100_000_000n)
  assert.equal(snapshot.allowance6, price6)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.listing))
  assert.ok(Object.isFrozen(snapshot.purchase))
  assert.deepEqual(client.calls.find(call => call.method === 'getBlockNumber').options, { cacheTime: 0 })
  for (const call of client.calls.filter(call => ['readContract', 'getBytecode'].includes(call.method))) {
    assert.equal(call.blockNumber, 123n)
  }
  assert.equal(client.calls.find(call => call.functionName === 'decimals').address, ARC_USDC_ADDRESS)
  assert.deepEqual(client.calls.find(call => call.functionName === 'allowance').args, [buyer, marketAddress])
  assert.deepEqual(client.calls.find(call => call.functionName === 'hasLicense').args, [9n, buyer])
})

test('wrong or switching RPC chain, absent or changed code and token mismatches fail closed', async () => {
  for (const overrides of [
    { chainId: 1 }, { chainIds: [5042002, 5042] }, { bytecode: '0x' }, { bytecode: '0x60006001' },
    { values: { expectedChainId: 5042n } }, { values: { USDC: other } },
    { values: { USDC_DECIMALS: 18 } }, { values: { decimals: 18 } },
    { failFunction: 'getListing' },
  ]) await assert.rejects(read(overrides))
})

test('public listing and balance reads work without a connected wallet and never fabricate entitlement', async () => {
  const client = rpc()
  const anonymous = await readVerifiedLicenseMarket(client, deployment, 9n)
  assert.equal(anonymous.account, null)
  assert.equal(anonymous.hasLicense, false)
  assert.equal(anonymous.purchase, null)
  assert.equal(anonymous.balance6, null)
  assert.equal(anonymous.allowance6, null)
  assert.equal(client.calls.filter(call => ['hasLicense', 'purchases', 'balanceOf', 'allowance'].includes(call.functionName)).length, 0)
  const marketOnly = await readVerifiedLicenseMarket(rpc(), deployment, undefined, buyer)
  assert.equal(marketOnly.listingId, null)
  assert.equal(marketOnly.listing, null)
  assert.equal(marketOnly.hasLicense, false)
})

test('entitlement requires an agreeing purchase price and timestamp; RPC inconsistency is never reported as a license', async () => {
  assert.equal((await licensedRead()).hasLicense, true)
  for (const values of [
    { hasLicense: true, purchases: [0n, 0n] },
    { hasLicense: false, purchases: [price6, 123456n] },
    { hasLicense: true, purchases: [price6 - 1n, 123456n] },
    { hasLicense: true, purchases: [price6, 0n] },
    { hasLicense: false, purchases: [0n, 123456n] },
  ]) await assert.rejects(read({ values }), /do not agree/)
})

test('wallet requests require the selected network and account, plus an explicit mainnet acknowledgement', () => {
  assertWalletContext(deployment, 5042002, buyer, buyer)
  assert.throws(() => assertWalletContext(deployment, 1, buyer, buyer), /Switch your wallet/)
  assert.throws(() => assertWalletContext(deployment, 5042002, other, buyer), /account changed/)
  assert.throws(() => assertWalletContext(deployment, 5042002, undefined, buyer), /account changed/)
  const mainnet = { ...deployment, chainId: 5042 }
  assert.throws(() => assertWalletContext(mainnet, 5042, buyer, buyer), /Acknowledge/)
  assertWalletContext(mainnet, 5042, buyer, buyer, true)
})

test('purchase guard rejects self-purchase, duplicates, paused sales, mismatched versions and inadequate funds/allowance', async () => {
  const snapshot = await read()
  assertLicenseBuyable(snapshot, 9n, price6, strategyHash, buyer)
  for (const changed of [
    { account: other }, { listingId: 8n }, { listing: null }, { hasLicense: true },
    { listing: { ...listing, seller: buyer } }, { listing: { ...listing, salesPaused: true } },
    { listing: { ...listing, strategySha256: termsHash } }, { listing: { ...listing, price6: price6 + 1n } },
    { balance6: price6 - 1n }, { balance6: null }, { allowance6: price6 - 1n }, { allowance6: null },
  ]) assert.throws(() => assertLicenseBuyable({ ...snapshot, ...changed }, 9n, price6, strategyHash, buyer))
})

test('a successful receipt alone cannot establish a license; entitlement, exact purchase, event origin and committed terms must all match', async () => {
  const snapshot = await licensedRead()
  const receipt = { status: 'success', logs: [purchaseLog()] }
  assertConfirmedLicensePurchase(receipt, deployment, snapshot, 9n, price6, strategyHash, buyer)
  for (const badReceipt of [
    { ...receipt, status: 'reverted' }, { ...receipt, logs: [] },
    { ...receipt, logs: [purchaseLog({}, other)] }, { ...receipt, logs: [purchaseLog(), purchaseLog()] },
    { ...receipt, logs: [purchaseLog({ listingId: 8n })] }, { ...receipt, logs: [purchaseLog({ buyer: other })] },
    { ...receipt, logs: [purchaseLog({ seller: other })] }, { ...receipt, logs: [purchaseLog({ paidPrice6: price6 - 1n })] },
    { ...receipt, logs: [purchaseLog({ reportSha256: termsHash })] },
    { ...receipt, logs: [purchaseLog({ termsSha256: reportHash })] },
  ]) assert.throws(() => assertConfirmedLicensePurchase(badReceipt, deployment, snapshot, 9n, price6, strategyHash, buyer))
  for (const changed of [
    { chainId: 5042 }, { account: other }, { marketAddress: other }, { deploymentKey: 'other' },
    { hasLicense: false }, { purchase: null }, { purchase: { paidPrice6: price6 - 1n, purchasedAt: 123456n } },
  ]) assert.throws(() => assertConfirmedLicensePurchase(receipt, deployment, { ...snapshot, ...changed }, 9n, price6, strategyHash, buyer))
})

test('a newly created listing ID comes only from one exact confirmed event emitted by the registered contract', () => {
  const receipt = { status: 'success', logs: [listingLog()] }
  assert.equal(createdLicenseListingId(receipt, deployment, seller, input), 9n)
  for (const badReceipt of [
    { ...receipt, status: 'reverted' }, { ...receipt, logs: [] },
    { ...receipt, logs: [listingLog({}, other)] }, { ...receipt, logs: [listingLog(), listingLog()] },
    { ...receipt, logs: [listingLog({ seller: other })] },
    { ...receipt, logs: [listingLog({ termsSha256: reportHash })] },
    { ...receipt, logs: [listingLog({ artifactURI: 'https://example.com/changed' })] },
    { ...receipt, logs: [listingLog({ price6: price6 + 1n })] },
  ]) assert.throws(() => createdLicenseListingId(badReceipt, deployment, seller, input))
})

test('approval confirmation requires an exact real token event; an unrelated successful replacement cannot count', () => {
  const makeLog = (overrides = {}, address = ARC_USDC_ADDRESS) => {
    const event = { owner: buyer, spender: marketAddress, value: price6, ...overrides }
    return {
      address,
      topics: encodeEventTopics({ abi: TOKEN_READ_ABI, eventName: 'Approval', args: event }),
      data: encodeAbiParameters(parseAbiParameters('uint256'), [event.value]),
    }
  }
  const receipt = { status: 'success', logs: [makeLog()] }
  assertConfirmedLicenseApproval(receipt, deployment, buyer, price6)
  for (const invalid of [
    { ...receipt, status: 'reverted' }, { ...receipt, logs: [] },
    { ...receipt, logs: [makeLog({}, other)] }, { ...receipt, logs: [makeLog({ owner: other })] },
    { ...receipt, logs: [makeLog({ spender: other })] }, { ...receipt, logs: [makeLog({ value: price6 - 1n })] },
    { ...receipt, logs: [makeLog(), makeLog()] },
  ]) assert.throws(() => assertConfirmedLicenseApproval(invalid, deployment, buyer, price6))
})

test('transaction links are chain-specific and require a valid transaction hash', () => {
  assert.equal(licenseTransactionUrl(5042002, hash('a')), `https://explorer.testnet.arc.io/tx/${hash('a')}`)
  assert.equal(licenseTransactionUrl(5042, hash('a')), `https://explorer.arc.io/tx/${hash('a')}`)
  assert.throws(() => licenseTransactionUrl(5042, '0x1234'))
})
