import { useEffect, useRef, useState } from 'react'

/** Match the SVG coordinate system to its rendered width so axis labels stay readable. */
export function usePlotWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const measured = Math.round(entries[0]?.contentRect.width ?? 0)
      if (measured > 0) setWidth(Math.max(280, measured))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}
