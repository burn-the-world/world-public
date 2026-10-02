import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { type Address, type WalletClient } from 'viem'
vi.mock('@world-network', async () => import('../config/networks/mainnet.json'))
import mainnet from '../config/networks/mainnet.json'
import { deploymentConfigured, networkConfig, transactionsEnabled } from '../src/config'
import { executeWorldAction, type WorldReader, type WorldAction } from '../src/chain'
import { canTransact } from '../src/Transactions'
import { MainnetComingSoon } from '../src/MainnetComingSoon'
import { i18n } from '../src/i18n'
import type { AppProps } from '../src/uiTypes'
import worker, { type Env } from '../worker/index'
const config = networkConfig({ ...mainnet, mainnetEnabled: false }, 'https://mainnet.example/rpc')
const address = '0x1111111111111111111111111111111111111111' as Address // Test fixture only.
afterEach(() => { vi.unstubAllGlobals(); i18n.changeLanguage('zh-CN') })
describe('mainnet disabled safety boundary', () => {
  it('opens the verified production configuration while retaining the explicit disabled boundary', () => {
    const enabled = networkConfig(mainnet, 'https://mainnet.example/rpc')
    expect(enabled.chainId).toBe(56)
    expect(transactionsEnabled(enabled)).toBe(true)
    expect(transactionsEnabled({ ...enabled, mainnetEnabled: false })).toBe(false)
    expect(transactionsEnabled({ ...enabled, coreAddress: undefined })).toBe(false)
    const ready = { config: enabled, snapshot: { wallet: { address } }, account: address, walletChainId: 56, busy: false, stale: false } as AppProps
    expect(canTransact(ready)).toBe(true)
    expect(canTransact({ ...ready, walletChainId: 97 })).toBe(false)
    expect(canTransact({ ...ready, stale: true })).toBe(false)
  })
  it('keeps the verified, fully configured deployment disabled', () => {
    expect(deploymentConfigured(config)).toBe(true)
    expect(config.deploymentBlock).toBe(125288896n)
    expect(transactionsEnabled(config)).toBe(false)
  })
  it.each(['buy', 'approve', 'attack', 'defend', 'settle', 'withdraw', 'profile', 'sync'])('rejects %s before any wallet/RPC access', async kind => {
    const validate = vi.fn(), request = vi.fn(), writeContract = vi.fn()
    const reader = { config, validate, publicClient: { request } } as unknown as WorldReader
    await expect(executeWorldAction(reader, { writeContract, request } as unknown as WalletClient, address, { kind } as WorldAction)).rejects.toThrow()
    expect(validate).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled()
    expect(canTransact({ config } as AppProps)).toBe(false)
  })
  it.each(['en', 'zh-CN'])('renders %s Coming Soon with every transaction button disabled', async language => {
    await i18n.changeLanguage(language)
    const html = renderToStaticMarkup(<MainnetComingSoon/>)
    expect(html).toContain('WORLD Mainnet'); expect(html).toContain('Coming Soon')
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(8)
    expect(html).not.toContain('0xB027'); expect(html).not.toContain('133830577')
  })
  it('serves static pages with no RPC secret and refuses all shared/index reads', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request)
    const env: Env = { WORLD_NETWORK: 'mainnet', MAINNET_ENABLED: 'false', ASSETS: { fetch: async () => new Response('Coming Soon') } }
    expect((await worker.fetch(new Request('https://mainnet.example/'), env)).status).toBe(200)
    for (const path of ['world-snapshot', 'profiles', 'constants', 'leaderboard']) {
      vi.stubGlobal('caches', { default: {} })
      expect((await worker.fetch(new Request(`https://mainnet.example/api/${path}`), env)).status).toBe(503)
    }
    expect(request).not.toHaveBeenCalled()
  })
  it('never uses the existing testnet secret and rejects cross-network configuration', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request)
    const env: Env = { NODEREAL_RPC_URL: 'https://bsc-testnet.nodereal.io/v1/test-only-placeholder', ASSETS: { fetch: async () => new Response() } }
    expect((await worker.fetch(rpc(), env)).status).toBe(503)
    expect((await worker.fetch(rpc(), { ...env, NODEREAL_MAINNET_RPC_URL: env.NODEREAL_RPC_URL })).status).toBe(503)
    expect((await worker.fetch(rpc(), { ...env, WORLD_NETWORK: 'testnet' })).status).toBe(503)
    expect(request).not.toHaveBeenCalled()
  })
  it('checks upstream chain 56, then forwards only the fixed mainnet upstream', async () => {
    const fetch = vi.fn(async () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x38' })); vi.stubGlobal('fetch', fetch)
    const env: Env = { NODEREAL_MAINNET_RPC_URL: 'https://bsc-mainnet.nodereal.io/v1/test-only-placeholder', ASSETS: { fetch: async () => new Response() } }
    expect((await worker.fetch(rpc(), env)).status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(new URL(String(fetch.mock.calls[0][0])).hostname).toBe('bsc-mainnet.nodereal.io')
    expect((await worker.fetch(rpc(), env)).status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('fails closed if the upstream returns 97 and never forwards the caller request', async () => {
    const fetch = vi.fn(async () => Response.json({ result: '0x61' })); vi.stubGlobal('fetch', fetch)
    const env: Env = { NODEREAL_MAINNET_RPC_URL: 'https://bsc-mainnet.nodereal.io/v1/test-only-placeholder', ASSETS: { fetch: async () => new Response() } }
    expect((await worker.fetch(rpc('eth_blockNumber'), env)).status).toBe(502)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
function rpc(method = 'eth_chainId') { return new Request('https://mainnet.example/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }) }) }
