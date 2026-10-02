import { describe, expect, it } from 'vitest'
import mainnet from '../config/networks/mainnet.json'
import testnet from '../config/networks/testnet.json'
import { deploymentConfigured, networkConfig, requireDeploymentBlock, transactionsEnabled } from '../src/config'

describe('production network manifests', () => {
  it('retains the exact verified testnet instance and scan start', () => {
    const c = networkConfig(testnet, 'https://site.example/rpc')
    expect(c.chainId).toBe(97)
    expect(c.nativeSymbol).toBe('tBNB')
    expect(c.deploymentBlock).toBe(133830577n)
    expect([c.deploymentAddress, c.coreAddress, c.tokenAddress, c.profileAddress]).toEqual([
      '0xB0272c944BCC22553cF9869B30f3418be535C3df', '0x1Bd3815Bec1ac3Bf0ECF3BF81E7D6AccBd875829',
      '0xC5f69e2bD3f43b8593279370071d4D39c993f27f', '0x30b098ab2535D38044e45D542cb0855D0c32AB36'])
    expect(transactionsEnabled(c)).toBe(true)
    expect(c.walletRpcUrl).toBe(testnet.walletRpcUrl)
    expect(c.explorerUrl).toBe(testnet.explorerUrl)
  })
  it('enables only the verified mainnet deployment on chain 56', () => {
    const c = networkConfig(mainnet, 'https://site.example/rpc')
    expect(c.chainId).toBe(56)
    expect(c.mainnetEnabled).toBe(true)
    expect(c.deploymentBlock).toBe(125288896n)
    expect([c.deploymentAddress, c.coreAddress, c.tokenAddress, c.profileAddress]).toEqual([
      '0x2F8e4b4De457aC01992e4628794DBd681f09Be30', '0x755bae50BcAc16F3b11fc84BCfCFE0a192c009e7',
      '0xB1D67858e8374636Ca4379d2842FB166A2197A55', '0x33b2FE6F3EBF80eBBE74e8c388C0FEB1717EE2e0'])
    expect(deploymentConfigured(c)).toBe(true)
    expect(transactionsEnabled(c)).toBe(true)
    expect(transactionsEnabled({ ...c, mainnetEnabled: false })).toBe(false)
    expect(requireDeploymentBlock(c)).toBe(125288896n)
    for (const address of [testnet.deploymentAddress, testnet.coreAddress, testnet.tokenAddress, testnet.profileAddress]) expect(JSON.stringify(mainnet)).not.toContain(address)
  })
  it('does not unlock an incomplete deployment even when the flag is true', () => {
    const c = networkConfig({ ...mainnet, mainnetEnabled: true, deploymentBlock: null }, 'https://site.example/rpc')
    expect(transactionsEnabled(c)).toBe(false)
    expect(transactionsEnabled({ ...c, network: undefined })).toBe(false)
    const complete = networkConfig(testnet, 'https://site.example/rpc')
    expect(transactionsEnabled({ ...complete, network: 'mainnet', chainId: 56, mainnetEnabled: false })).toBe(false)
    for (const field of ['deploymentAddress', 'coreAddress', 'tokenAddress', 'profileAddress', 'deploymentBlock'] as const)
      expect(transactionsEnabled({ ...complete, network: 'mainnet', chainId: 56, mainnetEnabled: true, [field]: undefined })).toBe(false)
  })
  it('rejects zero addresses and contradictory chain identities', () => {
    expect(() => networkConfig({ ...mainnet, coreAddress: `0x${'0'.repeat(40)}` }, 'https://site.example/rpc')).toThrow()
    expect(() => networkConfig({ ...mainnet, chainId: 97 }, 'https://site.example/rpc')).toThrow()
    expect(() => networkConfig({ ...testnet, chainId: 56 }, 'https://site.example/rpc')).toThrow()
    expect(() => networkConfig({ ...mainnet, deploymentBlock: '0' }, 'https://site.example/rpc')).toThrow()
  })
})
