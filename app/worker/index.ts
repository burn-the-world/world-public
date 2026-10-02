import { observeUpstream } from './observe'
import { sharedResponse, type WorkerCache } from './shared'
import activeNetwork from '@world-network'
import { parseData } from '../src/dataCodec'
export interface Env {
  NODEREAL_RPC_URL?: string
  NODEREAL_MAINNET_RPC_URL?: string
  WORLD_NETWORK?: string
  MAINNET_ENABLED?: string
  LOCAL_WORLD_FIXTURE?: string
  ASSETS: { fetch(request: Request): Promise<Response> }
}

// Read/simulation only. Wallet signing and transaction submission stay in the wallet.
const METHODS = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_getLogs',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount',
  'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
])
const MAX_BODY = 256 * 1024
const MAX_BATCH = 100
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const verified = new WeakMap<Env, { target: string; expires: number; pending: Promise<boolean> }>()
async function verifyNetwork(env: Env, target: URL): Promise<boolean> {
  let chainId = activeNetwork.chainId
  if (env.LOCAL_WORLD_FIXTURE) {
    if (activeNetwork.network !== 'testnet') return false
    const fixture = parseData(env.LOCAL_WORLD_FIXTURE) as { chainId: number }
    if (![31359, 31360].includes(fixture.chainId)) return false
    chainId = fixture.chainId
  }
  const cached = verified.get(env)
  if (cached?.target === target.href && cached.expires > Date.now()) return cached.pending
  const pending = (async () => {
    const started = performance.now(); let status = 0
    try {
      const result = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'world-network-check', method: 'eth_chainId', params: [] }), redirect: 'manual', signal: AbortSignal.timeout(20_000) })
      status = result.status
      const value = await result.clone().json() as { result?: string; error?: unknown }
      return result.ok && !value.error && value.result === `0x${chainId.toString(16)}`
    } catch { return false }
    finally { observeUpstream(1, status, performance.now() - started) }
  })()
  const entry = { target: target.href, expires: Date.now() + 60_000, pending }; verified.set(env, entry)
  if (!await pending && verified.get(env) === entry) verified.delete(env)
  return pending
}
function failure(status: number, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }), { status, headers })
}
function valid(item: unknown): item is Record<string, unknown> {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const x = item as Record<string, unknown>
  return x.jsonrpc === '2.0' && typeof x.method === 'string'
    && (x.id === null || typeof x.id === 'string' || (typeof x.id === 'number' && Number.isSafeInteger(x.id)))
    && (x.params === undefined || Array.isArray(x.params) || (!!x.params && typeof x.params === 'object'))
    && Object.keys(x).every(k => ['jsonrpc', 'id', 'method', 'params'].includes(k))
}

export default {
  async fetch(request: Request, env: Env, ctx?: import('./leaderboardCache').Background): Promise<Response> {
    const url = new URL(request.url)
    if ((url.pathname === '/rpc' || url.pathname.startsWith('/api/')) && env.WORLD_NETWORK && env.WORLD_NETWORK !== activeNetwork.network) return failure(503, -32000, 'Worker network configuration mismatch')
    if (url.pathname.startsWith('/api/')) return sharedResponse(request, env, (r, e) => this.fetch(r, e), (globalThis as unknown as { caches: { default: WorkerCache } }).caches.default, ctx)
    if (url.pathname !== '/rpc') return env.ASSETS.fetch(request)
    if (request.method !== 'POST') return new Response('POST required', { status: 405, headers: { Allow: 'POST' } })
    // Not authentication: prevents other browser origins from spending this endpoint's quota.
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) return failure(403, -32600, 'Cross-origin request denied')
    if (url.search) return failure(400, -32600, 'Query parameters are not accepted')
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return failure(415, -32600, 'JSON required')
    if (Number(request.headers.get('content-length')) > MAX_BODY) return failure(413, -32600, 'Request too large')
    let body: string
    try {
      const reader = request.body?.getReader()
      if (!reader) return failure(400, -32600, 'Body required')
      const chunks: Uint8Array[] = []; let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BODY) { await reader.cancel(); return failure(413, -32600, 'Request too large') }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch { return failure(400, -32700, 'Invalid body') }
    let input: unknown
    try { input = JSON.parse(body) } catch { return failure(400, -32700, 'Invalid JSON') }
    const batch = Array.isArray(input) ? input : [input]
    if (!batch.length || batch.length > MAX_BATCH || !batch.every(valid)) return failure(400, -32600, 'Invalid JSON-RPC request')
    if (!batch.every(x => METHODS.has(x.method as string))) return failure(403, -32601, 'Read-only method required')
    // Reject duplicate ids to keep batch response correlation unambiguous.
    if (new Set(batch.map(x => JSON.stringify(x.id))).size !== batch.length) return failure(400, -32600, 'Duplicate request id')
    let target: URL
    try {
      target = new URL((activeNetwork.network === 'mainnet' ? env.NODEREAL_MAINNET_RPC_URL : env.NODEREAL_RPC_URL) || '')
      if (target.protocol !== 'https:' || target.hostname !== activeNetwork.rpcHost
        || target.port || target.username || target.password || !/^\/v1\/[^/]+$/.test(target.pathname)
        || target.search || target.hash) throw new Error()
    } catch { return failure(503, -32000, 'RPC secret is not configured') }
    if (!await verifyNetwork(env, target)) return failure(502, -32000, 'RPC network verification failed')
    const started = performance.now(); let upstreamStatus = 0
    try {
      const upstream = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body,
        redirect: 'manual', signal: AbortSignal.timeout(20_000) })
      upstreamStatus = upstream.status
      const response = await upstream.text()
      // Never forward upstream headers or a diagnostic that contains the credential.
      if (response.includes(target.href) || response.includes(target.pathname.slice(4))) return failure(502, -32000, 'Upstream response rejected')
      try { JSON.parse(response) } catch { return failure(502, -32000, 'Invalid upstream response') }
      return new Response(response, { status: upstream.status, headers })
    } catch { return failure(502, -32000, 'RPC upstream unavailable') }
    finally { observeUpstream(batch.length, upstreamStatus, performance.now() - started) }
  },
}
