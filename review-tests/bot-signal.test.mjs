import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextBotSignal } from '../src/onchain/botSignal.ts'
const candles = [100, 100, 99, 105].map((close, i) => ({ open: close, high: close, low: close, close, openTime: i*60000, closeTime: (i+1)*60000-1, closed: true }))
const run = { rules: { shortPeriod: 2, longPeriod: 3, order6: 10000000n, budget6: 100000000n, allocationBps: 8000, stopLossBps: 500 },
  state: { funded: true, closed: false, cash6: 100000000n, cost6: 0n, btc8: 0n, sequence: 0n }, expiresAt: 86400n }
test('testnet engine emits new closed-candle SMA signal only, never historical replay', () => {
  assert.equal(nextBotSignal(run, candles, 120000, 240005).side, 'buy')
  assert.equal(nextBotSignal(run, candles, 180000, 240005), null)
  assert.equal(nextBotSignal(run, candles, 120000, 280005), null)
  assert.equal(nextBotSignal(run, candles.slice(1), 0, 240005), null)
})
test('testnet limits enforce expiry, closed session, order cap and all-in allocation', () => {
  for (const state of [{ closed: true }, { funded: false }, { sequence: 200n }]) assert.equal(nextBotSignal({ ...run, state: { ...run.state, ...state } }, candles, 0, 240005), null)
  assert.equal(nextBotSignal({ ...run, expiresAt: 240n }, candles, 0, 240005), null)
  for (const state of [{ cash6: 10000000n }, { cost6: 75000000n }]) assert.equal(nextBotSignal({ ...run, state: { ...run.state, ...state } }, candles, 0, 240005).side, null)
})
test('testnet close-based stop overrides simultaneous buy and cannot sell an empty position', () => {
  const positioned = { ...run, state: { ...run.state, btc8: 10000000n, cost6: 12000000n } }
  assert.equal(nextBotSignal(positioned, candles, 0, 240005).side, 'sell')
  const falling = [100, 100, 101, 90].map((close, i) => ({ ...candles[i], open: close, high: close, low: close, close }))
  assert.equal(nextBotSignal(run, falling, 0, 240005).side, null)
})
