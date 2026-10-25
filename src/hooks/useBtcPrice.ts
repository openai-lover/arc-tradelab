/**
 * useBtcPrice — live BTC/USDT price from Binance public API.
 *
 * PAIR:     BTCUSDT (Bitcoin priced in Tether / USDT, NOT USD)
 * PROVIDER: Binance public WebSocket and REST API (no API key required)
 * TERMS:    https://www.binance.com/en/terms
 *
 * Primary:  WebSocket stream `wss://stream.binance.com:9443/ws/btcusdt@trade`
 *   Each message is a real-time trade tick: { p: "price", T: marketTimestampMs }
 * Fallback: REST poll every 5 seconds via `/api/v3/ticker/price?symbol=BTCUSDT`
 *   REST does not provide a market timestamp; we record the local receive time.
 *
 * Stale threshold: 10 seconds without any update → isStale = true
 * Strategy auto-pauses when isStale = true; new orders are blocked.
 *
 * Also provides raw tick history for candle aggregation by useTradingState.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Candle } from '../trading/engine'
import { KLINES_URL, parseMarketCandles } from '../trading/marketCandles'
import type { MarketCandle } from '../trading/marketCandles'

export const STALE_THRESHOLD_MS = 10_000

export interface PricePoint {
  time: number    // local receive time (epoch ms)
  marketTime: number | null  // exchange trade timestamp (ms) — null for REST
  price: number
}

export interface BtcPriceState {
  price: number | null
  prevPrice: number | null
  history: PricePoint[]         // raw ticks, max 500
  closedCandles: Candle[] // independent of tick rate; fetched from closed exchange klines
  chartCandles: MarketCandle[]
  candlesUpdatedAt: number | null
  isStale: boolean
  lastUpdated: number | null    // local time of last received tick
  lastMarketTime: number | null // exchange timestamp of last WS trade
  source: 'ws' | 'rest' | null
  /** Confirmed BTCUSDT pair — quote is USDT, not USD */
  quoteCurrency: 'USDT'
  provider: 'Binance'
  /** True if WS is connected; false during REST-only fallback or startup */
  wsConnected: boolean
}

const MAX_HISTORY = 500

interface BinanceTradeMsg {
  e?: string   // event type: 'trade'
  p?: string   // price string
  T?: number   // trade time ms (market timestamp)
}

interface BinanceTickerResponse {
  price: string
}

async function fetchRestPrice(): Promise<{ price: number; localTime: number }> {
  const r = await fetch('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error(`REST ${r.status}`)
  const d = (await r.json()) as BinanceTickerResponse
  return { price: parseFloat(d.price), localTime: Date.now() }
}

export function useBtcPrice(): BtcPriceState {
  const [state, setState] = useState<BtcPriceState>({
    price: null, prevPrice: null, history: [], closedCandles: [], chartCandles: [], candlesUpdatedAt: null,
    isStale: true, lastUpdated: null, lastMarketTime: null,
    source: null, quoteCurrency: 'USDT', provider: 'Binance', wsConnected: false,
  })
  const wsRef = useRef<WebSocket | null>(null)
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsConnectedRef = useRef(false)
  const latestExchangeTimeRef = useRef(0)
  const aliveRef = useRef(false)
  const feedGenerationRef = useRef(0)
  const lastAcceptedTickRef = useRef(0)

  const armStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    const age = lastAcceptedTickRef.current ? Date.now() - lastAcceptedTickRef.current : 0
    staleTimerRef.current = setTimeout(() => {
      if (!aliveRef.current) return
      setState(s => ({ ...s, isStale: true }))
      // An open socket is not proof of a healthy feed. Reconnect a silent socket
      // so its close handler also restores the public REST fallback.
      if (wsConnectedRef.current) wsRef.current?.close()
    }, Math.max(0, STALE_THRESHOLD_MS - age))
  }, [])

  const pushPrice = useCallback((price: number, src: 'ws' | 'rest', marketTime: number | null = null) => {
    const now = Date.now()
    if (!aliveRef.current || !Number.isFinite(price) || price <= 0) return
    if (src === 'ws') {
      if (marketTime === null || !Number.isFinite(marketTime)
          || marketTime < latestExchangeTimeRef.current || marketTime > now + 2000
          || now - marketTime > STALE_THRESHOLD_MS) return
      latestExchangeTimeRef.current = marketTime
    } else if (wsConnectedRef.current) return // don't let an in-flight poll overwrite WS data
    lastAcceptedTickRef.current = now
    setState(prev => {
      const newPoint: PricePoint = { time: now, marketTime, price }
      const history = [...prev.history, newPoint].slice(-MAX_HISTORY)
      return {
        ...prev,
        price,
        prevPrice: prev.price,
        history,
        isStale: false,
        lastUpdated: now,
        lastMarketTime: marketTime,
        source: src,
        wsConnected: wsConnectedRef.current,
      }
    })

    armStaleTimer()
  }, [armStaleTimer])

  const startRest = useCallback(() => {
    if (restIntervalRef.current) return
    const generation = feedGenerationRef.current
    const poll = () => {
      void fetchRestPrice().then(({ price }) => {
        // Strict Mode cleanup/remount must not revive an older pending request.
        if (generation === feedGenerationRef.current) pushPrice(price, 'rest', null)
      }).catch(() => {})
    }
    poll()
    restIntervalRef.current = setInterval(poll, 5000)
  }, [pushPrice])

  const stopRest = useCallback(() => {
    if (restIntervalRef.current) { clearInterval(restIntervalRef.current); restIntervalRef.current = null }
  }, [])

  useEffect(() => {
    let alive = true
    aliveRef.current = true
    feedGenerationRef.current += 1
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    // Candle history must survive bursts of thousands of ticks per minute.
    // Historical candles warm the indicators; Start still skips historical signals.
    const loadCandles = async () => {
      try {
        const response = await fetch(KLINES_URL, { signal: AbortSignal.timeout(5000), cache: 'no-store', credentials: 'omit' })
        if (!response.ok) return
        const raw: unknown = await response.json()
        const now = Date.now()
        const chartCandles = parseMarketCandles(raw, now)
        const candles = chartCandles.filter(c => c.closed)
        if (!candles.length) return
        if (alive) setState(s => {
          const previous = s.closedCandles[s.closedCandles.length - 1]
          // A delayed older response must not move the strategy clock backwards.
          return previous && previous.openTime > candles[candles.length - 1].openTime
            ? s : { ...s, closedCandles: candles, chartCandles, candlesUpdatedAt: now }
        })
      } catch { /* Keep previous history; stale candle age blocks strategy execution. */ }
    }
    void loadCandles()
    const candleTimer = setInterval(() => { void loadCandles() }, 15_000)

    function connect() {
      if (!alive) return
      const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade')
      wsRef.current = ws

      ws.onopen = () => {
        if (!alive || wsRef.current !== ws) return
        wsConnectedRef.current = true
        setState(s => ({ ...s, wsConnected: true }))
        stopRest()
        armStaleTimer()
      }

      ws.onmessage = (e) => {
        if (!alive || wsRef.current !== ws) return
        try {
          const raw = JSON.parse(e.data as string) as BinanceTradeMsg
          const price = parseFloat(raw.p ?? '')
          const marketTime = typeof raw.T === 'number' ? raw.T : null
          if (!isNaN(price)) pushPrice(price, 'ws', marketTime)
        } catch { /* skip malformed message */ }
      }

      ws.onerror = () => {
        if (!alive || wsRef.current !== ws) return
        wsConnectedRef.current = false
        setState(s => ({ ...s, wsConnected: false }))
        startRest()
      }

      ws.onclose = () => {
        if (!alive || wsRef.current !== ws) return
        wsConnectedRef.current = false
        setState(s => ({ ...s, wsConnected: false }))
        startRest()
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    startRest() // seed immediately while WS connects
    connect()

    return () => {
      alive = false
      aliveRef.current = false
      clearInterval(candleTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      stopRest()
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
      wsConnectedRef.current = false
    }
  }, [pushPrice, startRest, stopRest, armStaleTimer])

  return state
}
