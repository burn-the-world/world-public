import { t } from './i18n'
import { formatUnits, parseUnits, zeroAddress, type Address, type Hex } from 'viem'

// Expected version guard and display defaults. Live parameters are read from Core.
export const N = 50
export const W = 65n
export const B = 1n << 96n
export const TOKEN_UNIT = 10n ** 18n
export const REWARD_DENOMINATOR = W * B
export const MAX_UINT256 = (1n << 256n) - 1n
export const RESISTANCE_Q = 1n << 64n
export const MAX_WAR_ATOMS = 1n << 128n // exclusive
export const RESISTANCE_LIMIT = 1n << 192n // exclusive
export const RESISTANCE_HALF_LIFE = 3_888_000n
export const VERSION_NAMESPACE = 'world:bsc:burn-resistance:v2'
export interface Land {
  id: number; weight: bigint; controller: Address
  resistanceRaw: bigint; lastResistanceUpdate: bigint; currentResistanceRaw: bigint
  minimumAttackAtoms: bigint; epoch: bigint; j: bigint
}
export interface WorldParameters {
  N: number; W: bigint; B: bigint; T: bigint; worldPrice: bigint; tokenUnit: bigint
  resistanceHalfLife: bigint; maxWarAtoms: bigint; resistanceLimit: bigint
}
export interface LandProfile {
  status: 'available' | 'unavailable'; valid: boolean; controller: Address; epoch: bigint
  name: string; logoURI: string; website: string
}
export interface ProfileLimits { name: number; logoURI: number; website: number }
export interface WorldSnapshot {
  blockNumber: bigint; blockHash?: Hex; timestamp: bigint; U: bigint; J: bigint
  accountedBNB: bigint; coreNativeBalance: bigint
  totalSupply: bigint; coreWorldBalance: bigint
  parameters: WorldParameters; lands: Land[]
  wallet?: { address: Address; balance: bigint; nativeBalance: bigint; allowance: bigint; claimable: bigint }
  addresses: { core: Address; token: Address; profile?: Address; deployment?: Address }
}
export interface Activity {
  key: string; event: string; transactionHash: Hex; blockNumber: bigint; logIndex: number
  text: string; source: 'core' | 'profile' | 'token'; landId?: number; actor?: Address
  epoch?: bigint; amount?: bigint; name?: string; oldController?: Address; newController?: Address
  burn?: bigint; resistanceRaw?: bigint; wallRaw?: bigint; takeoverKind?: 'first' | 'self' | 'changed'
}
export interface WorldHistory {
  events: Activity[]; fromBlock: bigint; toBlock: bigint; complete: boolean
  profileAvailable: boolean; truncated: boolean; tokenAvailable?: boolean
}
export function weightOf(id: number): bigint {
  if (!Number.isInteger(id) || id < 1 || id > N) throw new Error(t('copy150'))
  return id === 1 ? 6n : id <= 6 ? 3n : 1n
}
export function isNeutral(land: Pick<Land, 'controller'>): boolean { return land.controller.toLowerCase() === zeroAddress }
export function validateResistance(raw: bigint): bigint {
  if (raw < 0n || raw >= RESISTANCE_LIMIT) throw new Error(t('copy233'))
  return raw
}
export function minimumAttackAtoms(raw: bigint): bigint { return validateResistance(raw) / RESISTANCE_Q + 1n }
export function validateWarAmount(amount: bigint): bigint {
  if (amount <= 0n || amount >= MAX_WAR_ATOMS) throw new Error(t('copy234'))
  return amount
}
export function pendingNumerator(land: Pick<Land, 'weight' | 'j'>, J: bigint): bigint {
  if (J < land.j) throw new Error(t('copy235'))
  return land.weight * (J - land.j)
}
export function numeratorToWei(numerator: bigint, denominator = REWARD_DENOMINATOR): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error(t('copy236'))
  return numerator / denominator
}
export function treasuryParts(U: bigint, accountedBNB: bigint, scale = B) {
  const releasedScaled = accountedBNB * scale - U
  if (scale <= 0n || U < 0n || releasedScaled < 0n) throw new Error(t('copy237'))
  return { unreleasedWei: U / scale, releasedWei: releasedScaled / scale, unreleasedScaled: U, releasedScaled }
}
/** Read-only approximation, never used for transaction amounts or accounting. */
/** Read-only approximation, never used for transaction amounts or accounting. */
export function hourlyReleaseReference(U: bigint): bigint { return U * 481236377333740n / (10n ** 18n) }
export function parseWorld(value: string): bigint {
  const text = value.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) throw new Error(t('copy238'))
  const atoms = parseUnits(text, 18)
  if (atoms <= 0n || atoms > MAX_UINT256) throw new Error(t('copy239'))
  return atoms
}
export function formatWorld(atoms: bigint): string { return formatUnits(atoms, 18) }
export function formatNative(wei: bigint): string { return formatUnits(wei, 18) }
function formatRatio(numerator: bigint, denominator: bigint, decimals = 24): string {
  if (denominator <= 0n) throw new Error(t('copy240'))
  if (numerator === 0n) return '0'
  if (numerator < 0n) return '-' + formatRatio(-numerator, denominator, decimals)
  const floored = numerator * 10n ** BigInt(decimals) / denominator
  if (floored === 0n) return '<0.' + '0'.repeat(decimals - 1) + '1'
  return formatUnits(floored, decimals)
}
export function formatNumerator(numerator: bigint, denominator = REWARD_DENOMINATOR): string { return formatRatio(numerator, denominator * TOKEN_UNIT) }
export function formatScaledNative(scaled: bigint, scale = B): string { return formatRatio(scaled, scale * TOKEN_UNIT) }
export function shortAddress(address: string): string { return address.slice(0, 6) + '…' + address.slice(-4) }
export function formatResistance(raw: bigint): string {
  validateResistance(raw)
  return formatRatio(raw, RESISTANCE_Q * TOKEN_UNIT, 24)
}
export function attackPreview(land: Pick<Land, 'currentResistanceRaw'>, amount: bigint) {
  const currentRaw = validateResistance(land.currentResistanceRaw)
  const spendRaw = validateWarAmount(amount) * RESISTANCE_Q
  const taken = spendRaw > currentRaw
  return { taken, equal: spendRaw === currentRaw, minimum: minimumAttackAtoms(currentRaw),
    newResistanceRaw: taken ? spendRaw - currentRaw : currentRaw - spendRaw, burn: amount }
}
export function defendPreview(land: Pick<Land, 'currentResistanceRaw'>, amount: bigint) {
  const newResistanceRaw = validateResistance(land.currentResistanceRaw) + validateWarAmount(amount) * RESISTANCE_Q
  validateResistance(newResistanceRaw)
  return { newResistanceRaw, burn: amount }
}
export const byteLength = (value: string) => new TextEncoder().encode(value).length
export function validateProfileInput(input: Pick<LandProfile, 'name' | 'logoURI' | 'website'>, limits: ProfileLimits) {
  for (const key of ['name', 'logoURI', 'website'] as const) {
    if (byteLength(input[key]) > limits[key]) throw new Error(t('copy241', { v0: key, v1: limits[key] }))
  }
}
/** Only approved browser URL schemes. Metadata is never interpreted as HTML. */
/** Only approved browser URL schemes. Metadata is never interpreted as HTML. */
export function safeExternalUrl(value: string): string | undefined {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}
export function safeImageUrl(value: string): string | undefined {
  if (value.startsWith('ipfs://')) {
    const resource = value.slice(7).replace(/^ipfs\//, '')
    if (!/^[A-Za-z0-9]+(?:\/[^\s?#]*)?$/.test(resource) || resource.split('/').some(part => part === '.' || part === '..')) return undefined
    return safeExternalUrl(`https://ipfs.io/ipfs/${resource}`)
  }
  return safeExternalUrl(value)
}
