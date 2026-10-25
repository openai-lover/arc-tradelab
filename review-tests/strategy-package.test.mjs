import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DEFAULT_STRATEGY, STRATEGY_VERSION } from '../src/trading/engine.ts'
import {
  createStrategyPackage, exportStrategyPackage, importStrategyPackage,
  packageToConfig, STRATEGY_PACKAGE_DISCLOSURE,
} from '../src/marketplace/strategyPackage.ts'

const make = (overrides = {}) => createStrategyPackage({
  name: 'BTC crossover experiment', version: '1.0.0', config: { ...DEFAULT_STRATEGY }, ...overrides,
})
const canonical = value => value !== null && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  : JSON.stringify(value)

test('equivalent input order creates stable canonical bytes and a reproducible SHA-256 digest', async () => {
  const first = await make()
  const second = await createStrategyPackage({
    config: Object.fromEntries(Object.entries(DEFAULT_STRATEGY).reverse()),
    version: '1.0.0', name: 'BTC crossover experiment',
  })
  assert.equal(first.digest.value, second.digest.value)
  assert.equal(exportStrategyPackage(first), exportStrategyPackage(second))
  const { digest, ...content } = first
  assert.equal(digest.value, createHash('sha256').update(canonical(content)).digest('hex'))
  assert.equal(first.engineVersion, STRATEGY_VERSION)
  assert.equal(first.strategyVersion, STRATEGY_VERSION)
  assert.equal(first.market.quoteAsset, 'USDT')
  assert.equal(first.market.closedCandlesOnly, true)
  assert.equal(first.assumptions.simGasUsdc, 0)
})

test('valid JSON round trip verifies its digest even with reordered keys and whitespace', async () => {
  const original = await make()
  const reordered = Object.fromEntries(Object.entries(JSON.parse(exportStrategyPackage(original))).reverse())
  const imported = await importStrategyPackage(JSON.stringify(reordered, null, 2))
  assert.deepEqual(imported, original)
  assert.equal(exportStrategyPackage(imported), exportStrategyPackage(original))
  assert.deepEqual(packageToConfig(imported), DEFAULT_STRATEGY)
})

test('version and config changes make independent immutable snapshots; callers cannot mutate one', async () => {
  const config = { ...DEFAULT_STRATEGY }
  const original = await make({ config })
  config.shortPeriod = 3
  assert.equal(original.config.shortPeriod, 5)
  assert.ok(Object.isFrozen(original))
  for (const nested of [original.config, original.market, original.assumptions, original.digest]) assert.ok(Object.isFrozen(nested))
  assert.throws(() => { original.config.shortPeriod = 2 }, TypeError)
  const configCopy = packageToConfig(original)
  configCopy.shortPeriod = 2
  assert.equal(original.config.shortPeriod, 5)
  assert.notEqual((await make({ version: '1.0.1' })).digest.value, original.digest.value)
  assert.notEqual((await make({ config })).digest.value, original.digest.value)
})

test('tampered valid data, forged hashes, and unsupported engine/market assumptions are rejected', async () => {
  const original = await make()
  for (const mutate of [
    p => { p.name = 'Changed name' },
    p => { p.config.shortPeriod = 3 },
    p => { p.digest.value = '0'.repeat(64) },
    p => { p.digest.algorithm = 'MD5' },
    p => { p.engineVersion = '999.0.0' },
    p => { p.schemaVersion = 2 },
    p => { p.market.symbol = 'ETHUSDT' },
    p => { p.market.closedCandlesOnly = false },
    p => { p.assumptions.simFeeBps = 0 },
  ]) {
    const modified = JSON.parse(exportStrategyPackage(original)); mutate(modified)
    await assert.rejects(importStrategyPackage(JSON.stringify(modified)), /Invalid strategy package:/)
  }
  const forged = { ...original, config: { ...original.config, shortPeriod: 2 } }
  assert.throws(() => packageToConfig(forged), /create or import/)
  assert.throws(() => exportStrategyPackage(forged), /create or import/)
})

test('executable, credential, unknown, and prototype fields are never accepted as strategy data', async () => {
  const original = await make()
  for (const mutate of [
    p => { p.code = 'fetch("https://example.invalid")' },
    p => { p.config.execute = 'return buy()' },
    p => { p.config.privateKey = 'test-placeholder' },
    p => { p.market.webhook = 'https://example.invalid' },
    p => { p.digest.signature = 'not-authenticated' },
    p => { Object.defineProperty(p.config, '__proto__', { value: {}, enumerable: true }) },
  ]) {
    const modified = JSON.parse(exportStrategyPackage(original)); mutate(modified)
    await assert.rejects(importStrategyPackage(JSON.stringify(modified)), /unsupported fields/)
  }
  await assert.rejects(make({ config: { ...DEFAULT_STRATEGY, evaluate: () => 'buy' } }), /unsupported fields/)
  const accessorConfig = { ...DEFAULT_STRATEGY }
  Object.defineProperty(accessorConfig, 'shortPeriod', { enumerable: true, get() { throw new Error('must not be called') } })
  await assert.rejects(make({ config: accessorConfig }), /JSON data value/)
})

test('malformed and excessively large imports fail closed', async () => {
  for (const text of ['', 'null', '[]', '{}', '{"schema":', 'function () {}', ' '.repeat(16_385)]) {
    await assert.rejects(importStrategyPackage(text), /Invalid strategy package:/)
  }
  await assert.rejects(importStrategyPackage(null), /nonempty JSON/)
})

test('strategy values must be bounded finite numbers with integer short period below long period', async () => {
  for (const [field, values] of Object.entries({
    shortPeriod: [0, -1, 1.5, 500, NaN, Infinity, '5'],
    longPeriod: [1, 501, 20.5, NaN, Infinity],
    candleIntervalMs: [1, 30_000, 120_000, NaN, Infinity],
    orderSizeUsdc: [0, -1, 0.001, 1_000_001, NaN, Infinity],
    maxAllocationPct: [0, -1, 101, NaN, Infinity],
    stopLossPct: [-1, 101, NaN, Infinity],
  })) {
    for (const value of values) await assert.rejects(make({ config: { ...DEFAULT_STRATEGY, [field]: value } }), /Invalid strategy package:/)
  }
  await assert.rejects(make({ config: { ...DEFAULT_STRATEGY, shortPeriod: 20 } }), /shortPeriod must be less/)
  const boundaries = await make({ config: {
    ...DEFAULT_STRATEGY, shortPeriod: 499, longPeriod: 500,
    orderSizeUsdc: 0.01, maxAllocationPct: 100, stopLossPct: 0,
  } })
  assert.equal(packageToConfig(boundaries).stopLossPct, 0)
})

test('user labels are bounded, plain text and versioned; digest is not an ownership or performance proof', async () => {
  for (const name of ['', ' '.repeat(3), 'A'.repeat(81), 'x\ny', 'x\u0000y']) await assert.rejects(make({ name }))
  for (const version of ['', 'latest', '1', '1.0', '01.0.0', '1.0.0;eval()']) await assert.rejects(make({ version }))
  assert.equal((await make({ name: '  내 BTC 전략  ', version: '1.0.0-beta.1' })).name, '내 BTC 전략')
  assert.match(STRATEGY_PACKAGE_DISCLOSURE, /content consistency only/)
  assert.match(STRATEGY_PACKAGE_DISCLOSURE, /does not prove performance, authorship, ownership/)
})
