import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { blobEvidenceHandler } from '../server/blobEvidence.mjs'
import { createStrategyPackage } from '../src/marketplace/strategyPackage.ts'
import { preparePublication, exportPublicationBundle } from '../src/marketplace/publication.ts'
import { runSmaBacktest } from '../src/trading/backtest.ts'
const sha = text => createHash('sha256').update(text).digest('hex')
const origin='https://lab.example.com'
async function fixture(){
  const strategy=await createStrategyPackage({name:'Synthetic server test',version:'1.0.0',config:{shortPeriod:2,longPeriod:3,candleIntervalMs:60000,orderSizeUsdc:10,maxAllocationPct:80,stopLossPct:5}})
  const dataset={source:'Binance' /* schema label only; all candles here are synthetic */,symbol:'BTCUSDT',quoteCurrency:'USDT',retrievedAt:'2026-10-18T00:00:00Z',candles:[100,100,100,99,105,106,90,89,110,111].map((close,i)=>({openTime:i*60000,open:close,high:close+1,low:close-1,close}))}
  const datasetText=JSON.stringify(dataset),config={shortPeriod:2,longPeriod:3,intervalMs:60000,initialCash:100,orderCash:10,maxAllocationPct:80,stopLossPct:5,feeBps:10,slippageBps:5}
  const content={...runSmaBacktest(dataset,config),inputSha256:sha(datasetText),strategyPackage:strategy}
  return exportPublicationBundle(await preparePublication({strategy,datasetText,reportText:JSON.stringify({...content,reportSha256:sha(JSON.stringify(content))}),termsText:'Synthetic local test only. Not a sale or market evidence.'}))
}
function memoryStore(){
  const values=new Map();let version=0
  return{values,async get(k,o){const v=values.get(k);return v ? o?.type==='json'?JSON.parse(v.text):v.text : null},async getWithMetadata(k){const v=values.get(k);return v?{data:JSON.parse(v.text),etag:v.etag}:null},async set(k,text,o={}){const old=values.get(k);if((o.onlyIfNew&&old)||(o.onlyIfMatch&&old?.etag!==o.onlyIfMatch))return{modified:false};const etag=String(++version);values.set(k,{text,etag});return{modified:true,etag}},async setJSON(k,v,o){return this.set(k,JSON.stringify(v),o)}}
}
function setup(options={}){
  const store=memoryStore();let time=Date.now()
  const wallet=privateKeyToAccount(generatePrivateKey())
  // A new handler for EVERY request models cold starts; persistent store alone carries state.
  const call=async(path,data,extra={})=>{
    const handler=blobEvidenceHandler({store,origin,now:()=>time,...options})
    const response=await handler(new Request(`${origin}${path}`,{method:data?'POST':'GET',headers:{origin,'content-type':'application/json',...extra.headers},...(data?{body:JSON.stringify(data)}:{})}),'unit-test-ip')
    return{status:response.status,json:await response.json(),headers:response.headers}
  }
  const authorize=async bundle=>{const {json:c}=await call('/api/evidence/challenge',{address:wallet.address,digest:sha(bundle)});return{nonce:c.nonce,signature:await wallet.signMessage({message:c.message}),bundle}}
  return{store,wallet,call,authorize,advance:ms=>time+=ms}
}
test('durable blob publication survives cold starts and exact files are publicly readable',async()=>{
  const s=setup(),bundle=await fixture();const r=await s.call('/api/evidence/publish',await s.authorize(bundle));assert.equal(r.status,201,JSON.stringify(r.json))
  assert.equal(r.json.artifactURI,`${origin}/evidence/${sha(bundle)}.json`)
  const read=await s.call(`/evidence/${sha(bundle)}.json`);assert.equal(read.status,200);assert.deepEqual(read.json,JSON.parse(bundle));assert.equal(read.headers.get('access-control-allow-origin'),'*')
})
test('concurrent replay consumes a nonce exactly once across independent handlers',async()=>{
  const s=setup(),bundle=await fixture(),auth=await s.authorize(bundle)
  const results=await Promise.all([s.call('/api/evidence/publish',auth),s.call('/api/evidence/publish',auth)])
  assert.deepEqual(results.map(r=>r.status).sort(),[201,400])
})
test('concurrent uploads cannot exceed the durable storage quota',async()=>{
  const s=setup({maxFiles:2}),bundle=await fixture();const a=await s.authorize(bundle),b=await s.authorize(bundle)
  const results=await Promise.all([s.call('/api/evidence/publish',a),s.call('/api/evidence/publish',b)])
  assert.deepEqual(results.map(r=>r.status).sort(),[201,400]);assert.equal(JSON.parse(s.store.values.get('control-v1').text).files,2)
})
test('cross-origin, expired, altered and incorrectly signed upload intents are rejected',async()=>{
  const s=setup(),bundle=await fixture()
  assert.equal((await s.call('/api/evidence/challenge',{address:s.wallet.address,digest:sha(bundle)},{headers:{origin:'https://evil.example'}})).status,403)
  const auth=await s.authorize(bundle);s.advance(300001);assert.equal((await s.call('/api/evidence/publish',auth)).status,400)
  const next=await s.authorize(bundle);assert.equal((await s.call('/api/evidence/publish',{...next,bundle:bundle+' '})).status,400)
  const bad=await s.authorize(bundle);const other=privateKeyToAccount(generatePrivateKey());bad.signature=await other.signMessage({message:'not the upload'});assert.equal((await s.call('/api/evidence/publish',bad)).status,400)
})
test('signed fabricated results and content-address corruption are rejected',async()=>{
  const s=setup(),data=JSON.parse(await fixture()),report=JSON.parse(data.reportText);report.returnPct=999
  const{reportSha256:_,...content}=report;data.reportText=JSON.stringify({...content,reportSha256:sha(JSON.stringify(content))});const bad=JSON.stringify(data)
  assert.equal((await s.call('/api/evidence/publish',await s.authorize(bad))).status,400)
  s.store.values.set(`files/${'a'.repeat(64)}`,{text:'{}',etag:'1'});assert.equal((await s.call(`/evidence/${'a'.repeat(64)}.json`)).status,400)
})
test('rate limits survive cold starts and host status includes its actual upload limit',async()=>{
  const s=setup();for(let i=0;i<10;i++)assert.equal((await s.call('/api/evidence/challenge',{address:s.wallet.address,digest:'a'.repeat(64)})).status,200)
  assert.equal((await s.call('/api/evidence/challenge',{address:s.wallet.address,digest:'a'.repeat(64)})).status,400)
  assert.equal((await s.call('/api/evidence/status')).json.maxBundleBytes,2*1024*1024)
  assert.equal((await s.call('/evidence/not-a-hash.json')).status,403)
})
test('missing storage ETags fail closed instead of allowing unconditional quota or nonce writes',async()=>{
  const s=setup();s.store.values.set('control-v1',{text:JSON.stringify({challenges:{},attempts:{},files:0,bytes:0})})
  const result=await s.call('/api/evidence/challenge',{address:s.wallet.address,digest:'a'.repeat(64)})
  assert.equal(result.status,400);assert.match(result.json.error,/safely coordinate/)
})

