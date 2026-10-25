import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { getAddress, verifyMessage } from 'viem'
import { importPublicationBundle } from '../src/marketplace/publication.ts'

const LIMIT = 20 * 1024 * 1024
const sha = text => createHash('sha256').update(text).digest('hex')
const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)) }
async function body(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > LIMIT) throw new Error('Upload exceeds 20 MB'); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Immutable exact files, signed upload intent, bounded quota. Configure a durable disk
 * and PUBLIC_APP_ORIGIN before public use. No server-side wallet or payment signing. */
export function evidenceHandler({ directory, origin }) {
  const root = resolve(directory)
  const canonicalOrigin = new URL(origin).origin
  const publicHosting = canonicalOrigin.startsWith('https://') && !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
  const challenges = new Map(); const attempts = new Map()
  let uploads = Promise.resolve()
  return async (req, res, next = () => reply(res, 404, { error: 'Not found' })) => {
    const url = new URL(req.url, canonicalOrigin)
    if (!url.pathname.startsWith('/api/evidence/') && !url.pathname.startsWith('/evidence/')) return next()
    try {
      const file = /^\/evidence\/([a-f0-9]{64})\.json$/.exec(url.pathname)
      if (file && req.method === 'GET') {
        const bytes = await readFile(join(root, `${file[1]}.json`))
        if (sha(bytes) !== file[1]) throw new Error('Stored file integrity failure')
        res.writeHead(200, { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'public,max-age=31536000,immutable', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' }); res.end(bytes); return
      }
      if (url.pathname === '/api/evidence/status' && req.method === 'GET') return reply(res, 200, { available: true, publicHosting, origin: canonicalOrigin })
      if (req.method !== 'POST' || req.headers.origin !== canonicalOrigin || !req.headers['content-type']?.startsWith('application/json')) return reply(res, 403, { error: 'Same-origin JSON request required' })
      if (url.pathname === '/api/evidence/challenge') {
        const { address, digest } = await body(req); getAddress(address)
        if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid file digest')
        const now = Date.now()
        for (const [key, entry] of challenges) if (entry.expires < now) challenges.delete(key)
        for (const [key, entry] of attempts) if (now - entry.started > 60000) attempts.delete(key)
        const ip = req.socket.remoteAddress ?? 'unknown'; const rate = attempts.get(ip) ?? { started: now, count: 0 }
        if (++rate.count > 10 || challenges.size >= 100) throw new Error('Upload rate limit; try later')
        attempts.set(ip, rate)
        const nonce = randomBytes(24).toString('hex'); const expires = now + 300000
        const message = `Arc TradeLab public evidence upload\nOrigin: ${canonicalOrigin}\nWallet: ${getAddress(address)}\nBundle SHA-256: ${digest}\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}\nPublish this exact bot bundle and report publicly. This signature does not approve tokens or authorize a payment.`
        challenges.set(nonce, { address: getAddress(address), digest, expires, message })
        return reply(res, 200, { nonce, message })
      }
      if (url.pathname !== '/api/evidence/publish') return reply(res, 404, { error: 'Not found' })
      const { nonce, signature, bundle } = await body(req)
      const challenge = challenges.get(nonce); challenges.delete(nonce)
      if (!challenge || challenge.expires < Date.now() || typeof bundle !== 'string' || sha(bundle) !== challenge.digest) throw new Error('Upload intent expired or file changed')
      if (!await verifyMessage({ address: challenge.address, message: challenge.message, signature })) throw new Error('Invalid upload signature')
      // Validate/recompute before durable publication. No executable files are accepted.
      const data = JSON.parse(bundle)
      if (typeof data.strategyText !== 'string' || typeof data.reportText !== 'string' || typeof data.termsText !== 'string') throw new Error('Expected evidence bundle')
      const publication = await importPublicationBundle(bundle, {
        strategySha256: `0x${sha(data.strategyText)}`, reportSha256: `0x${sha(data.reportText)}`, termsSha256: `0x${sha(data.termsText)}`,
      })
      const bundleId = sha(bundle); const reportId = sha(publication.reportText)
      const store = async () => {
        await mkdir(root, { recursive: true })
        const files = (await readdir(root)).filter(n => /^[a-f0-9]{64}\.json$/.test(n))
        const sizes = await Promise.all(files.map(n => stat(join(root, n))))
        if (files.length >= 2000 || sizes.reduce((sum, s) => sum+s.size, 0) + Buffer.byteLength(bundle) + Buffer.byteLength(publication.reportText) > 1024*1024*1024) throw new Error('Evidence storage quota reached')
        for (const [id, text] of [[bundleId, bundle], [reportId, publication.reportText]]) {
          try { await writeFile(join(root, `${id}.json`), text, { flag: 'wx' }) }
          catch (e) { if (e.code !== 'EEXIST' || sha(await readFile(join(root, `${id}.json`))) !== id) throw e }
        }
      }
      const pending = uploads.then(store); uploads = pending.catch(() => {}); await pending
      reply(res, 201, { publicHosting, artifactURI: `${canonicalOrigin}/evidence/${bundleId}.json`, reportURI: `${canonicalOrigin}/evidence/${reportId}.json` })
    } catch (error) {
      reply(res, error?.code === 'ENOENT' ? 404 : 400, { error: error?.code === 'ENOENT' ? 'File not found' : error instanceof Error ? error.message : 'Upload failed' })
    }
  }
}
