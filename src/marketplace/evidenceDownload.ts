const MAX_BYTES = 20 * 1024 * 1024

export function evidenceUrl(uri: string): string {
  // IPFS uses an explicit public gateway; ordinary HTTPS must permit CORS.
  if (/^ipfs:\/\/[A-Za-z0-9]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/.test(uri)) return `https://ipfs.io/ipfs/${uri.slice(7)}`
  const url = new URL(uri)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || !host.includes('.') || host.endsWith('.') || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)
    || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')) throw new Error('Use a public HTTPS or IPFS evidence URL.')
  return url.href
}

/** Explicit user action only. No credentials/referrer/redirects; bound actual bytes. */
export async function downloadEvidence(uri: string): Promise<string> {
  const response = await fetch(evidenceUrl(uri), { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.ok || !response.body) throw new Error('Evidence download failed. Download the bundle yourself and import it below.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let total = 0, text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES) throw new Error('Evidence bundle exceeds 20 MB.')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
