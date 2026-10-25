import { getAddress } from 'viem'
import type { Address, Hash } from 'viem'
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('')
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid hosting response')
  return value as Record<string, unknown>
}
async function post(path: string, data: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit', redirect: 'error', body: JSON.stringify(data), signal: AbortSignal.timeout(60000) })
  const json = record(await r.json())
  if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Evidence hosting failed')
  return json
}
export async function publishEvidence(bundle: string, address: Address, sign: (message: string) => Promise<Hash>) {
  const response = await fetch('/api/evidence/status', { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Public evidence hosting is not configured on this deployment. Use the external HTTPS/IPFS fields below.')
  const status = record(await response.json())
  if (!status.publicHosting || status.origin !== window.location.origin) throw new Error('A public HTTPS deployment with durable evidence storage is required before publishing.')
  if (typeof status.maxBundleBytes === 'number' && new TextEncoder().encode(bundle).length > status.maxBundleBytes) throw new Error('This host supports bundles up to 2 MB. Use external HTTPS/IPFS hosting for a larger experiment.')
  const hash = await digest(bundle)
  const challenge = await post('/api/evidence/challenge', { address, digest: hash })
  if (typeof challenge.nonce !== 'string' || !/^[a-f0-9]{48}$/.test(challenge.nonce) || typeof challenge.message !== 'string') throw new Error('Invalid upload challenge')
  const prefix = `Arc TradeLab public evidence upload\nOrigin: ${window.location.origin}\nWallet: ${getAddress(address)}\nBundle SHA-256: ${hash}\nNonce: ${challenge.nonce}\nExpires: `
  const suffix = '\nPublish this exact bot bundle and report publicly. This signature does not approve tokens or authorize a payment.'
  if (!challenge.message.startsWith(prefix) || !challenge.message.endsWith(suffix)) throw new Error('Unexpected upload authorization message')
  const expires = Date.parse(challenge.message.slice(prefix.length, -suffix.length))
  if (!Number.isFinite(expires) || expires < Date.now() || expires > Date.now()+301000) throw new Error('Upload authorization expired')
  const signature = await sign(challenge.message)
  const result = await post('/api/evidence/publish', { nonce: challenge.nonce, signature, bundle })
  const expectedBundle = `${window.location.origin}/evidence/${hash}.json`
  const reportText = record(JSON.parse(bundle)).reportText
  if (typeof reportText !== 'string') throw new Error('Missing report bytes')
  const reportHash = await digest(reportText)
  if (result.artifactURI !== expectedBundle || result.reportURI !== `${window.location.origin}/evidence/${reportHash}.json`) throw new Error('Hosting returned unexpected file URLs')
  return { artifactURI: expectedBundle, reportURI: `${window.location.origin}/evidence/${reportHash}.json` }
}
