import type { HistoricalDataset } from './backtest'

export const DEMO_SOURCE = 'Arc TradeLab synthetic tutorial (not market data)'

/** Deterministic teaching data. Never attribute to an exchange or sell as historical evidence. */
export function createDemoDataset(): HistoricalDataset {
  const start = Date.UTC(2024, 0, 1)
  const price = (i: number) => 42000 + Math.sin(i / 23) * 320 + Math.sin(i / 61) * 510 + i * .12
  return {
    source: DEMO_SOURCE, symbol: 'BTCUSDT', quoteCurrency: 'USDT',
    retrievedAt: new Date(start + 720 * 60_000).toISOString(),
    candles: Array.from({ length: 720 }, (_, i) => {
      const open = price(i), close = price(i + 1)
      return { openTime: start + i * 60_000, open, close, high: Math.max(open, close) + 18, low: Math.min(open, close) - 18 }
    }),
  }
}
