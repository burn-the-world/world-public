import { t } from './i18n'
import { getAddress, isAddress, type Address } from 'viem'

export interface WorldConfig {
  chainId: number
  rpcUrl: string
  deploymentAddress?: Address
  coreAddress?: Address
  tokenAddress?: Address
  profileAddress?: Address
  nativeSymbol: string
  deploymentBlock: bigint | null
  recentBlockWindow: bigint
  multicallAddress?: Address
  network?: 'mainnet' | 'testnet' | 'local'
  mainnetEnabled?: boolean
  networkName?: string
  walletRpcUrl?: string
  explorerUrl?: string
}

export interface NetworkProfile {
  network: string; chainId: number; name: string; nativeSymbol: string; walletRpcUrl: string; explorerUrl: string
  mainnetEnabled: boolean; deploymentAddress: string | null; coreAddress: string | null
  tokenAddress: string | null; profileAddress: string | null; deploymentBlock: string | null; recentBlockWindow: string
}
/** Public production identity comes from the selected manifest, never legacy Vite env files. */
export function networkConfig(profile: NetworkProfile, rpcUrl: string): WorldConfig {
  if (!((profile.network === 'mainnet' && profile.chainId === 56) || (profile.network === 'testnet' && profile.chainId === 97))) throw new Error('Invalid network profile')
  const address = (value: string | null) => {
    if (value === null) return undefined
    if (!isAddress(value) || /^0x0{40}$/i.test(value)) throw new Error('Invalid contract address')
    return getAddress(value)
  }
  if (profile.deploymentBlock !== null && !/^[1-9]\d*$/.test(profile.deploymentBlock)) throw new Error('Invalid deployment block')
  return { chainId: profile.chainId, network: profile.network as 'mainnet' | 'testnet', mainnetEnabled: profile.mainnetEnabled === true,
    rpcUrl, nativeSymbol: profile.nativeSymbol, networkName: profile.name, walletRpcUrl: profile.walletRpcUrl, explorerUrl: profile.explorerUrl,
    deploymentAddress: address(profile.deploymentAddress), coreAddress: address(profile.coreAddress), tokenAddress: address(profile.tokenAddress), profileAddress: address(profile.profileAddress),
    deploymentBlock: profile.deploymentBlock === null ? null : BigInt(profile.deploymentBlock), recentBlockWindow: BigInt(profile.recentBlockWindow) }
}
export function deploymentConfigured(config: WorldConfig): boolean {
  return [config.deploymentAddress, config.coreAddress, config.tokenAddress, config.profileAddress].every(value => !!value && isAddress(value) && !/^0x0{40}$/i.test(value))
    && config.deploymentBlock !== null && config.deploymentBlock > 0n
}
export function transactionsEnabled(config: WorldConfig): boolean {
  if (config.chainId === 56 || config.network === 'mainnet') return config.chainId === 56 && config.network === 'mainnet' && config.mainnetEnabled === true && deploymentConfigured(config)
  // Production testnet profiles also require a complete instance. Local test fixtures keep their existing validation path.
  return config.network !== 'testnet' || (config.chainId === 97 && deploymentConfigured(config))
}
export function assertTransactionsEnabled(config: WorldConfig): void {
  if (!transactionsEnabled(config)) throw new Error(t('mainnetUnavailable'))
}
export function requireDeploymentBlock(config: WorldConfig): bigint {
  if (config.deploymentBlock === null) throw new Error('Deployment block is not configured')
  return config.deploymentBlock
}

export function loadConfig(env: Record<string, string | undefined> = {}): WorldConfig {
  const get = (key: string) => env[`VITE_${key}`] ?? env[key]
  const address = (key: string): Address | undefined => {
    const value = get(key)?.trim()
    if (!value) return undefined
    if (!isAddress(value)) throw new Error(t('copy210', { v0: key }))
    return getAddress(value)
  }
  const uint = (key: string, fallback: string) => {
    const value = get(key)?.trim() || fallback
    if (!/^\d+$/.test(value)) throw new Error(t('copy211', { v0: key }))
    return BigInt(value)
  }
  const chainId = Number(uint('CHAIN_ID', '31359'))
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(t('copy212'))
  const rpcUrl = get('RPC_URL')?.trim() || 'http://127.0.0.1:18559'
  const parsed = new URL(rpcUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(t('copy213'))
  const recentBlockWindow = uint('RECENT_BLOCK_WINDOW', '3000')
  if (recentBlockWindow === 0n) throw new Error(t('copy214'))
  return {
    chainId, rpcUrl,
    deploymentAddress: address('DEPLOYMENT_ADDRESS'),
    coreAddress: address('CORE_ADDRESS'),
    tokenAddress: address('TOKEN_ADDRESS'),
    profileAddress: address('PROFILE_ADDRESS'),
    nativeSymbol: get('NATIVE_SYMBOL')?.trim() || (chainId === 97 ? 'tBNB' : 'BNB'),
    deploymentBlock: uint('DEPLOYMENT_BLOCK', '0'),
    recentBlockWindow,
    multicallAddress: address('MULTICALL_ADDRESS'),
  }
}
