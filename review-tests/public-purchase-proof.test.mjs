import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeEventTopics, encodeAbiParameters, parseAbiParameters, erc20Abi } from 'viem'
import { parsePublicSelection, publicLink } from '../src/marketplace/publicLinks.ts'
import { verifyPurchaseMovement } from '../src/marketplace/purchaseProof.ts'
import { LICENSE_MARKET_ABI, ARC_USDC_ADDRESS } from '../src/marketplace/licenseMarket.ts'
const market='0x1000000000000000000000000000000000000001',buyer='0x2000000000000000000000000000000000000002',seller='0x3000000000000000000000000000000000000003'
const hash = n => `0x${String(n).repeat(64)}`
const deployment={key:'mainnet-proof-test',address:market,chainId:5042}
const listing={seller,price6:100000n,strategySha256:hash(1),reportSha256:hash(2),termsSha256:hash(3)}
const snapshot={deploymentKey:deployment.key,chainId:5042,marketAddress:market,listingId:1n,account:buyer,listing,hasLicense:true,purchase:{paidPrice6:100000n,purchasedAt:100n}}
const purchase={address:market,topics:encodeEventTopics({abi:LICENSE_MARKET_ABI,eventName:'LicensePurchased',args:{listingId:1n,buyer,seller}}),data:encodeAbiParameters(parseAbiParameters('uint256,bytes32,bytes32,bytes32'),[100000n,hash(1),hash(2),hash(3)])}
function transfer(value=100000n,from=buyer,to=seller,address=ARC_USDC_ADDRESS){return{address,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters(parseAbiParameters('uint256'),[value])}}

test('public links retain only explicit public selection, never preview credentials',()=>{
  const selection={chainId:5042,market,listingId:1n,transaction:hash(4)}
  const url=publicLink('https://lab.example.com/?session=PRIVATE&token=PRIVATE#private',selection)
  assert.ok(!url.includes('PRIVATE'));assert.deepEqual(parsePublicSelection(new URL(url).search),selection)
  assert.equal(parsePublicSelection('?foo=bar'),null)
})
test('ambiguous networks, injected addresses, malformed IDs and hashes are rejected',()=>{
  for(const search of [`?chain=1&market=${market}`,`?chain=5042&market=${market}&chain=5042002`,`?chain=5042&market=javascript:alert(1)`,`?chain=5042&market=${market}&listing=-1`,`?chain=5042&market=${market}&listing=1e3`,`?chain=5042&market=${market}&tx=0x123`])assert.throws(()=>parsePublicSelection(search))
  assert.throws(()=>publicLink('https://user:password@example.com', {chainId:5042,market}))
  assert.throws(()=>publicLink('https://abc.preview.studio.arc.io/?token=private', {chainId:5042,market}),/published app/)
})
test('purchase proof requires the exact actual USDC movement as well as entitlement and purchase event',()=>{
  const good={status:'success',logs:[purchase,transfer()]}
  assert.equal(verifyPurchaseMovement(good,deployment,snapshot).paidPrice6,100000n)
  for(const logs of [[purchase],[purchase,transfer(99999n)],[purchase,transfer(100000n,seller,buyer)],[purchase,transfer(100000n,buyer,seller,market)],[purchase,transfer(),transfer()]])assert.throws(()=>verifyPurchaseMovement({...good,logs},deployment,snapshot),/exact buyer-to-seller/)
  assert.throws(()=>verifyPurchaseMovement(good,deployment,{...snapshot,hasLicense:false}),/insufficient/)
  assert.throws(()=>verifyPurchaseMovement({...good,status:'reverted'},deployment,snapshot),/did not succeed/)
})
