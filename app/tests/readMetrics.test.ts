import { describe, expect, it, vi } from 'vitest'
import { createPublicClient, type EIP1193Provider } from 'viem'
import { createReadMetrics } from '../src/readMetrics'
import { walletReadTransport } from '../src/readTransport'

describe('privacy-preserving read counters', () => {
  it.each(['STALE', 'BOOTSTRAP'] as const)('counts leaderboard %s without storing payloads', async outcome => {
    const metrics = createReadMetrics()
    await metrics.fetch(async () => new Response('{}', { headers: { 'x-world-cache': outcome } }))('https://world.example/api/leaderboard')
    expect(metrics.snapshot().browser.cache[outcome]).toBe(1)
    metrics.reset(); expect(metrics.snapshot().browser.cache[outcome]).toBe(0)
  })
  it('counts actual provider requests, successful reads and fallback without retaining addresses or errors', async () => {
    const metrics = createReadMetrics(), request = vi.fn(async ({ method }) => method === 'eth_chainId' ? '0x61' : '0x10')
    const provider = { request } as EIP1193Provider
    const stable = createPublicClient({ transport: walletReadTransport(97, () => provider, async () => '0x20', 20, metrics.wallet) })
    const address = '0x1111111111111111111111111111111111111111'
    await stable.getBalance({ address })
    request.mockRejectedValueOnce(new Error('private diagnostic ' + address))
    await stable.getBalance({ address })
    expect(metrics.snapshot().wallet).toMatchObject({ calls: 3, success: 1, fallback: 1, fallbackReasons: { unavailable: 1 } })
    expect(JSON.stringify(metrics.snapshot())).not.toContain(address)
    expect(JSON.stringify(metrics.snapshot())).not.toContain('private diagnostic')
  })
  it('tracks HTTP cache outcomes and resets without storing URL query strings or request bodies', async () => {
    const metrics = createReadMetrics(), request = vi.fn(async () => new Response('{}', { headers: { 'x-world-cache': 'HIT' } }))
    const observed = metrics.fetch(request)
    await observed('https://world.example/api/leaderboard?private=example', { body: 'not-retained' })
    expect(metrics.snapshot().browser).toMatchObject({ http: 1, sharedHttp: 1, cache: { HIT: 1 } })
    expect(JSON.stringify(metrics.snapshot())).not.toMatch(/private=|not-retained|world.example/)
    metrics.reset(); expect(metrics.snapshot().browser.http).toBe(0)
  })
  it('counts EVM rejections separately and does not trigger upstream fallback', async () => {
    const metrics = createReadMetrics(), fallback = vi.fn()
    const provider = { request: async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x61'
      throw Object.assign(new Error('execution reverted'), { code: 3 })
    } } as EIP1193Provider
    const client = createPublicClient({ transport: walletReadTransport(97, () => provider, fallback, 20, metrics.wallet) })
    await expect(client.call({ to: '0x1111111111111111111111111111111111111111' })).rejects.toThrow()
    expect(fallback).not.toHaveBeenCalled()
    expect(metrics.snapshot().wallet).toMatchObject({ calls: 2, rejected: 1, fallback: 0 })
  })
})
