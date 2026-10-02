import { describe, expect, it, vi } from 'vitest'
import { sharedResponse, type WorkerCache } from '../worker/shared'
import type { Env } from '../worker/index'

function fixture(cached?: string) {
  const cache: WorkerCache = { match: vi.fn(async () => cached === undefined ? undefined : new Response(cached)), put: vi.fn() }
  const assets = vi.fn(async () => new Response('Not found', { status: 404 }))
  const env: Env = { ASSETS: { fetch: assets } }, rpc = vi.fn(async () => new Response('{}', { status: 503 }))
  return { cache, env, rpc, assets }
}
describe('shared public endpoints', () => {
  it.each(['world-snapshot', 'profiles', 'constants'])('serves cached %s without touching the upstream', async resource => {
    const f = fixture('{"cached":true}')
    const response = await sharedResponse(new Request('https://world.example/api/' + resource), f.env, f.rpc, f.cache)
    expect(await response.json()).toEqual({ cached: true }); expect(response.headers.get('x-world-cache')).toBe('HIT')
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.assets).not.toHaveBeenCalled()
  })
  it('does not accept a client-provided URL or query', async () => {
    const f = fixture()
    const response = await sharedResponse(new Request('https://world.example/api/world-snapshot?url=https://other.example'), f.env, f.rpc, f.cache)
    expect(response.status).toBe(404); expect(f.rpc).not.toHaveBeenCalled()
  })
  it('rejects unknown resources', async () => {
    const f = fixture()
    expect((await sharedResponse(new Request('https://world.example/api/private-key'), f.env, f.rpc, f.cache)).status).toBe(404)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('rejects POST on the public cache endpoints', async () => {
    const f = fixture()
    expect((await sharedResponse(new Request('https://world.example/api/world-snapshot', { method: 'POST' }), f.env, f.rpc, f.cache)).status).toBe(405)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('rejects another browser origin', async () => {
    const f = fixture()
    expect((await sharedResponse(new Request('https://world.example/api/world-snapshot', { headers: { origin: 'https://other.example' } }), f.env, f.rpc, f.cache)).status).toBe(403)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('fails safely when the upstream is absent; never caches failures', async () => {
    const f = fixture()
    const response = await sharedResponse(new Request('https://unconfigured.example/api/world-snapshot'), f.env, f.rpc, f.cache)
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/NODEREAL|https:/)
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(f.cache.put).not.toHaveBeenCalled()
  })
})
