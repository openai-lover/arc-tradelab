import { getStore } from '@netlify/blobs'
import { blobEvidenceHandler } from '../../server/blobEvidence.mjs'

export default async (request, context) => {
  const origin = process.env.PUBLIC_APP_ORIGIN || process.env.URL
  if (!origin) return Response.json({ error: 'Public hosting origin is not configured' }, { status: 503 })
  try {
    const store = getStore('arctradelab-public-evidence-v1')
    return await blobEvidenceHandler({ store, origin })(request, context.ip)
  } catch { return Response.json({ error: 'Durable evidence storage is unavailable' }, { status: 503 }) }
}
export const config = { path: ['/api/evidence/:action', '/evidence/:filename'] }
