/**
 * Data-file publication and delivery checks. Recomputing a historical simulation
 * establishes consistency with the supplied candles and engine, not whether the
 * prices, source attribution, seller identity, ownership or future returns are true.
 * These functions never publish, sell, sign, grant a license or transact onchain.
 */
import { runSmaBacktest } from '../trading/backtest.ts'
import type { BacktestConfig, HistoricalDataset } from '../trading/backtest.ts'
import { exportStrategyPackage, importStrategyPackage } from './strategyPackage.ts'
import type { StrategyPackage } from './strategyPackage.ts'

export type PublicationSha256 = `0x${string}`
export const PUBLICATION_DISCLOSURE =
  'Recomputed from supplied data; prices and source attribution are not authenticated. File hashes check content consistency only, not authorship, ownership, licensing, blockchain inclusion or future performance.'

export interface PreparePublicationInput {
  strategy: StrategyPackage
  reportText: string
  datasetText: string
  /** User-written plaintext; the module does not supply or interpret legal terms. */
  termsText: string
}

export interface PublicationExpectedHashes {
  strategySha256: PublicationSha256
  reportSha256: PublicationSha256
  termsSha256: PublicationSha256
  /** The report already commits the dataset hash; this extra comparison is optional. */
  datasetSha256?: PublicationSha256
}

export interface VerifyPublicationInput {
  strategyText: string
  reportText: string
  datasetText: string
  termsText: string
  expected: PublicationExpectedHashes
}

export interface PublicationSummary {
  readonly verification: 'recomputed_from_supplied_data'
  readonly name: string
  readonly version: string
  readonly market: 'BTCUSDT'
  readonly quoteCurrency: 'USDT'
  readonly initialCash: number
  readonly returnPct: number
  readonly maxDrawdownPct: number
  readonly buyAndHoldReturnPct: number
  readonly completedTrades: number
  readonly startedAt: number
  readonly endedAt: number
  readonly evaluatedCandles: number
  readonly warmupCandles: number
  readonly disclosure: string
}

export interface PreparedPublication {
  readonly strategy: StrategyPackage
  readonly strategyText: string
  readonly reportText: string
  readonly datasetText: string
  readonly termsText: string
  /** All four are exact whole-file UTF-8 hashes, distinct from embedded content checksums. */
  readonly strategySha256: PublicationSha256
  readonly reportSha256: PublicationSha256
  readonly datasetSha256: PublicationSha256
  readonly termsSha256: PublicationSha256
  readonly manifestText: string
  readonly summary: PublicationSummary
}

const LIMITS = { strategy: 16 * 1024, dataset: 6 * 1024 * 1024, report: 32 * 1024 * 1024, terms: 64 * 1024 } as const
const BUNDLE_LIMIT_BYTES = 20 * 1024 * 1024
const encoder = new TextEncoder()
const REPORT_CONFIG_KEYS = ['shortPeriod', 'longPeriod', 'intervalMs', 'initialCash', 'orderCash', 'maxAllocationPct', 'stopLossPct', 'feeBps', 'slippageBps'] as const
const verifiedPublications = new WeakSet<object>()

function invalid(reason: string): never { throw new Error(`Invalid publication: ${reason}`) }

function exactRecord(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) invalid(`${field} must be a plain JSON object`)
  const actual = Reflect.ownKeys(value)
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) {
    invalid(`${field} has missing or unsupported fields`)
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || !descriptor.enumerable) invalid(`${field} must contain JSON data values`)
  }
  return value as Record<string, unknown>
}

function fileBytes(text: unknown, kind: keyof typeof LIMITS): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || text.length === 0 || text.length > LIMITS[kind]) invalid(`${kind} file is empty or exceeds its size limit`)
  const bytes = encoder.encode(text)
  if (bytes.byteLength > LIMITS[kind]) invalid(`${kind} file exceeds its UTF-8 size limit`)
  // Reject lone UTF-16 surrogates instead of silently replacing bytes while hashing.
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== text) invalid(`${kind} must be well-formed UTF-8 text`)
  return bytes
}

function parseJson(text: string, field: string): unknown {
  try { return JSON.parse(text) as unknown } catch { invalid(`${field} is not valid JSON`) }
}

function stringifyJson(value: unknown, field: string): string {
  try { return JSON.stringify(value) } catch { invalid(`${field} contains an unsupported JSON structure`) }
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<PublicationSha256> {
  if (!globalThis.crypto?.subtle) invalid('Web Crypto SHA-256 is unavailable')
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `0x${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function expectedHash(value: unknown, field: string): PublicationSha256 {
  if (typeof value !== 'string' || !/^0x[a-f0-9]{64}$/.test(value)) invalid(`${field} must be a lowercase 0x-prefixed SHA-256`)
  return value as PublicationSha256
}

/** Compare against the shallow trusted engine shape, never traverse arbitrary extra input. */
function equalsEngineOutput(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length
    && expected.every((value, index) => equalsEngineOutput(actual[index], value))
  if (expected !== null && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
    const expectedFields = expected as Record<string, unknown>
    const actualFields = actual as Record<string, unknown>
    const keys = Object.keys(expectedFields)
    return Object.keys(actualFields).length === keys.length
      && keys.every(key => Object.prototype.hasOwnProperty.call(actualFields, key) && equalsEngineOutput(actualFields[key], expectedFields[key]))
  }
  return actual === expected
}

function ensureFiniteOutput(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) invalid('simulation produced a nonfinite result')
  if (Array.isArray(value)) value.forEach(ensureFiniteOutput)
  else if (value && typeof value === 'object') Object.values(value).forEach(ensureFiniteOutput)
}

function validTerms(text: string): void {
  if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)
      || /<\/?[a-z][^>]*>|<\?|<!/iu.test(text)) {
    invalid('terms must be nonempty user-written plaintext without HTML or control characters')
  }
}

async function validateReport(
  strategy: StrategyPackage, reportText: string, datasetText: string, datasetHash: PublicationSha256,
): Promise<PublicationSummary> {
  const datasetValue = parseJson(datasetText, 'dataset')
  const dataset = exactRecord(datasetValue, ['source', 'symbol', 'quoteCurrency', 'retrievedAt', 'candles'], 'dataset')
  if (typeof dataset.source !== 'string' || dataset.source.trim().toLowerCase() !== strategy.market.provider.toLowerCase()
      || dataset.symbol !== strategy.market.symbol || dataset.quoteCurrency !== strategy.market.quoteAsset) {
    invalid('dataset market identity must match the selected Binance BTCUSDT/USDT strategy')
  }
  if (!Array.isArray(dataset.candles) || dataset.candles.length > 50_000) invalid('dataset must contain at most 50,000 candles')
  dataset.candles.forEach((candle, index) => exactRecord(candle, ['openTime', 'open', 'high', 'low', 'close'], `candle ${index}`))
  const reportValue = parseJson(reportText, 'report')
  if (!reportValue || typeof reportValue !== 'object' || Array.isArray(reportValue)) invalid('report must be a JSON object')
  const report = reportValue as Record<string, unknown>
  if (!report.strategyPackage) invalid('report must be linked to a saved strategy version')
  const linkedStrategy = await importStrategyPackage(stringifyJson(report.strategyPackage, 'linked strategy'))
  if (exportStrategyPackage(linkedStrategy) !== exportStrategyPackage(strategy)) invalid('report is linked to a different strategy version')
  const config = exactRecord(report.config, REPORT_CONFIG_KEYS, 'report config')
  const cfg = strategy.config
  if (config.shortPeriod !== cfg.shortPeriod || config.longPeriod !== cfg.longPeriod
      || config.intervalMs !== cfg.candleIntervalMs || config.orderCash !== cfg.orderSizeUsdc
      || config.maxAllocationPct !== cfg.maxAllocationPct || config.stopLossPct !== cfg.stopLossPct
      || config.feeBps !== strategy.assumptions.simFeeBps || config.slippageBps !== strategy.assumptions.simSlippageBps) {
    invalid('report rules, allocation, stop loss, fees and slippage must match the selected strategy')
  }
  if (report.inputSha256 !== datasetHash.slice(2)) invalid('dataset bytes do not match the report input checksum')
  const recomputed = runSmaBacktest(dataset as unknown as HistoricalDataset, config as unknown as BacktestConfig)
  ensureFiniteOutput(recomputed)
  const { inputSha256: _input, strategyPackage: _strategy, reportSha256: checksum, ...engineOutput } = report
  if (!equalsEngineOutput(engineOutput, recomputed)) invalid('report results or fields do not match recomputation from the supplied dataset')
  // Existing BacktestPanel content checksum uses compact JSON in insertion order.
  // This is separate from the whole-file hash published in the manifest/contract.
  const { reportSha256: _checksum, ...checksumContent } = report
  const actualChecksum = await sha256(encoder.encode(stringifyJson(checksumContent, 'report content')))
  if (checksum !== actualChecksum.slice(2)) invalid('embedded report content checksum mismatch')
  return Object.freeze({
    verification: 'recomputed_from_supplied_data', name: strategy.name, version: strategy.version,
    market: 'BTCUSDT', quoteCurrency: 'USDT', initialCash: recomputed.config.initialCash,
    returnPct: recomputed.returnPct, maxDrawdownPct: recomputed.maxDrawdownPct,
    buyAndHoldReturnPct: recomputed.buyAndHoldReturnPct, completedTrades: recomputed.completedTrades,
    startedAt: recomputed.startedAt, endedAt: recomputed.endedAt,
    evaluatedCandles: recomputed.evaluatedCandles, warmupCandles: recomputed.warmupCandles,
    disclosure: PUBLICATION_DISCLOSURE,
  })
}

async function checkedPublication(input: Omit<VerifyPublicationInput, 'expected'>, expected?: PublicationExpectedHashes): Promise<PreparedPublication> {
  const strategyBytes = fileBytes(input.strategyText, 'strategy')
  const reportBytes = fileBytes(input.reportText, 'report')
  const datasetBytes = fileBytes(input.datasetText, 'dataset')
  const termsBytes = fileBytes(input.termsText, 'terms')
  validTerms(input.termsText)
  const [strategySha256, reportSha256, datasetSha256, termsSha256] = await Promise.all([
    sha256(strategyBytes), sha256(reportBytes), sha256(datasetBytes), sha256(termsBytes),
  ])
  if (expected !== undefined) {
    const fields = expected && typeof expected === 'object' && Object.prototype.hasOwnProperty.call(expected, 'datasetSha256')
      ? ['strategySha256', 'reportSha256', 'termsSha256', 'datasetSha256']
      : ['strategySha256', 'reportSha256', 'termsSha256']
    const hashes = exactRecord(expected, fields, 'expected hashes')
    for (const [field, actual] of Object.entries({ strategySha256, reportSha256, termsSha256, ...(fields.length === 4 ? { datasetSha256 } : {}) })) {
      if (expectedHash(hashes[field], field) !== actual) invalid(`${field} whole-file hash mismatch`)
    }
  }
  const strategy = await importStrategyPackage(input.strategyText)
  const summary = await validateReport(strategy, input.reportText, input.datasetText, datasetSha256)
  const manifestText = JSON.stringify({
    schema: 'arc-tradelab.publication-manifest', schemaVersion: 1,
    strategy: {
      name: strategy.name, version: strategy.version, engineVersion: strategy.engineVersion,
      strategyVersion: strategy.strategyVersion, packageContentSha256: `0x${strategy.digest.value}`,
    },
    files: {
      strategy: { name: 'strategy.json', bytes: strategyBytes.byteLength, sha256: strategySha256 },
      report: { name: 'backtest-report.json', bytes: reportBytes.byteLength, sha256: reportSha256 },
      dataset: { name: 'historical-candles.json', bytes: datasetBytes.byteLength, sha256: datasetSha256 },
      terms: { name: 'license-terms.txt', bytes: termsBytes.byteLength, sha256: termsSha256 },
    },
    verification: 'recomputed_from_supplied_data',
    reportContentChecksum: 'SHA-256 of compact JSON.stringify(report excluding reportSha256), preserving property order',
    publicationFileHashes: 'SHA-256 of exact full UTF-8 file bytes, including formatting and line endings',
    summary, disclosure: PUBLICATION_DISCLOSURE,
  }, null, 2)
  const publication = Object.freeze({
    strategy, ...input, strategySha256, reportSha256, datasetSha256, termsSha256, manifestText, summary,
  })
  verifiedPublications.add(publication)
  return publication
}

/** Prepare reviewable files and commitments locally. No external state is changed. */
export async function preparePublication(input: PreparePublicationInput): Promise<PreparedPublication> {
  exactRecord(input, ['strategy', 'reportText', 'datasetText', 'termsText'], 'preparation input')
  return checkedPublication({
    strategyText: exportStrategyPackage(input.strategy), reportText: input.reportText,
    datasetText: input.datasetText, termsText: input.termsText,
  })
}

/** Verify delivered bytes against independently supplied commitments, then rerun the backtest. */
export async function verifyPublication(input: VerifyPublicationInput): Promise<PreparedPublication> {
  exactRecord(input, ['strategyText', 'reportText', 'datasetText', 'termsText', 'expected'], 'verification input')
  const { expected, ...files } = input
  if (expected === undefined || expected === null) invalid('expected hashes are required for delivery verification')
  return checkedPublication(files, expected)
}

/** One downloadable delivery file. Inner file hashes retain their original boundaries. */
export function exportPublicationBundle(publication: PreparedPublication): string {
  if (!verifiedPublications.has(publication)) invalid('prepare or verify the publication before exporting a bundle')
  const text = JSON.stringify({
    schema: 'arc-tradelab.publication-bundle', schemaVersion: 1,
    strategyText: publication.strategyText, reportText: publication.reportText,
    datasetText: publication.datasetText, termsText: publication.termsText,
  })
  if (text.length > BUNDLE_LIMIT_BYTES || encoder.encode(text).byteLength > BUNDLE_LIMIT_BYTES) {
    invalid('delivery bundle exceeds 20 MB; use a smaller historical dataset')
  }
  return text
}

/** Never trust bundle-provided summaries or hashes: compare with external commitments. */
export async function importPublicationBundle(bundleText: string, expected: PublicationExpectedHashes): Promise<PreparedPublication> {
  if (typeof bundleText !== 'string' || bundleText.length === 0 || bundleText.length > BUNDLE_LIMIT_BYTES
      || encoder.encode(bundleText).byteLength > BUNDLE_LIMIT_BYTES) invalid('delivery bundle is empty or exceeds 20 MB')
  const bundle = exactRecord(parseJson(bundleText, 'delivery bundle'),
    ['schema', 'schemaVersion', 'strategyText', 'reportText', 'datasetText', 'termsText'], 'delivery bundle')
  if (bundle.schema !== 'arc-tradelab.publication-bundle' || bundle.schemaVersion !== 1) invalid('unsupported delivery bundle schema')
  return verifyPublication({
    strategyText: bundle.strategyText as string, reportText: bundle.reportText as string,
    datasetText: bundle.datasetText as string, termsText: bundle.termsText as string, expected,
  })
}
