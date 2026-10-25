import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { evidenceHandler } from '../server/evidence.mjs'
import { createStrategyPackage } from '../src/marketplace/strategyPackage.ts'
import { preparePublication, exportPublicationBundle } from '../src/marketplace/publication.ts'
import { runSmaBacktest } from '../src/trading/backtest.ts'
const sha = text => createHash('sha256').update(text).digest('hex')
async function fixture() {
  const strategy = await createStrategyPackage({ name: 'LOCAL synthetic upload test', version: '1.0.0', config: { shortPeriod: 2, longPeriod: 3, candleIntervalMs: 60000, orderSizeUsdc: 10, maxAllocationPct: 80, stopLossPct: 5 } })
  const dataset = { source: 'Binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT', retrievedAt: '2026-10-18T00:00:00Z', candles: [100,100,100,99,105,106,90,89,110,111].map((close,i)=>({openTime:i*60000,open:close,high:close+1,low:close-1,close})) }
  const datasetText = JSON.stringify(dataset)
  const config = { shortPeriod: 2, longPeriod: 3, intervalMs: 60000, initialCash: 100, orderCash: 10, maxAllocationPct: 80, stopLossPct: 5, feeBps: 10, slippageBps: 5 }
  const content = { ...runSmaBacktest(dataset,config), inputSha256: sha(datasetText), strategyPackage: strategy }
  const reportText = JSON.stringify({ ...content, reportSha256: sha(JSON.stringify(content)) })
  return exportPublicationBundle(await preparePublication({ strategy, datasetText, reportText, termsText: 'LOCAL TEST ONLY. Synthetic fixture, not market evidence or a sale.' }))
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'arc-evidence-test-'))
  const handler = evidenceHandler({ directory, origin: 'https://lab.example.com' })
  const wallet = privateKeyToAccount(generatePrivateKey()) // Generated test identity; never persisted.
  const call = async (path, data, origin = 'https://lab.example.com') => {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))])
    Object.assign(req, { url: path, method: data === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json' }, socket: { remoteAddress: 'local-unit-test' } })
    let status; let text; let headers
    await handler(req, { writeHead(s,h) { status=s; headers=h }, end(b) { text=String(b) } })
    return { status, text, headers, json: JSON.parse(text) }
  }
  const authorize = async bundle => {
    const challenge = (await call('/api/evidence/challenge', { address: wallet.address, digest: sha(bundle) })).json
    return { nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }), bundle }
  }
  return { directory, wallet, call, authorize }
}
test('signed exact evidence upload is recalculated, stored immutably and publicly readable', async () => {
  const s=await setup(); const bundle=await fixture(); const result=await s.call('/api/evidence/publish', await s.authorize(bundle))
  assert.equal(result.status,201)
  assert.equal(result.json.artifactURI,`https://lab.example.com/evidence/${sha(bundle)}.json`)
  assert.equal(await readFile(join(s.directory,`${sha(bundle)}.json`),'utf8'),bundle)
  const download=await s.call(`/evidence/${sha(bundle)}.json`)
  assert.equal(download.text,bundle); assert.equal(download.headers['access-control-allow-origin'],'*')
})
test('changed bytes, replayed nonce and another wallet signature cannot publish', async () => {
  const s=await setup(); const bundle=await fixture(); const auth=await s.authorize(bundle)
  assert.equal((await s.call('/api/evidence/publish',{...auth,bundle:bundle+' '})).status,400)
  assert.equal((await s.call('/api/evidence/publish',auth)).status,400)
  const other=privateKeyToAccount(generatePrivateKey()); const challenge=(await s.call('/api/evidence/challenge',{address:s.wallet.address,digest:sha(bundle)})).json
  assert.equal((await s.call('/api/evidence/publish',{nonce:challenge.nonce,signature:await other.signMessage({message:challenge.message}),bundle})).status,400)
})
test('forged report cannot be published even with a valid upload signature', async () => {
  const s=await setup(); const data=JSON.parse(await fixture()); const report=JSON.parse(data.reportText)
  report.returnPct=999; const {reportSha256:_,...content}=report
  data.reportText=JSON.stringify({...content,reportSha256:sha(JSON.stringify(content))})
  const bad=JSON.stringify(data)
  assert.equal((await s.call('/api/evidence/publish',await s.authorize(bad))).status,400)
})
test('cross-origin uploads and traversal are rejected; status never implies a deployment', async () => {
  const s=await setup()
  assert.equal((await s.call('/api/evidence/challenge',{address:s.wallet.address,digest:'a'.repeat(64)},'https://evil.example')).status,403)
  assert.equal((await s.call('/evidence/%2e%2e%2fconfig.json')).status,403)
  assert.deepEqual((await s.call('/api/evidence/status')).json,{available:true,publicHosting:true,origin:'https://lab.example.com'})
})
