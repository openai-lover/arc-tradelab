import { createHash, randomBytes } from 'node:crypto'
import { getAddress, verifyMessage } from 'viem'
import { importPublicationBundle } from '../src/marketplace/publication.ts'

const sha = text => createHash('sha256').update(text).digest('hex')
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
async function readBody(request, maxBytes) {
  const reader = request.body?.getReader(); if (!reader) throw new Error('Missing request body')
  const chunks = []; let size = 0
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error('Upload is too large for this host') } chunks.push(value) } }
  finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Netlify site-wide Blobs: CAS for nonce consumption and quotas, create-only content.
 * Cold starts and concurrent functions do not rely on process memory or /tmp files. */
export function blobEvidenceHandler({ store, origin, now = Date.now, maxBytes = 1024 * 1024 * 1024, maxFiles = 2000 }) {
  const canonicalOrigin = new URL(origin).origin
  const publicHosting = canonicalOrigin.startsWith('https://') && !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
  async function mutate(update) {
    for (let i = 0; i < 8; i++) {
      const previous = await store.getWithMetadata('control-v1', { type: 'json', consistency: 'strong' })
      if (previous && (typeof previous.etag !== 'string' || !previous.etag)) throw new Error('Storage cannot safely coordinate concurrent uploads')
      const state = previous?.data ?? { challenges: {}, attempts: {}, files: 0, bytes: 0 }
      const result = update(state)
      const written = await store.setJSON('control-v1', state, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true })
      if (written.modified) return result
    }
    throw new Error('Other uploads are in progress. Try again shortly.')
  }
  return async (request, ip = 'unknown') => {
    try {
      const url = new URL(request.url)
      const file = /^\/evidence\/([a-f0-9]{64})\.json$/.exec(url.pathname)
      if (file && request.method === 'GET') {
        const text = await store.get(`files/${file[1]}`, { type: 'text', consistency: 'strong' })
        if (text === null) return json(404, { error: 'File not found' })
        if (sha(text) !== file[1]) throw new Error('Stored file integrity failure')
        return new Response(text, { headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'public,max-age=31536000,immutable', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } })
      }
      if (url.pathname === '/api/evidence/status' && request.method === 'GET') {
        // A real read confirms the durable store is available in this deployment.
        await store.get('control-v1', { type: 'text', consistency: 'strong' })
        return json(200, { available: true, publicHosting, origin: canonicalOrigin, maxBundleBytes: MAX_BUNDLE_BYTES })
      }
      if (!publicHosting || url.origin !== canonicalOrigin || request.headers.get('origin') !== canonicalOrigin || request.method !== 'POST' || !request.headers.get('content-type')?.startsWith('application/json')) return json(403, { error: 'Same-origin public HTTPS JSON request required' })
      if (url.pathname === '/api/evidence/challenge') {
        const { address, digest } = await readBody(request, 2048); const wallet = getAddress(address)
        if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid file digest')
        const time = now(); const nonce = randomBytes(24).toString('hex'); const expires = time + 300000
        const message = `Arc TradeLab public evidence upload\nOrigin: ${canonicalOrigin}\nWallet: ${wallet}\nBundle SHA-256: ${digest}\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}\nPublish this exact bot bundle and report publicly. This signature does not approve tokens or authorize a payment.`
        await mutate(state => {
          for (const [key, entry] of Object.entries(state.challenges)) if (entry.expires < time) delete state.challenges[key]
          for (const [key, entry] of Object.entries(state.attempts)) if (time - entry.started >= 60000) delete state.attempts[key]
          const key = sha(ip); const rate = state.attempts[key] ?? { started: time, count: 0 }
          if (++rate.count > 10 || Object.keys(state.challenges).length >= 100 || Object.keys(state.attempts).length >= 1000) throw new Error('Upload rate limit; try later')
          state.attempts[key] = rate; state.challenges[nonce] = { address: wallet, digest, expires, message }
        })
        return json(200, { nonce, message })
      }
      if (url.pathname !== '/api/evidence/publish') return json(404, { error: 'Not found' })
      const { nonce, signature, bundle } = await readBody(request, 4 * 1024 * 1024)
      if (typeof nonce !== 'string' || !/^[a-f0-9]{48}$/.test(nonce) || typeof bundle !== 'string' || Buffer.byteLength(bundle) > MAX_BUNDLE_BYTES) throw new Error('Invalid upload or bundle exceeds 2 MB')
      const challenge = await mutate(state => {
        const value = state.challenges[nonce]
        if (!value || value.expires < now()) throw new Error('Upload intent expired or already used')
        delete state.challenges[nonce]; return value
      })
      if (sha(bundle) !== challenge.digest || !await verifyMessage({ address: challenge.address, message: challenge.message, signature })) throw new Error('File changed or invalid upload signature')
      const data = JSON.parse(bundle)
      if (typeof data.strategyText !== 'string' || typeof data.reportText !== 'string' || typeof data.termsText !== 'string') throw new Error('Expected evidence bundle')
      const publication = await importPublicationBundle(bundle, { strategySha256: `0x${sha(data.strategyText)}`, reportSha256: `0x${sha(data.reportText)}`, termsSha256: `0x${sha(data.termsText)}` })
      const files = [[sha(bundle), bundle], [sha(publication.reportText), publication.reportText]]
      const additionalBytes = files.reduce((sum, [, text]) => sum + Buffer.byteLength(text), 0)
      // Reserve before writing. Failures may conservatively consume quota, never exceed it.
      await mutate(state => { if (state.files + 2 > maxFiles || state.bytes + additionalBytes > maxBytes) throw new Error('Evidence storage quota reached'); state.files += 2; state.bytes += additionalBytes })
      for (const [id, text] of files) {
        const { modified } = await store.set(`files/${id}`, text, { onlyIfNew: true })
        if (!modified && await store.get(`files/${id}`, { type: 'text', consistency: 'strong' }) !== text) throw new Error('Stored file integrity failure')
      }
      return json(201, { publicHosting, artifactURI: `${canonicalOrigin}/evidence/${files[0][0]}.json`, reportURI: `${canonicalOrigin}/evidence/${files[1][0]}.json` })
    } catch (e) { return json(400, { error: e instanceof Error ? e.message : 'Evidence request failed' }) }
  }
}
