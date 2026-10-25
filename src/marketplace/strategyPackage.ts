/**
 * A data-only strategy snapshot. No bot source, scripts, credentials, prices,
 * entitlements, backtest claims, or onchain transaction claims are accepted.
 *
 * SHA-256 detects whether the package content changed. Anyone can create a
 * package and recompute a hash: it does NOT authenticate performance, authorship,
 * ownership, licensing, a seller, or any blockchain record.
 */
import {
  SIM_FEE_BPS, SIM_SLIPPAGE_BPS, SIM_GAS_USDC, STRATEGY_VERSION,
} from '../trading/engine.ts'
import type { StrategyConfig } from '../trading/engine.ts'

export const STRATEGY_PACKAGE_SCHEMA = 'arc-tradelab.strategy-package' as const
export const STRATEGY_PACKAGE_SCHEMA_VERSION = 1 as const
export const STRATEGY_PACKAGE_DISCLOSURE =
  'Data-only paper strategy. SHA-256 checks content consistency only; it does not prove performance, authorship, ownership, licensing, or an onchain record.'

export interface StrategyPackage {
  readonly schema: typeof STRATEGY_PACKAGE_SCHEMA
  readonly schemaVersion: typeof STRATEGY_PACKAGE_SCHEMA_VERSION
  readonly name: string
  /** User-assigned release label; changing it creates a different content hash. */
  readonly version: string
  readonly engineVersion: string
  readonly strategyVersion: string
  readonly strategy: 'sma_crossover'
  readonly market: Readonly<{
    provider: 'Binance'
    symbol: 'BTCUSDT'
    baseAsset: 'BTC'
    quoteAsset: 'USDT'
    candleIntervalMs: 60_000
    closedCandlesOnly: true
  }>
  readonly config: Readonly<StrategyConfig>
  readonly assumptions: Readonly<{
    simFeeBps: number
    simSlippageBps: number
    simGasUsdc: number
    /** Engine USDC-named inputs use numeric quote parity, never an FX guarantee. */
    quoteConversion: 'USDT_USDC_1_to_1_simulation'
  }>
  readonly digest: Readonly<{ algorithm: 'SHA-256'; value: string }>
}

export interface CreateStrategyPackageInput {
  name: string
  version: string
  config: StrategyConfig
}

type PackageContent = Omit<StrategyPackage, 'digest'>
const MAX_IMPORT_CHARACTERS = 16_384
const CONFIG_KEYS = ['shortPeriod', 'longPeriod', 'candleIntervalMs', 'orderSizeUsdc', 'maxAllocationPct', 'stopLossPct'] as const
const PACKAGE_KEYS = ['schema', 'schemaVersion', 'name', 'version', 'engineVersion', 'strategyVersion', 'strategy', 'market', 'config', 'assumptions', 'digest'] as const
// Only return immutable packages after creating or verifying their digest. This
// also prevents synchronous consumers from accepting a fabricated typed object.
const verifiedPackages = new WeakSet<object>()

function fail(message: string): never {
  throw new Error(`Invalid strategy package: ${message}`)
}

function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) fail(`${path} must be a plain object`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const actual = Reflect.ownKeys(value)
  if (actual.length !== keys.length
      || actual.some(key => typeof key !== 'string' || !keys.includes(key))) {
    fail(`${path} has missing or unsupported fields; executable fields are not supported`)
  }
  for (const key of keys) {
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      fail(`${path}.${key} must be a JSON data value`)
    }
  }
  return value as Record<string, unknown>
}

function numberInRange(value: unknown, min: number, max: number, field: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(`${field} must be ${integer ? 'an integer' : 'a finite number'} from ${min} to ${max}`)
  }
  return Object.is(value, -0) ? 0 : value
}

function nameValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80
      || value !== value.trim() || value !== value.normalize('NFC')
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) {
    fail('name must be 1–80 characters of plain text without surrounding whitespace or control characters')
  }
  return value
}

function versionValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 48
      || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(value)) {
    fail('version must be a release label such as 1.0.0 or 1.0.0-beta.1')
  }
  return value
}

function validatedConfig(value: unknown): StrategyConfig {
  const config = record(value, CONFIG_KEYS, 'config')
  const shortPeriod = numberInRange(config.shortPeriod, 1, 499, 'shortPeriod', true)
  const longPeriod = numberInRange(config.longPeriod, 2, 500, 'longPeriod', true)
  if (shortPeriod >= longPeriod) fail('shortPeriod must be less than longPeriod')
  if (config.candleIntervalMs !== 60_000) fail('only closed one-minute candles are supported')
  return {
    shortPeriod,
    longPeriod,
    candleIntervalMs: 60_000,
    orderSizeUsdc: numberInRange(config.orderSizeUsdc, 0.01, 1_000_000, 'orderSizeUsdc'),
    maxAllocationPct: numberInRange(config.maxAllocationPct, 0.01, 100, 'maxAllocationPct'),
    stopLossPct: numberInRange(config.stopLossPct, 0, 100, 'stopLossPct'),
  }
}

function validatedContent(input: Record<string, unknown>): PackageContent {
  if (input.schema !== STRATEGY_PACKAGE_SCHEMA || input.schemaVersion !== STRATEGY_PACKAGE_SCHEMA_VERSION) {
    fail('unsupported schema or schema version')
  }
  if (input.engineVersion !== STRATEGY_VERSION || input.strategyVersion !== STRATEGY_VERSION
      || input.strategy !== 'sma_crossover') fail('unsupported engine or strategy version')
  const market = record(input.market, ['provider', 'symbol', 'baseAsset', 'quoteAsset', 'candleIntervalMs', 'closedCandlesOnly'], 'market')
  if (market.provider !== 'Binance' || market.symbol !== 'BTCUSDT'
      || market.baseAsset !== 'BTC' || market.quoteAsset !== 'USDT'
      || market.candleIntervalMs !== 60_000 || market.closedCandlesOnly !== true) {
    fail('only Binance BTCUSDT closed one-minute candles are supported')
  }
  const assumptions = record(input.assumptions, ['simFeeBps', 'simSlippageBps', 'simGasUsdc', 'quoteConversion'], 'assumptions')
  if (assumptions.simFeeBps !== SIM_FEE_BPS || assumptions.simSlippageBps !== SIM_SLIPPAGE_BPS
      || assumptions.simGasUsdc !== SIM_GAS_USDC
      || assumptions.quoteConversion !== 'USDT_USDC_1_to_1_simulation') {
    fail('fee, slippage, gas, and quote assumptions must match the supported paper engine')
  }
  return {
    schema: STRATEGY_PACKAGE_SCHEMA,
    schemaVersion: STRATEGY_PACKAGE_SCHEMA_VERSION,
    name: nameValue(input.name),
    version: versionValue(input.version),
    engineVersion: STRATEGY_VERSION,
    strategyVersion: STRATEGY_VERSION,
    strategy: 'sma_crossover',
    market: {
      provider: 'Binance', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT',
      candleIntervalMs: 60_000, closedCandlesOnly: true,
    },
    config: validatedConfig(input.config),
    assumptions: {
      simFeeBps: SIM_FEE_BPS, simSlippageBps: SIM_SLIPPAGE_BPS, simGasUsdc: SIM_GAS_USDC,
      quoteConversion: 'USDT_USDC_1_to_1_simulation',
    },
  }
}

/** Canonical form for this schema: sorted object keys, no whitespace, JSON numbers. */
function canonicalJson(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function digestContent(content: PackageContent): Promise<string> {
  if (!globalThis.crypto?.subtle) fail('Web Crypto SHA-256 is unavailable in this context')
  const bytes = new TextEncoder().encode(canonicalJson(content))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function immutablePackage(content: PackageContent, hash: string): StrategyPackage {
  Object.freeze(content.market)
  Object.freeze(content.config)
  Object.freeze(content.assumptions)
  const result: StrategyPackage = Object.freeze({
    ...content,
    digest: Object.freeze({ algorithm: 'SHA-256' as const, value: hash }),
  })
  verifiedPackages.add(result)
  return result
}

/** Copies inputs before hashing; no timestamp or randomness changes a version's hash. */
export async function createStrategyPackage(input: CreateStrategyPackageInput): Promise<StrategyPackage> {
  const fields = record(input, ['name', 'version', 'config'], 'input')
  const content = validatedContent({
    schema: STRATEGY_PACKAGE_SCHEMA, schemaVersion: STRATEGY_PACKAGE_SCHEMA_VERSION,
    name: typeof fields.name === 'string' ? fields.name.trim().normalize('NFC') : fields.name,
    version: fields.version,
    engineVersion: STRATEGY_VERSION, strategyVersion: STRATEGY_VERSION, strategy: 'sma_crossover',
    market: {
      provider: 'Binance', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT',
      candleIntervalMs: 60_000, closedCandlesOnly: true,
    },
    config: fields.config,
    assumptions: {
      simFeeBps: SIM_FEE_BPS, simSlippageBps: SIM_SLIPPAGE_BPS, simGasUsdc: SIM_GAS_USDC,
      quoteConversion: 'USDT_USDC_1_to_1_simulation',
    },
  })
  return immutablePackage(content, await digestContent(content))
}

/** Export only a package returned by create/import; serialized copies must be imported again. */
export function exportStrategyPackage(strategyPackage: StrategyPackage): string {
  if (!verifiedPackages.has(strategyPackage)) fail('create or import the package before exporting it')
  return canonicalJson(strategyPackage)
}

/** Validates an untrusted JSON document and checks SHA-256 before returning a frozen copy. */
export async function importStrategyPackage(text: string): Promise<StrategyPackage> {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_IMPORT_CHARACTERS) {
    fail('import must be a nonempty JSON document of at most 16384 characters')
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) as unknown } catch { fail('import is not valid JSON') }
  const fields = record(parsed, PACKAGE_KEYS, 'package')
  const content = validatedContent(fields)
  const digest = record(fields.digest, ['algorithm', 'value'], 'digest')
  if (digest.algorithm !== 'SHA-256' || typeof digest.value !== 'string'
      || !/^[a-f0-9]{64}$/.test(digest.value)) fail('digest must be a lowercase SHA-256 hexadecimal value')
  const actual = await digestContent(content)
  if (actual !== digest.value) fail('content digest mismatch; the package was changed or corrupted')
  return immutablePackage(content, actual)
}

/** Caller receives a mutable config copy; the verified package remains immutable. */
export function packageToConfig(strategyPackage: StrategyPackage): StrategyConfig {
  if (!verifiedPackages.has(strategyPackage)) fail('create or import the package before using its config')
  return { ...strategyPackage.config }
}
