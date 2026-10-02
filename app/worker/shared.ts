import { observeCache } from './observe'
import { custom } from 'viem'
import { createWorldReader } from '../src/chain'
import { parseData, serializeData } from '../src/dataCodec'
import { cachedLeaderboard, type Background } from './leaderboardCache'
import { syncLeaderboard, validateCheckpoint } from './leaderboardIndex'
import type { LeaderboardCheckpoint } from '../src/leaderboard'
import type { Env } from './index'
import { networkConfig, deploymentConfigured, transactionsEnabled, type WorldConfig } from '../src/config'
import activeNetwork from '@world-network'

const production = networkConfig(activeNetwork, 'https://internal.invalid/rpc')
export interface WorkerCache { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> }
const services = new WeakMap<Env, ReturnType<typeof service>>()
const flights = new Map<string, Promise<Response>>()
function service(env: Env, rpc: (request: Request, env: Env) => Promise<Response>) {
  // Optional local test fixture is a runtime binding, never a request parameter or upstream URL.
  const config = env.LOCAL_WORLD_FIXTURE ? parseData(env.LOCAL_WORLD_FIXTURE) as WorldConfig : production
  if (env.LOCAL_WORLD_FIXTURE && (activeNetwork.network !== 'testnet' || ![31359, 31360].includes(config.chainId))) throw new Error('Invalid local fixture')
  let id = 0
  let queue: { input: unknown; id: number; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = []
  let scheduled = false
  async function flush() {
    scheduled = false
    const batch = queue.splice(0, 50)
    if (queue.length) { scheduled = true; setTimeout(() => void flush(), 0) }
    try {
      const response = await rpc(new Request('https://internal.invalid/rpc', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch.map(item => ({ jsonrpc: '2.0', id: item.id, ...item.input as object }))) }), env)
      const values = await response.json() as { id: number; result?: unknown; error?: unknown }[]
      if (!response.ok || !Array.isArray(values)) throw new Error('Shared upstream unavailable')
      for (const item of batch) {
        const value = values.find(value => value.id === item.id)
        if (!value || value.error) item.reject(new Error('Shared upstream unavailable'))
        else item.resolve(value.result)
      }
    } catch { for (const item of batch) item.reject(new Error('Shared upstream unavailable')) }
  }
  const reader = createWorldReader(config, { transport: custom({ request: input => new Promise((resolve, reject) => {
    queue.push({ input, id: ++id, resolve, reject })
    if (!scheduled) { scheduled = true; setTimeout(() => void flush(), 0) }
  }) }, { retryCount: 0 }) })
  return { reader, config }
}
/** Cache API is evictable and local to a Cloudflare location; it is not an index database. */
export async function sharedResponse(request: Request, env: Env, rpc: (request: Request, env: Env) => Promise<Response>, cache: WorkerCache, ctx?: Background): Promise<Response> {
  const url = new URL(request.url)
  const routes = new Map([['/api/world-snapshot', 5], ['/api/profiles', 45], ['/api/constants', 86400], ['/api/leaderboard', 600]])
  if (request.method !== 'GET') return new Response('GET required', { status: 405, headers: { Allow: 'GET' } })
  if (url.search || !routes.has(url.pathname)) return new Response('Unknown shared resource', { status: 404 })
  if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return new Response('Cross-origin request denied', { status: 403 })
  if (!env.LOCAL_WORLD_FIXTURE && (!deploymentConfigured(production) || !transactionsEnabled(production)
    || (production.chainId === 56 && env.MAINNET_ENABLED !== 'true'))) return new Response(JSON.stringify({ error: 'WORLD deployment is not enabled' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  if (url.pathname === '/api/leaderboard') {
    let instance = services.get(env)
    if (!instance) { instance = service(env, rpc); services.set(env, instance) }
    const { reader, config } = instance
    try {
      return await cachedLeaderboard(request, cache, async () => {
        const response = await env.ASSETS.fetch(new Request(url.origin + '/data/leaderboard-checkpoint.json'))
        if (!response.ok) throw new Error('Checkpoint unavailable')
        const checkpoint = validateCheckpoint(parseData(await response.text()) as LeaderboardCheckpoint)
        if (checkpoint.identity.chainId !== config.chainId || checkpoint.identity.deployment.toLowerCase() !== config.deploymentAddress?.toLowerCase()) throw new Error('Checkpoint instance mismatch')
        return checkpoint
      }, checkpoint => syncLeaderboard(reader, checkpoint), ctx)
    } catch {
      return new Response(JSON.stringify({ error: 'Leaderboard temporarily unavailable' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    }
  }
  const started = performance.now(), resource = url.pathname.slice(5)
  const key = new Request(url.href), cached = await cache.match(key)
  if (cached) { observeCache(resource, 'HIT', cached.status, performance.now() - started); return mark(cached, 'HIT') }
  const flightKey = url.href
  if (flights.has(flightKey)) {
    const response = (await flights.get(flightKey)!).clone()
    observeCache(resource, 'COALESCED', response.status, performance.now() - started); return mark(response, 'COALESCED')
  }
  const pending = (async () => {
    try {
      let instance = services.get(env)
      if (!instance) { instance = service(env, rpc); services.set(env, instance) }
      const { reader, config } = instance
      const immutable = await cache.match(new Request(url.origin + '/api/constants'))
      if (immutable) {
        const constant = parseData(await immutable.text()) as any
        if (constant.addresses?.deployment?.toLowerCase() !== config.deploymentAddress?.toLowerCase()) throw new Error('Cached instance mismatch')
        reader.adoptConstants(constant); reader.adoptLimits(constant)
      }
      // Reuse the same pinned world snapshot across Profiles/constants fills.
      const snapshot = async () => parseData(await (await sharedResponse(new Request(url.origin + '/api/world-snapshot'), env, rpc, cache)).text()) as Awaited<ReturnType<typeof reader.readSnapshot>>
      let value: unknown
      switch (url.pathname) {
        case '/api/world-snapshot': value = await reader.readSnapshot(); break
        case '/api/profiles': value = await reader.readProfiles(await snapshot()); break
        case '/api/constants': { const s = await snapshot(); value = { ...await reader.readProfileLimits(s), addresses: s.addresses, parameters: s.parameters, blockNumber: s.blockNumber }; break }

      }
      const response = new Response(serializeData(value), { headers: { 'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${routes.get(url.pathname)}`, 'x-content-type-options': 'nosniff' } })
      await cache.put(key, response.clone())
      return response
    } catch {
      // No raw provider diagnostics, credentials or partial history escape this boundary.
      return new Response(JSON.stringify({ error: 'Shared data temporarily unavailable', retryable: true }),
        { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    }
  })()
  flights.set(flightKey, pending)
  try {
    const response = (await pending).clone()
    observeCache(resource, 'MISS', response.status, performance.now() - started); return mark(response, 'MISS')
  }
  finally { if (flights.get(flightKey) === pending) flights.delete(flightKey) }
}
function mark(response: Response, value: string): Response {
  const headers = new Headers(response.headers); headers.set('x-world-cache', value)
  return new Response(response.body, { status: response.status, headers })
}
