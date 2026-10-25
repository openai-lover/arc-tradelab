import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createStrategyPackage } from '../src/marketplace/strategyPackage.ts'
import { preparePublication, verifyPublication, exportPublicationBundle, importPublicationBundle, PUBLICATION_DISCLOSURE } from '../src/marketplace/publication.ts'
import { runSmaBacktest } from '../src/trading/backtest.ts'

const hash = text => createHash('sha256').update(text, 'utf8').digest('hex')
const prefixedHash = text => `0x${hash(text)}`
const strategyConfig = { shortPeriod: 2, longPeriod: 3, candleIntervalMs: 60_000, orderSizeUsdc: 10, maxAllocationPct: 80, stopLossPct: 5 }
// Synthetic fixture attributed to the expected provider only to exercise the
// schema. It is NOT authenticated Binance price history or performance evidence.
async function fixture() {
  const strategy = await createStrategyPackage({ name: 'Publication unit test', version: '1.0.0', config: { ...strategyConfig } })
  const dataset = {
    source: 'Binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT', retrievedAt: '2026-10-18T00:00:00Z',
    candles: [100, 100, 100, 99, 105, 106, 90, 89, 110, 111].map((close, i) => ({ openTime: i * 60_000, open: close - 0.1, high: close + 1, low: close - 1, close })),
  }
  const datasetText = JSON.stringify(dataset, null, 2)
  const config = { shortPeriod: 2, longPeriod: 3, intervalMs: 60_000, initialCash: 100, orderCash: 10, maxAllocationPct: 80, stopLossPct: 5, feeBps: 10, slippageBps: 5 }
  const content = { ...runSmaBacktest(dataset, config), inputSha256: hash(datasetText), strategyPackage: strategy }
  const report = { ...content, reportSha256: hash(JSON.stringify(content)) }
  const reportText = JSON.stringify(report, null, 2)
  return { strategy, report, dataset, datasetText, reportText, termsText: 'UNIT TEST ONLY — user-provided sample text, not a legal template.\n' }
}
function expectedFor(publication) {
  return { strategySha256: publication.strategySha256, reportSha256: publication.reportSha256, termsSha256: publication.termsSha256 }
}
function filesFor(publication) {
  return { strategyText: publication.strategyText, reportText: publication.reportText, datasetText: publication.datasetText, termsText: publication.termsText, expected: expectedFor(publication) }
}
async function prepareFixture() {
  const { strategy, reportText, datasetText, termsText } = await fixture()
  return preparePublication({ strategy, reportText, datasetText, termsText })
}
function resignReport(report) {
  const { reportSha256: _old, ...content } = report
  return JSON.stringify({ ...content, reportSha256: hash(JSON.stringify(content)) }, null, 2)
}

test('publication fingerprints exact raw files and recomputes the linked report', async () => {
  const publication = await prepareFixture()
  for (const kind of ['strategy', 'report', 'dataset', 'terms']) assert.equal(publication[`${kind}Sha256`], prefixedHash(publication[`${kind}Text`]))
  assert.equal(publication.summary.verification, 'recomputed_from_supplied_data')
  assert.equal(publication.summary.market, 'BTCUSDT')
  assert.equal(publication.summary.initialCash, 100)
  assert.ok(Object.isFrozen(publication))
  assert.ok(Object.isFrozen(publication.summary))
  const manifest = JSON.parse(publication.manifestText)
  assert.equal(manifest.files.dataset.sha256, publication.datasetSha256)
  assert.equal(manifest.strategy.packageContentSha256, `0x${publication.strategy.digest.value}`)
  assert.notEqual(manifest.strategy.packageContentSha256, publication.strategySha256)
  assert.match(manifest.disclosure, /prices and source attribution are not authenticated/)
  assert.deepEqual((await verifyPublication(filesFor(publication))).summary, publication.summary)
})

test('delivery verification rejects changes to any file including harmless formatting or line endings', async () => {
  const publication = await prepareFixture()
  for (const field of ['strategyText', 'reportText', 'termsText']) {
    await assert.rejects(verifyPublication({ ...filesFor(publication), [field]: `${publication[field]}\n` }), /whole-file hash mismatch/)
  }
  await assert.rejects(verifyPublication({ ...filesFor(publication), datasetText: `${publication.datasetText}\n` }), /dataset bytes do not match/)
  await assert.rejects(verifyPublication({ ...filesFor(publication), termsText: publication.termsText.replaceAll('\n', '\r\n') }), /whole-file hash mismatch/)
  await assert.rejects(verifyPublication({ ...filesFor(publication), expected: { ...expectedFor(publication), datasetSha256: `0x${'0'.repeat(64)}` } }), /datasetSha256 whole-file hash mismatch/)
})

test('a forged plausible result is rejected even when the seller recomputes its embedded checksum', async () => {
  const f = await fixture()
  f.report.returnPct = 12
  await assert.rejects(preparePublication({ strategy: f.strategy, datasetText: f.datasetText, reportText: resignReport(f.report), termsText: f.termsText }), /do not match recomputation/)
  f.report.returnPct = runSmaBacktest(f.dataset, f.report.config).returnPct
  f.report.completedTrades = 999
  await assert.rejects(preparePublication({ strategy: f.strategy, datasetText: f.datasetText, reportText: resignReport(f.report), termsText: f.termsText }), /do not match recomputation/)
})

test('changed dataset cannot be smuggled under a checksum, and changing checksum still requires recomputation', async () => {
  const f = await fixture()
  f.dataset.candles.at(-1).close = 110
  const changedDatasetText = JSON.stringify(f.dataset, null, 2)
  await assert.rejects(preparePublication({ strategy: f.strategy, datasetText: changedDatasetText, reportText: f.reportText, termsText: f.termsText }), /dataset bytes/)
  f.report.inputSha256 = hash(changedDatasetText)
  await assert.rejects(preparePublication({ strategy: f.strategy, datasetText: changedDatasetText, reportText: resignReport(f.report), termsText: f.termsText }), /do not match recomputation/)
})

test('unlinked reports, different packages, rules, fees and markets cannot be published as selected evidence', async () => {
  const f = await fixture()
  const different = await createStrategyPackage({ name: f.strategy.name, version: '1.0.1', config: { ...strategyConfig } })
  await assert.rejects(preparePublication({ strategy: different, datasetText: f.datasetText, reportText: f.reportText, termsText: f.termsText }), /different strategy version/)
  for (const change of [
    r => { r.strategyPackage = null }, r => { r.config.feeBps = 0 },
    r => { r.config.stopLossPct = 0 }, r => { r.config.maxAllocationPct = 100 },
    r => { r.config.shortPeriod = 1 }, r => { delete r.config.initialCash },
  ]) {
    const report = JSON.parse(f.reportText); change(report)
    await assert.rejects(preparePublication({ strategy: f.strategy, datasetText: f.datasetText, reportText: resignReport(report), termsText: f.termsText }))
  }
  f.dataset.source = 'Unrelated provider'
  await assert.rejects(preparePublication({ strategy: f.strategy, datasetText: JSON.stringify(f.dataset), reportText: f.reportText, termsText: f.termsText }), /market identity/)
})

test('fake onchain claims, executable extras and inconsistent or nonfinite report structures are rejected', async () => {
  const f = await fixture()
  for (const change of [
    r => { r.txHash = `0x${'1'.repeat(64)}` },
    r => { r.fills[0].chainStatus = 'confirmed' },
    r => { r.fills[0].networkGas = 1 },
    r => { r.config.code = 'return buy()' },
    r => { r.equity = null },
    r => { r.equityCurve[0].value = null },
    r => { r.assumptions.execution = 'exchange_live' },
  ]) {
    const report = JSON.parse(f.reportText); change(report)
    await assert.rejects(preparePublication({ strategy: f.strategy, datasetText: f.datasetText, reportText: resignReport(report), termsText: f.termsText }))
  }
})

test('embedded content checksums and raw publication hashes have separate explicit boundaries', async () => {
  const f = await fixture()
  f.report.reportSha256 = '0'.repeat(64)
  await assert.rejects(preparePublication({ strategy: f.strategy, datasetText: f.datasetText, reportText: JSON.stringify(f.report), termsText: f.termsText }), /embedded report content checksum/)
  const publication = await prepareFixture()
  const prettyPackage = JSON.stringify(JSON.parse(publication.strategyText), null, 2)
  const delivered = { ...filesFor(publication), strategyText: prettyPackage, expected: { ...expectedFor(publication), strategySha256: prefixedHash(prettyPackage) } }
  assert.equal((await verifyPublication(delivered)).strategy.digest.value, publication.strategy.digest.value)
  assert.notEqual((await verifyPublication(delivered)).strategySha256, publication.strategySha256)
})

test('malformed, oversized or nonplaintext inputs fail closed; no template or authentication is implied', async () => {
  const f = await fixture()
  const input = { strategy: f.strategy, datasetText: f.datasetText, reportText: f.reportText, termsText: f.termsText }
  for (const termsText of ['', '  ', '<script>alert(1)</script>', '\u0000bad', 'bad\ud800', 'x'.repeat(64 * 1024 + 1)]) {
    await assert.rejects(preparePublication({ ...input, termsText }))
  }
  await assert.rejects(preparePublication({ ...input, datasetText: 'x'.repeat(6 * 1024 * 1024 + 1) }), /size limit/)
  await assert.rejects(preparePublication({ ...input, reportText: '{bad' }), /not valid JSON/)
  await assert.rejects(preparePublication({ ...input, reportText: 'null' }), /JSON object/)
  const publication = await prepareFixture()
  await assert.rejects(verifyPublication({ ...filesFor(publication), expected: { ...expectedFor(publication), reportSha256: 'abc' } }), /0x-prefixed SHA-256/)
  await assert.rejects(verifyPublication({ ...filesFor(publication), expected: undefined }), /expected hashes/)
  assert.match(PUBLICATION_DISCLOSURE, /not authorship, ownership, licensing/)
})

test('single delivery bundle round trips inner bytes using external file commitments only', async () => {
  const publication = await prepareFixture()
  const bundleText = exportPublicationBundle(publication)
  const imported = await importPublicationBundle(bundleText, expectedFor(publication))
  for (const field of ['strategyText', 'reportText', 'datasetText', 'termsText', 'manifestText']) assert.equal(imported[field], publication[field])
  assert.notEqual(prefixedHash(bundleText), publication.strategySha256)
  assert.deepEqual(Object.keys(JSON.parse(bundleText)).sort(), ['schema', 'schemaVersion', 'strategyText', 'reportText', 'datasetText', 'termsText'].sort())
  const modified = JSON.parse(bundleText)
  modified.reportText += '\n'
  await assert.rejects(importPublicationBundle(JSON.stringify(modified), expectedFor(publication)), /whole-file hash mismatch/)
  modified.reportSha256 = prefixedHash(modified.reportText)
  await assert.rejects(importPublicationBundle(JSON.stringify(modified), expectedFor(publication)), /unsupported fields/)
  await assert.rejects(importPublicationBundle(' '.repeat(20 * 1024 * 1024 + 1), expectedFor(publication)), /exceeds 20 MB/)
  await assert.rejects(importPublicationBundle('{bad', expectedFor(publication)), /not valid JSON/)
  await assert.rejects(importPublicationBundle(bundleText, undefined), /expected hashes/)
})
