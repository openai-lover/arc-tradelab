// Isolated LOCAL EVM rehearsal. Public Anvil unlocked accounts, never user keys.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createPublicClient, createWalletClient, erc20Abi, http, keccak256, parseAbi } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import compiled from '../src/onchain/compiled.json' with { type: 'json' }
import { VAULT_ABI } from '../src/onchain/contracts.ts'
import { LICENSE_MARKET_ABI, readVerifiedLicenseMarket, assertConfirmedLicensePurchase, createdLicenseListingId } from '../src/marketplace/licenseMarket.ts'
import { verifyPurchaseMovement } from '../src/marketplace/purchaseProof.ts'
const anvil = process.env.ANVIL_BINARY ?? (process.platform === 'win32' ? resolve(import.meta.dirname, '../../contract-tools/foundry-v1.8.5/anvil.exe') : 'anvil')
const token = JSON.parse(readFileSync(resolve(import.meta.dirname, '../contract-tools/out/TestnetBotVault.t.sol/BotMockUSDC.json'), 'utf8'))
const USDC = '0x3600000000000000000000000000000000000000'
const hash = `0x${'12'.repeat(32)}`
for (const chain of [arcTestnet, arc]) {
  const child = spawn(anvil, ['--host', '127.0.0.1', '--port', '18545', '--chain-id', String(chain.id), '--silent'], { windowsHide: true, stdio: 'ignore' })
  try {
    const transport = http('http://127.0.0.1:18545', { retryCount: 0 })
    const client = createPublicClient({ chain, transport, pollingInterval: 30 })
    for (let i=0;i<40;i++) { try { await client.getChainId(); break } catch { await new Promise(r => setTimeout(r, 100)) } }
    assert.equal(await client.getChainId(), chain.id)
    const [owner, session, buyer] = await client.request({ method: 'eth_accounts' })
    const wallet = a => createWalletClient({ account: a, chain, transport })
    const confirmed = async h => { const r = await client.waitForTransactionReceipt({ hash: await h }); assert.equal(r.status, 'success'); return r }
    await client.request({ method: 'anvil_setCode', params: [USDC, token.deployedBytecode.object] })
    await confirmed(wallet(owner).writeContract({ address: USDC, abi: token.abi, functionName: 'mint', args: [owner, 1000000000n] }))
    await confirmed(wallet(owner).writeContract({ address: USDC, abi: token.abi, functionName: 'mint', args: [buyer, 1000000n] }))
    if (chain.id === 5042002) {
      const r = { strategyHash: hash, budget6: 100000000n, reserve6: 50000000n, order6: 10000000n, allocationBps: 8000, shortPeriod: 5, longPeriod: 20, stopLossBps: 500 }
      const deployed = await confirmed(wallet(owner).deployContract({ abi: compiled.TestnetBotVault.abi, bytecode: compiled.TestnetBotVault.bytecode, args: [owner, session, r] }))
      const address = deployed.contractAddress
      assert.equal(keccak256(await client.getCode({ address })), compiled.TestnetBotVault.runtimeHashes[chain.id])
      await confirmed(wallet(owner).writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [address, 150000000n] }))
      await confirmed(wallet(owner).writeContract({ address, abi: VAULT_ABI, functionName: 'fund' }))
      let now = Number((await client.getBlock()).timestamp)
      let candle = Math.floor(now/60)*60
      for (const [index, buy, price] of [[1, true, 50000n], [2, false, 55000n]]) {
        await client.request({ method: 'evm_setNextBlockTimestamp', params: [candle+62] })
        await confirmed(wallet(session).writeContract({ address, abi: VAULT_ABI, functionName: 'execute', args: [buy, price*1000000n, BigInt(candle), BigInt(candle+60), BigInt(index)], gas: 900000n }))
        candle += 60
      }
      const state = await client.readContract({ address, abi: VAULT_ABI, functionName: 'getState' })
      assert.equal(state.sequence, 2n); assert.equal(state.btc8, 0n); assert.ok(state.realized6 > 0n)
      const logs = await client.getContractEvents({ address, abi: VAULT_ABI, eventName: 'Fill', fromBlock: deployed.blockNumber, strict: true })
      assert.equal(logs.length, 2); assert.ok(logs.every(l => l.transactionHash))
      await confirmed(wallet(owner).writeContract({ address, abi: VAULT_ABI, functionName: 'close' }))
      assert.equal(await client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }), 1000000000n)
      console.log('LOCAL testnet configuration: deployment runtime, funding, session buy/sell, actual mock-token transfers, events and owner recovery passed.')
    }
    const deployed = await confirmed(wallet(owner).deployContract({ abi: compiled.StrategyLicenseMarket.abi, bytecode: compiled.StrategyLicenseMarket.bytecode, args: [BigInt(chain.id)] }))
    const address = deployed.contractAddress
    assert.equal(keccak256(await client.getCode({ address })), compiled.StrategyLicenseMarket.runtimeHashes[chain.id])
    const deployment = { key: `local-${chain.id}`, label: 'Local rehearsal', chainId: chain.id, address,
      runtimeCodeHash: compiled.StrategyLicenseMarket.runtimeHashes[chain.id], sourceSha256: compiled.StrategyLicenseMarket.sourceSha256 }
    const input = { strategySha256: hash, reportSha256: hash, termsSha256: hash, price6: 100000n, artifactURI: 'https://example.com/local-fixture.json', reportURI: 'https://example.com/report.json' }
    const listingReceipt = await confirmed(wallet(owner).writeContract({ address, abi: LICENSE_MARKET_ABI, functionName: 'createListing', args: Object.values(input) }))
    const id = createdLicenseListingId(listingReceipt, deployment, owner, input)
    await confirmed(wallet(buyer).writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [address, input.price6] }))
    const receipt = await confirmed(wallet(buyer).writeContract({ address, abi: LICENSE_MARKET_ABI, functionName: 'buyLicense', args: [id, input.price6, hash] }))
    const snapshot = await readVerifiedLicenseMarket(client, deployment, id, buyer)
    assertConfirmedLicensePurchase(receipt, deployment, snapshot, id, input.price6, hash, buyer)
    verifyPurchaseMovement(receipt, deployment, snapshot)
    assert.equal(snapshot.hasLicense, true); assert.equal(snapshot.purchase.paidPrice6, input.price6)
    assert.equal(snapshot.balance6, 900000n)
    console.log(`LOCAL chain ${chain.id}: exact runtime, seller listing, exact allowance, buyer payment, event and authoritative entitlement passed.`)
  } finally { child.kill(); await new Promise(r => child.once('exit', r)) }
}
console.log('All integration checks passed on isolated localhost EVMs. NO public-chain deployments or real USDC transactions.')
