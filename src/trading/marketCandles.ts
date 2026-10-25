import type { Candle } from './engine'
import type { HistoricalDataset } from './backtest'

export interface MarketCandle extends Candle { volume: number }
const MINUTE = 60_000
export const KLINES_URL = 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000'

/** Exchange OHLCV only. Never manufacture candles from a partial tick history. */
export function parseMarketCandles(raw: unknown, receivedAt: number): MarketCandle[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000 || !Number.isSafeInteger(receivedAt)) throw new Error('Invalid candle response.')
  const candles = raw.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 7) throw new Error('Invalid candle row.')
    const numbers = row.slice(0, 7).map(value => {
      if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) throw new Error('Invalid candle value.')
      return Number(value)
    })
    const [openTime, open, high, low, close, volume, closeTime] = numbers
    if (!numbers.every(Number.isFinite) || !Number.isSafeInteger(openTime) || openTime < 0 || openTime % MINUTE !== 0
      || closeTime !== openTime + MINUTE - 1 || openTime > receivedAt
      || low <= 0 || low > Math.min(open, close) || high < Math.max(open, close) || volume < 0) throw new Error('Invalid OHLCV candle.')
    return { openTime, open, high, low, close, closeTime, volume, closed: closeTime < receivedAt }
  })
  if (candles.some((c, i) => i > 0 && c.openTime !== candles[i - 1].openTime + MINUTE)) throw new Error('Candle history contains a gap or duplicate.')
  return candles
}

/** Skip incomplete leading groups; retain the final forming candle, labeled open. */
export function groupMarketCandles(candles: MarketCandle[], minutes: 1 | 5 | 15): MarketCandle[] {
  if (minutes === 1) return candles
  const interval = minutes * MINUTE
  const grouped: MarketCandle[] = []
  for (let i = 0; i < candles.length;) {
    const first = candles[i]
    if (first.openTime % interval !== 0) { i++; continue }
    const parts: MarketCandle[] = []
    while (i < candles.length && candles[i].openTime < first.openTime + interval) parts.push(candles[i++])
    if (parts.some((part, index) => part.openTime !== first.openTime + index * MINUTE)) continue
    // Do not turn an internal gap into an ordinary forming candle.
    if (parts.length < minutes && i < candles.length) continue
    grouped.push({ openTime: first.openTime, closeTime: first.openTime + interval - 1, open: first.open,
      high: Math.max(...parts.map(c => c.high)), low: Math.min(...parts.map(c => c.low)), close: parts[parts.length - 1].close,
      volume: parts.reduce((sum, c) => sum + c.volume, 0), closed: parts.length === minutes && parts.every(c => c.closed) })
  }
  return grouped
}

export function toHistoricalDataset(candles: MarketCandle[], receivedAt: number): HistoricalDataset {
  const closed = candles.filter(c => c.closed && c.closeTime < receivedAt)
  if (closed.length < 2) throw new Error('No completed market candles available. Try again shortly.')
  return { source: 'Binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT', retrievedAt: new Date(receivedAt).toISOString(),
    candles: closed.map(({ openTime, open, high, low, close }) => ({ openTime, open, high, low, close })) }
}

export async function fetchRecentDataset(): Promise<HistoricalDataset> {
  const response = await fetch(KLINES_URL, { signal: AbortSignal.timeout(10_000), cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error(`Market data unavailable (${response.status}). Try again or import a dataset.`)
  const raw: unknown = await response.json()
  const receivedAt = Date.now()
  return toHistoricalDataset(parseMarketCandles(raw, receivedAt), receivedAt)
}
