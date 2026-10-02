import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../worker/index'
const MAX_BODY = 256 * 1024
const env: Env = { NODEREAL_RPC_URL: 'https://bsc-testnet.nodereal.io/v1/test-only-placeholder', ASSETS: { fetch: async () => new Response('asset') } }
const one = { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }
const request = (body: unknown, options: RequestInit = {}) => new Request('https://world.example/rpc', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...options,
})
afterEach(() => vi.unstubAllGlobals())
describe('read-only Worker RPC boundary', () => {
  it('forwards single requests and raw upstream JSON without credential headers', async () => {
    const raw = '{"jsonrpc":"2.0", "id":1,"result":"0x61"}'
    const fetch = vi.fn().mockResolvedValue(new Response(raw, { headers: { 'x-private': 'hidden' } }))
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request(one), env)
    expect(await response.text()).toBe(raw)
    expect(response.headers.get('x-private')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetch.mock.calls[0][0].href).toBe(env.NODEREAL_RPC_URL)
  })
  it('accepts 50-item batch with id correlation and historical block parameters intact', async () => {
    const batch = Array.from({ length: 50 }, (_, id) => ({ ...one, id, method: 'eth_call', params: [{ to: '0x01', data: '0x' }, '0x7fa19b1'] }))
    const fetch = vi.fn().mockResolvedValue(Response.json(batch.map(x => ({ jsonrpc: '2.0', id: x.id, result: '0x' }))))
    vi.stubGlobal('fetch', fetch)
    expect((await worker.fetch(request(batch), env)).status).toBe(200)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(batch)
  })
  it.each(['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign', 'personal_sign', 'wallet_addEthereumChain', 'debug_traceCall'])('blocks %s without contacting upstream', async method => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await worker.fetch(request({ ...one, method }), env)).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([[], [one, one], { ...one, jsonrpc: '1.0' }, { ...one, id: undefined }, { ...one, params: 'bad' }, Array(101).fill(one), { ...one, url: 'https://other.example' }])('rejects malformed/oversized batch input', async body => {
    expect((await worker.fetch(request(body), env)).status).toBe(400)
  })
  it('rejects oversized body without Content-Length, invalid JSON, non-POST, foreign origin and query target', async () => {
    expect((await worker.fetch(request('x'.repeat(MAX_BODY)), env)).status).toBe(413)
    expect((await worker.fetch(request(one, { body: '{' }), env)).status).toBe(400)
    expect((await worker.fetch(new Request('https://world.example/rpc'), env)).status).toBe(405)
    expect((await worker.fetch(request(one, { headers: { 'content-type': 'application/json', origin: 'https://other.example' } }), env)).status).toBe(403)
    expect((await worker.fetch(new Request('https://world.example/rpc?url=other', request(one)), env)).status).toBe(400)
  })
  it('fails closed for missing or non-NodeReal secret and hides transport errors', async () => {
    for (const secret of [undefined, 'http://localhost:1234', 'https://other.example/v1/key'])
      expect((await worker.fetch(request(one), { ...env, NODEREAL_RPC_URL: secret })).status).toBe(503)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(env.NODEREAL_RPC_URL)))
    expect(await (await worker.fetch(request(one), env)).text()).not.toContain('test-only-placeholder')
  })
  it('preserves rate limits but suppresses secret-bearing errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: -32029 } }, { status: 429 })))
    expect((await worker.fetch(request(one), env)).status).toBe(429)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: env.NODEREAL_RPC_URL })))
    const response = await worker.fetch(request(one), env)
    expect(response.status).toBe(502); expect(await response.text()).not.toContain('test-only-placeholder')
  })
  it('serves assets outside the reserved endpoint', async () => {
    expect(await (await worker.fetch(new Request('https://world.example/world/1'), env)).text()).toBe('asset')
  })
  it('testnet cannot use a mainnet binding, host, or chain response', async () => {
    const fetch = vi.fn(async () => Response.json({ result: '0x38' })); vi.stubGlobal('fetch', fetch)
    expect((await worker.fetch(request(one), { ...env, NODEREAL_RPC_URL: undefined, NODEREAL_MAINNET_RPC_URL: 'https://bsc-mainnet.nodereal.io/v1/test-only-placeholder' })).status).toBe(503)
    expect((await worker.fetch(request(one), { ...env, NODEREAL_RPC_URL: 'https://bsc-mainnet.nodereal.io/v1/test-only-placeholder' })).status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
    expect((await worker.fetch(request(one), { ...env })).status).toBe(502)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
