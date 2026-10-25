// User-authorized disposable TESTNET ONLY rehearsal. Private keys stay in process memory.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem'
import { arcTestnet } from 'viem/chains'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { deploymentData, rpc, readVault, VAULT_ABI, USDC, verifyContract } from '../src/onchain/contracts.ts'
import { nextBotSignal } from '../src/onchain/botSignal.ts'
import { startCandleBoundary } from '../src/trading/liveGuards.ts'
import { parseMarketCandles, KLINES_URL } from '../src/trading/marketCandles.ts'
import { createStrategyPackage, exportStrategyPackage } from '../src/marketplace/strategyPackage.ts'

const CHAIN=5042002
if(arcTestnet.id!==CHAIN)throw new Error('TESTNET ONLY')
const client=rpc(CHAIN),owner=privateKeyToAccount(generatePrivateKey()),session=privateKeyToAccount(generatePrivateKey())
const wallet=a=>createWalletClient({account:a,chain:arcTestnet,transport:http()})
const folder=resolve(import.meta.dirname,'../../release-review/public-testnet')
await mkdir(folder,{recursive:true})
const report={schema:'arc-tradelab.public-testnet-rehearsal.v1',chainId:CHAIN,startedAt:new Date().toISOString(),owner:owner.address,session:session.address,status:'awaiting_faucet',contract:null,transactions:[],fills:[],candleEvaluations:[],disclosure:'Disposable generated test wallets. Test USDC only; virtual BTC. Public live BTC data, not an authenticated oracle. This Node rehearsal uses the same bot-signal module and compiled contract as the browser; it is not a browser-wallet end-to-end test. No mainnet transaction or real-money performance.'}
const serialize=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)
const save=async()=>writeFile(resolve(folder,'run.json'),serialize(report))
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function chain(){if(await client.getChainId()!==CHAIN)throw new Error('RPC mismatch; refusing to sign')}
async function send(account,request,label){
  await chain()
  const fees=await client.estimateFeesPerGas()
  const gas=(await client.estimateGas({...request,account:account.address}))*12n/10n
  if(gas*fees.maxFeePerGas>parseUnits('2',18))throw new Error('Test transaction gas exceeds 2 test USDC cap')
  const hash=await wallet(account).sendTransaction({...request,gas,...fees})
  report.transactions.push({label,hash,status:'pending'});await save()
  const receipt=await client.waitForTransactionReceipt({hash,timeout:120000})
  Object.assign(report.transactions.at(-1),{status:receipt.status,blockNumber:receipt.blockNumber,gasUSDC:formatUnits(receipt.gasUsed*receipt.effectiveGasPrice,18)})
  await save();if(receipt.status!=='success')throw new Error(`${label} reverted`)
  console.log(`${label}: https://explorer.testnet.arc.io/tx/${hash}`)
  return receipt
}
const {encodeFunctionData}=await import('viem')
async function call(account,address,abi,functionName,args,label){
  await client.simulateContract({account,address,abi,functionName,args})
  return send(account,{to:address,data:encodeFunctionData({abi,functionName,args}),value:0n},label)
}
await chain();await save();console.log(`Generated TESTNET faucet address: ${owner.address}`)
let address
try{
  const fundingDeadline=Date.now()+20*60000
  while(await client.getBalance({address:owner.address})<parseUnits('12',18)){
    if(Date.now()>fundingDeadline)throw new Error('Faucet funding timed out; no contract deployed')
    await sleep(5000)
  }
  report.status='funded';report.initialBalance=await client.getBalance({address:owner.address});await save()
  const pkg=await createStrategyPackage({name:'Arc live execution check',version:'1.0.0',config:{shortPeriod:2,longPeriod:3,candleIntervalMs:60000,orderSizeUsdc:1,maxAllocationPct:80,stopLossPct:5}})
  await writeFile(resolve(folder,'strategy.json'),exportStrategyPackage(pkg))
  report.strategy=pkg
  const rules={strategyHash:`0x${pkg.digest.value.replace(/^0x/,'')}`,budget6:5000000n,reserve6:5000000n,order6:1000000n,allocationBps:8000,shortPeriod:2,longPeriod:3,stopLossBps:500}
  const receipt=await send(owner,{data:deploymentData('TestnetBotVault',CHAIN,[owner.address,session.address,rules]),value:0n},'Deploy test vault')
  address=receipt.contractAddress;if(!address)throw new Error('Missing deployment address')
  report.contract=address;await verifyContract('TestnetBotVault',CHAIN,address)
  await call(owner,USDC,erc20Abi,'approve',[address,10000000n],'Approve exact 10 test USDC')
  await call(owner,address,VAULT_ABI,'fund',[],'Fund cash and reserve')
  await send(owner,{to:session.address,value:parseUnits('0.10',18)},'Fund bounded session gas')
  let boundary=startCandleBoundary(Date.now(),0),snapshot=await readVault(address)
  report.status='watching_live_candles';await save();console.log('Watching NEW live one-minute SMA 2/3 signals. No historical replay.')
  const deadline=Date.now()+30*60000
  while(Date.now()<deadline && report.fills.length<4){
    const remaining=60000-Date.now()%60000+1500;await sleep(remaining)
    const response=await fetch(KLINES_URL,{signal:AbortSignal.timeout(10000),cache:'no-store'})
    if(!response.ok)throw new Error('Market candle fetch failed')
    const received=Date.now(),candles=parseMarketCandles(await response.json(),received).filter(c=>c.closed)
    snapshot=await readVault(address)
    const decision=nextBotSignal(snapshot,candles,boundary,Date.now())
    if(!decision)continue
    boundary=decision.candle
    report.candleEvaluations.push({candle:decision.candle,side:decision.side,observedAt:received,lastCandles:candles.slice(-5)})
    await save();if(!decision.side)continue
    const priceResponse=await fetch('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT',{signal:AbortSignal.timeout(5000),cache:'no-store'})
    if(!priceResponse.ok)throw new Error('Market quote fetch failed')
    const quote=await priceResponse.json(),observedAt=Date.now(),price=Number(quote.price)
    if(quote.symbol!=='BTCUSDT'||!Number.isFinite(price)||price<=0)throw new Error('Invalid BTC quote')
    const args=[decision.side==='buy',parseUnits(price.toFixed(6),6),BigInt(decision.candle/1000),BigInt(Math.floor(observedAt/1000)),snapshot.state.sequence+1n]
    const fill=await call(session,address,VAULT_ABI,'execute',args,`Automatic ${decision.side}`)
    report.fills.push({side:decision.side,hash:fill.transactionHash,blockNumber:fill.blockNumber,quote6:args[1],candle:args[2],observedAt:args[3],sequence:args[4]})
    report.snapshot=await readVault(address);await save()
    if(report.fills.some(f=>f.side==='buy')&&report.fills.some(f=>f.side==='sell'))break
  }
  report.status=report.fills.some(f=>f.side==='buy')&&report.fills.some(f=>f.side==='sell')?'buy_sell_verified':'time_limit_no_complete_cycle'
}catch(e){report.status='error';report.error=e instanceof Error?e.message:'Test failed';console.log(report.error)}
finally{
  if(address){try{const current=await readVault(address);if(!current.state.closed)await call(owner,address,VAULT_ABI,'close',[],'Close and recover test funds');report.snapshot=await readVault(address);const logs=await client.getContractEvents({address,abi:VAULT_ABI,eventName:'Fill',fromBlock:report.snapshot.creationBlock,toBlock:report.snapshot.blockNumber,strict:true});report.verifiedEvents=logs;if(BigInt(logs.length)!==report.snapshot.state.sequence)throw new Error('Incomplete event history')}catch(e){report.recoveryError=e instanceof Error?e.message:'Recovery failed'}}
  report.finishedAt=new Date().toISOString();await save();console.log(`Public testnet outcome: ${report.status}; verified fills: ${report.verifiedEvents?.length??0}`)
}
