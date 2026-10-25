import { ExternalLink, TrendingUp, TrendingDown, Download, Activity } from 'lucide-react'
import { Trade } from '../trading/engine'
import { buildTxExplorerUrl } from '@/onchain-facts'

const ARC_CHAIN_ID = 5042002

interface TradeHistoryProps {
  trades: Trade[]
  onExport: () => void
}

function fmt(v: number, d = 2) {
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function timeSince(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/**
 * Arc integration status display.
 *
 * States:
 *   not_submitted — paper fill only. No wallet action has been taken.
 *   awaiting_signature — wallet prompt shown.
 *   pending — tx broadcast.
 *   confirmed — real on-chain receipt. Shows tx hash + Arc Explorer link.
 *   failed — tx reverted/rejected.
 *   null — legacy record without status.
 *
 * NEVER shows a fabricated tx hash or fake explorer link.
 * A real tx hash is only present after a confirmed on-chain receipt.
 */
function ArcStatus({ trade }: { trade: Trade }) {
  if (trade.txHash && trade.arcTxStatus === 'confirmed') {
    const url = buildTxExplorerUrl(ARC_CHAIN_ID, trade.txHash)
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-xs"
        style={{ color: 'var(--success)', textDecoration: 'none' }}
        title={`Arc Explorer: ${trade.txHash}`}
      >
        {trade.txHash.slice(0, 6)}…{trade.txHash.slice(-4)}
        <ExternalLink size={9} />
      </a>
    )
  }

  const label = trade.arcTxStatus === 'not_submitted' ? 'Not submitted'
    : trade.arcTxStatus === 'awaiting_signature' ? 'Awaiting sig'
    : trade.arcTxStatus === 'pending' ? 'Pending'
    : trade.arcTxStatus === 'failed' ? 'Failed'
    : 'Not submitted'  // null / legacy

  const color = trade.arcTxStatus === 'failed' ? 'var(--danger)'
    : trade.arcTxStatus === 'pending' ? 'var(--warn)'
    : 'var(--subtle)'

  return (
    <span
      className="text-xs"
      style={{ color }}
      title="Onchain execution not connected. This is a paper fill only."
    >
      {label}
    </span>
  )
}

export function TradeHistory({ trades, onExport }: TradeHistoryProps) {
  if (trades.length === 0) {
    return (
      <div
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}
        className="p-4"
      >
        <h2 className="panel-title mb-4" style={{ color: 'var(--muted)' }}>
          Recent trades
        </h2>
        <div className="activity-empty">
          <span className="activity-empty-icon"><Activity size={20} /></span><div><strong>No trades yet</strong><p>Start the bot. Its first signal will appear here.</p></div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}
      className="overflow-x-auto"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h2 className="panel-title" style={{ color: 'var(--muted)' }}>
            Recent trades
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
            Simulated fills
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs mono tabular-nums" style={{ color: 'var(--subtle)' }}>
            {trades.length} trades
          </span>
          <button
            onClick={onExport}
            title="Export trades as CSV"
            style={{
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 8px',
              cursor: 'pointer',
              color: 'var(--muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
            }}
          >
            <Download size={11} /> CSV
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div
        className="grid px-4 py-2 text-xs uppercase tracking-widest min-w-[500px]"
        style={{
          color: 'var(--subtle)',
          borderBottom: '1px solid var(--border)',
          gridTemplateColumns: '50px minmax(110px, 1fr) minmax(95px, 1fr) minmax(85px, 1fr) 88px',
          gap: '8px',
        }}
      >
        <div>Side</div>
        <div>BTC / Price</div>
        <div>Sim Costs</div>
        <div>Sim P&L</div>
        <div className="text-right">Arc Tx</div>
      </div>

      <div className="overflow-y-auto min-w-[500px]" style={{ maxHeight: 360 }}>
        {trades.map(trade => {
          const isUp = trade.side === 'buy'
          const sideColor = isUp ? 'var(--success)' : 'var(--danger)'
          const pnl = trade.realizedPnl
          const pnlColor = pnl == null ? 'var(--subtle)' : pnl >= 0 ? 'var(--success)' : 'var(--danger)'

          return (
            <div
              key={trade.id}
              className="grid px-4 py-2.5 items-center"
              style={{
                gridTemplateColumns: '50px minmax(110px, 1fr) minmax(95px, 1fr) minmax(85px, 1fr) 88px',
                gap: '8px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {/* Side + source */}
              <div className="flex flex-col items-start gap-0.5">
                <div className="flex items-center gap-1">
                  {isUp
                    ? <TrendingUp size={13} color={sideColor} />
                    : <TrendingDown size={13} color={sideColor} />
                  }
                  <span className="text-xs font-semibold uppercase" style={{ color: sideColor }}>
                    {trade.side}
                  </span>
                </div>
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                  {trade.source}
                </span>
              </div>

              {/* BTC/Price */}
              <div>
                <div className="mono tabular-nums text-xs font-medium" style={{ color: 'var(--ink)' }}>
                  {fmt(trade.btcAmount, 6)} BTC
                </div>
                <div className="mono tabular-nums text-xs" style={{ color: 'var(--muted)' }}>
                  ${fmt(trade.execPrice)} USDT
                </div>
                <div className="text-xs" style={{ color: 'var(--subtle)' }}>
                  {timeSince(trade.timestamp)}
                </div>
              </div>

              {/* Simulated costs */}
              <div>
                <div className="mono tabular-nums text-xs" style={{ color: 'var(--muted)' }}>
                  Fee: ${fmt(trade.fee, 4)}
                </div>
                <div className="mono tabular-nums text-xs" style={{ color: 'var(--subtle)' }}>
                  Slip: ${fmt(trade.slippage, 4)}
                </div>
                <div className="mono tabular-nums text-xs" style={{ color: 'var(--subtle)' }}>
                  Gas(sim): {trade.simGasUsdc} sim
                </div>
              </div>

              {/* Simulated P&L */}
              <div>
                {pnl != null ? (
                  <>
                    <span className="mono tabular-nums text-xs font-semibold" style={{ color: pnlColor }}>
                      {pnl >= 0 ? '+' : ''}{fmt(pnl)} sim
                    </span>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                      ${fmt(trade.notional)} notional
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-xs" style={{ color: 'var(--subtle)' }}>Open</span>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                      ${fmt(trade.notional)} notional
                    </div>
                  </>
                )}
              </div>

              {/* Arc tx status */}
              <div className="text-right">
                <ArcStatus trade={trade} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
