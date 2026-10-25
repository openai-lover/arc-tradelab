import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { evidenceHandler } from './evidence.mjs'
const root = resolve(import.meta.dirname, '..')
const port = Number(process.env.PORT ?? 4174)
const host = process.env.BIND_HOST ?? '127.0.0.1'
const origin = process.env.PUBLIC_APP_ORIGIN ?? `http://127.0.0.1:${port}`
const evidence = evidenceHandler({ directory: process.env.EVIDENCE_DIRECTORY ?? resolve(root, 'evidence-data'), origin })
const dist = resolve(root, 'dist')
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
createServer((req, res) => {
  void evidence(req, res, async () => {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
    try {
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname)
      const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!path.startsWith(dist + sep)) throw new Error('Invalid path')
      const bytes = await readFile(path)
      res.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' }); res.end(bytes)
    } catch { res.writeHead(404); res.end('Not found') }
  })
}).listen(port, host, () => console.log(`Arc TradeLab app and immutable evidence service: ${origin}`))
