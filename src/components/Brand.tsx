/**
 * Brand — TradeLab wordmark from the user-supplied bitmap.
 *
 * The source image (2048×682) has empty space around the visible mark:
 *   horizontal: ~6.5% left, ~6.5% right  → visible width ≈ 87% of total
 *   vertical:   ~29%  top,  ~27%  bottom  → visible height ≈ 44% of total
 *
 * We render the image at a size where the visible region fills the container,
 * then clip the surrounding empty pixels with overflow:hidden + negative margins.
 *
 * Desktop: container 168px wide → full img width = 168 / 0.87 ≈ 193px
 *          container height ≈ 193 × (682/2048) × 0.44 ≈ 28px
 * Mobile:  container 128px wide → full img width ≈ 147px / height ≈ 21px
 */
import logoUrl from '../../public/brand/tradelab-user-logo.webp'

export function Brand() {
  return (
    <span className="brand-wordmark" aria-label="TradeLab">
      <img
        src={logoUrl}
        alt="TradeLab"
        className="brand-wordmark-img"
        width={193}
        height={28}
        loading="eager"
        decoding="sync"
      />
    </span>
  )
}

/** Original candle motif; no performance data is implied by this decorative icon. */
export function BotGlyph({ variant = 0 }: { variant?: number }) {
  return <span className={`bot-glyph bot-glyph-${variant % 3}`} aria-hidden="true"><svg viewBox="0 0 40 40" fill="none">
    <path d="M11 17v15M20 8v21M29 5v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <rect x="7.5" y="21" width="7" height="7" rx="2" fill="currentColor" />
    <rect x="16.5" y="12" width="7" height="12" rx="2" fill="currentColor" />
    <rect x="25.5" y="8" width="7" height="8" rx="2" fill="currentColor" />
  </svg></span>
}
