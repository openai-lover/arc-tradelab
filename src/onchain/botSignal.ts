import { detectMaCrossover } from '../trading/engine.ts'
import type { Candle, StrategyConfig } from '../trading/engine.ts'
import { canEvaluateLiveCandles } from '../trading/liveGuards.ts'
import type { VaultSnapshot } from './contracts.ts'

export function vaultConfig(snapshot: VaultSnapshot): StrategyConfig {
  const r = snapshot.rules
  return { shortPeriod: r.shortPeriod, longPeriod: r.longPeriod, candleIntervalMs: 60000,
    orderSizeUsdc: Number(r.order6) / 1e6, maxAllocationPct: r.allocationBps / 100, stopLossPct: r.stopLossBps / 100 }
}
export function nextBotSignal(snapshot: VaultSnapshot, candles: Candle[], lastEvaluated: number, now: number) {
  const config = vaultConfig(snapshot)
  if (snapshot.state.closed || !snapshot.state.funded || Number(snapshot.expiresAt) * 1000 <= now
      || snapshot.state.sequence >= 200n || candles.length < config.longPeriod + 1
      || !canEvaluateLiveCandles(candles, config, lastEvaluated, now)) return null
  const latest = candles[candles.length - 1]
  const s = snapshot.state
  const stop = s.btc8 > 0n && config.stopLossPct > 0
    && latest.close <= (Number(s.cost6) / 1e6) / (Number(s.btc8) / 1e8) * (1 - config.stopLossPct / 100)
  const signal = detectMaCrossover(candles, config.shortPeriod, config.longPeriod)
  const side = (stop || signal?.signal === -1) && s.btc8 > 0n ? 'sell' : signal?.signal === 1 ? 'buy' : null
  const cost6 = snapshot.rules.order6 + snapshot.rules.order6 * 10n / 10000n
  const canBuy = cost6 <= s.cash6 && s.cost6 + cost6 <= snapshot.rules.budget6 * BigInt(snapshot.rules.allocationBps) / 10000n
  return { candle: latest.openTime, side: side === 'buy' && !canBuy ? null : side }
}
