import { describe, expect, it, vi } from 'vitest'
import { createPublicClient, type EIP1193Provider } from 'viem'
import { createReadCache, walletReadTransport } from '../src/readTransport'

function setup(chain = '0x61') {
  const request = vi.fn(async (input: { method: string }) => input.method === 'eth_chainId' ? chain : '0x10')
  const wallet = { request } as unknown as EIP1193Provider
  const fallback = vi.fn(async () => '0x20')
  const client = createPublicClient({ transport: walletReadTransport(97, () => wallet, fallback) })
  return { request, fallback, client }
}
describe('wallet-only read routing', () => {
  it('reads from the connected wallet without touching the project upstream', async () => {
    const f = setup()
    expect(await f.client.getBlockNumber({ cacheTime: 0 })).toBe(16n)
    expect(f.fallback).not.toHaveBeenCalled()
    expect(f.request.mock.calls.map(([r]) => r.method)).toEqual(['eth_chainId', 'eth_blockNumber'])
  })
  it('falls back on a wallet read failure', async () => {
    const f = setup(); f.request.mockRejectedValueOnce(new Error('wallet offline'))
    expect(await f.client.getBlockNumber({ cacheTime: 0 })).toBe(32n)
    expect(f.fallback).toHaveBeenCalledTimes(1)
  })
  it('falls back when a wallet read never resolves, without timing out signing', async () => {
    const wallet = { request: () => new Promise(() => {}) } as unknown as EIP1193Provider
    const fallback = vi.fn(async () => '0x20')
    const client = createPublicClient({ transport: walletReadTransport(97, () => wallet, fallback, 5) })
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(32n)
    expect(fallback).toHaveBeenCalledTimes(1)
  })
  it('does not read user state from the wrong wallet chain', async () => {
    const f = setup('0x38')
    expect(await f.client.getBlockNumber({ cacheTime: 0 })).toBe(32n)
    expect(f.request).toHaveBeenCalledTimes(1)
  })
  it('preserves an EVM rejection instead of repeating it at the project upstream', async () => {
    const f = setup()
    f.request.mockImplementation(async input => {
      if (input.method === 'eth_chainId') return '0x61'
      throw Object.assign(new Error('execution reverted'), { code: 3 })
    })
    await expect(f.client.call({ to: '0x1111111111111111111111111111111111111111' })).rejects.toThrow('execution reverted')
    expect(f.fallback).not.toHaveBeenCalled()
  })
  it.each(['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_signTypedData_v4'])('never routes %s to wallet or upstream', async method => {
    const f = setup()
    await expect(f.client.request({ method } as never)).rejects.toThrow('Read-only')
    expect(f.request).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled()
  })
  it('coalesces identical in-flight reads but does not cache latest state', async () => {
    const f = setup()
    await Promise.all([f.client.getBalance({ address: '0x1111111111111111111111111111111111111111' }),
      f.client.getBalance({ address: '0x1111111111111111111111111111111111111111' })])
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getBalance')).toHaveLength(1)
    await f.client.getBalance({ address: '0x1111111111111111111111111111111111111111' })
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getBalance')).toHaveLength(2)
  })
  it('discards a read if the provider is replaced while it is running', async () => {
    let current: EIP1193Provider | undefined
    current = { request: vi.fn(async ({ method }) => { if (method === 'eth_chainId') return '0x61'; current = undefined; return '0x10' }) } as EIP1193Provider
    const fallback = vi.fn(async () => '0x20')
    const client = createPublicClient({ transport: walletReadTransport(97, () => current, fallback) })
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(32n)
  })
})
describe('browser lifecycle cache', () => {
  it('shares results across consumers and expires at the declared TTL', async () => {
    let time = 0; const cache = createReadCache(() => time), read = vi.fn(async () => 100n)
    expect(await Promise.all([cache.read('world', 5000, read), cache.read('world', 5000, read)])).toEqual([100n, 100n])
    time = 4999; await cache.read('world', 5000, read); expect(read).toHaveBeenCalledTimes(1)
    time = 5000; await cache.read('world', 5000, read); expect(read).toHaveBeenCalledTimes(2)
  })
  it('does not cache failures', async () => {
    const cache = createReadCache(), read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(1n)
    await expect(cache.read('world', 5000, read)).rejects.toThrow('offline')
    expect(await cache.read('world', 5000, read)).toBe(1n)
  })
})
