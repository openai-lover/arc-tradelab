import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarketCandles, groupMarketCandles, toHistoricalDataset, fetchRecentDataset } from '../src/trading/marketCandles.ts'
import { evidenceUrl, downloadEvidence } from '../src/marketplace/evidenceDownload.ts'

// Synthetic OHLCV rows, never represented as market performance.
const row = (i) => [i * 60000, '100', '104', '98', String(100 + i % 4), '2.5', i * 60000 + 59999]
test('exchange OHLCV preserves volume and excludes a forming candle from backtests', () => {
  const candles = parseMarketCandles([row(0), row(1), row(2)], 150000)
  assert.deepEqual(candles.map(c => c.closed), [true, true, false])
  assert.equal(candles[0].volume, 2.5)
  const dataset = toHistoricalDataset(candles, 150000)
  assert.equal(dataset.candles.length, 2)
  assert.equal(dataset.retrievedAt, '1970-01-01T00:02:30.000Z')
  assert.equal(dataset.candles[0].open, 100)
})
test('invalid exchange envelopes, times, duplicates and gaps are rejected', () => {
  for (const rows of [[row(0), row(2)], [row(0), row(0)], [[0, 100, 99, 98, 100, 2, 59999]], [[0, 100, 104, 98, 100, -1, 59999]], [[0, 100, 104, 98, 100, null, 59999]], [row(3)]]) {
    assert.throws(() => parseMarketCandles(rows, 150000))
  }
})
test('five minute OHLCV aggregates real extrema, first open, last close and volume', () => {
  const candles = parseMarketCandles(Array.from({ length: 7 }, (_, i) => row(i)), 390000)
  const groups = groupMarketCandles(candles, 5)
  assert.deepEqual(groups.map(c => c.closed), [true, false])
  assert.deepEqual(groups[0], { openTime: 0, closeTime: 299999, open: 100, high: 104, low: 98, close: 100, volume: 12.5, closed: true })
  assert.equal(groups[1].volume, 5)
})
test('partial leading buckets and gaps never become complete chart candles', () => {
  const candles = parseMarketCandles(Array.from({ length: 20 }, (_, i) => row(i + 1)), 1260000)
  assert.equal(groupMarketCandles(candles, 15)[0].openTime, 900000)
  const broken = candles.filter(c => c.openTime !== 7 * 60000)
  assert.ok(!groupMarketCandles(broken, 5).some(c => c.openTime === 5 * 60000))
})
test('recent dataset fetch uses public data without credentials and propagates provider failure', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /interval=1m&limit=1000$/)
    assert.equal(options.credentials, 'omit')
    return new Response(JSON.stringify([row(0), row(1)]))
  })
  assert.equal((await fetchRecentDataset()).candles.length, 2)
  globalThis.fetch.mock.mockImplementation(async () => new Response('', { status: 429 }))
  await assert.rejects(fetchRecentDataset(), /429/)
})
test('evidence URLs reject local addresses, credentials and non-HTTPS protocols', () => {
  for (const uri of ['http://example.com/a', 'https://127.0.0.1/a', 'https://2130706433/a', 'https://[::1]/a', 'https://a.local/a', 'https://user:pass@example.com/a', 'javascript:alert(1)']) assert.throws(() => evidenceUrl(uri))
  assert.equal(evidenceUrl('ipfs://bafyExample/file.json'), 'https://ipfs.io/ipfs/bafyExample/file.json')
  assert.equal(evidenceUrl('https://example.com/evidence.json'), 'https://example.com/evidence.json')
})
test('download retains exact UTF-8 content, omits credentials and refuses redirects', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer')
    return new Response('{"terms":"봇"}\r\n')
  })
  assert.equal(await downloadEvidence('https://example.com/bundle'), '{"terms":"봇"}\r\n')
})
test('evidence download bounds streamed bytes even without a content-length header', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1)))
  await assert.rejects(downloadEvidence('https://example.com/bundle'), /20 MB/)
})
