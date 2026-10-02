import { describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import { observeCache, observeLeaderboard } from '../worker/observe'

describe('release observations', () => {
  it('logs upstream attempts including failures without RPC bodies, wallet addresses, URL or secret', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('test-only-private-diagnostic'))
    try {
      const response = await worker.fetch(new Request('https://world.example/rpc', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'eth_chainId' }, { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: ['0x123', 'latest'] }]) }),
      { NODEREAL_RPC_URL: 'https://bsc-testnet.nodereal.io/v1/test-only-placeholder', ASSETS: { fetch: async () => new Response('') } })
      expect(response.status).toBe(502)
      // The failed chain probe prevents both caller reads from reaching the upstream.
      expect(log.mock.calls[0][0]).toMatchObject({ event: 'world_upstream', httpRequests: 1, rpcCalls: 1, status: 0 })
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/0x123|nodereal|placeholder|private-diagnostic|https:/)
    } finally { log.mockRestore(); fetch.mockRestore() }
  })
  it('logs only known cache resources and exact verified history ranges', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      observeCache('profiles', 'HIT', 200, 4.6)
      observeCache('private-address', 'MISS', 200, 5)
      observeLeaderboard(100n, 120n, 120n, 2, true, 1)
      expect(log).toHaveBeenCalledTimes(2)
      expect(log.mock.calls[1][0]).toMatchObject({ checkpoint: '100', indexedThroughBlock: '120', target: '120', blocksScanned: '20', complete: true })
    } finally { log.mockRestore() }
  })
})
