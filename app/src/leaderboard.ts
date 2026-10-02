import type { Address, Hex } from 'viem'
import { REWARD_DENOMINATOR, TOKEN_UNIT } from './domain'

export const LEADERBOARD_TTL = 600_000
export const MIN_LEADERBOARD_BURN_ATOMS = TOKEN_UNIT
export const REFERENCE_WORLD_PRICE = 10n ** 12n
export interface CheckpointBlock { blockNumber: bigint; blockHash: Hex; timestamp: bigint }
export interface LeaderboardIdentity {
  chainId: number; deployment: Address; core: Address; token: Address; profile: Address
  genesisHash: Hex; deploymentBlock: bigint; deploymentBlockHash: Hex; factoryCodeHash: Hex; coreCodeHash: Hex
}
export interface AggregateLand { id: number; controller: Address; epoch: bigint; startedAt: bigint; j: bigint; resistanceRaw: bigint; lastResistanceUpdate: bigint }
export interface ReignTotal {
  landId: number; controller: Address; epoch: bigint; startedAt: bigint; endedAt?: bigint
  openingBurn: bigint; attackProgressBurn: bigint; defenseBurn: bigint; externalSupportBurn: bigint; earnedScaled: bigint
}
export interface LeaderboardCheckpoint {
  version: 3; identity: LeaderboardIdentity; head: CheckpointBlock; globalJ: bigint
  worldPrice: bigint; tokenUnit: bigint; rewardDenominator: bigint
  lands: AggregateLand[]; reigns: ReignTotal[]
  provenance?: { sourceSha256: string; sourceBlock: string; verifiedFromBlock: string; method: string }
}
export interface Rational { numerator: bigint; denominator: bigint }
export interface ReturnLeader {
  landId: number; controller: Address; epoch: bigint; startedAt: bigint; endedAt?: bigint; status: 'LIVE' | 'FINAL'
  controllerBurnAtoms: bigint; externalSupportBurnAtoms: bigint; earnedScaled: bigint
  protocolCostWei: Rational; returnMultiple: Rational
}
export interface LeaderboardSnapshot {
  version: 2; chainId: number; core: Address; updatedAt: bigint; indexedThroughBlock: bigint; leaders: ReturnLeader[]
}
export interface LeaderboardView { data?: LeaderboardSnapshot; loading: boolean; error?: string; stale?: boolean }
export const reignKey = (r: Pick<ReignTotal, 'landId' | 'controller' | 'epoch'>) => `${r.landId}:${r.controller.toLowerCase()}:${r.epoch}`
export const controllerBurn = (r: ReignTotal) => r.openingBurn + r.attackProgressBurn + r.defenseBurn
export function rational(numerator: bigint, denominator: bigint): Rational {
  if (numerator < 0n || denominator <= 0n) throw new Error('Invalid reference fraction')
  let a = numerator, b = denominator
  while (b) [a, b] = [b, a % b]
  return { numerator: numerator / a, denominator: denominator / a }
}
/** Exact cross multiplication. Display rounding never decides ranking or ties. */
export function compareReturns(a: ReturnLeader, b: ReturnLeader) {
  const left = a.returnMultiple.numerator * b.returnMultiple.denominator, right = b.returnMultiple.numerator * a.returnMultiple.denominator
  return left !== right ? left > right ? -1 : 1 : a.landId - b.landId || (a.epoch !== b.epoch ? a.epoch < b.epoch ? -1 : 1 : a.controller.toLowerCase().localeCompare(b.controller.toLowerCase()))
}
export function leaderboardSnapshot(c: LeaderboardCheckpoint): LeaderboardSnapshot {
  const leaders = c.reigns.filter(r => controllerBurn(r) >= MIN_LEADERBOARD_BURN_ATOMS).map(r => {
    const burn = controllerBurn(r)
    return { landId: r.landId, controller: r.controller, epoch: r.epoch, startedAt: r.startedAt, endedAt: r.endedAt,
      status: r.endedAt === undefined ? 'LIVE' as const : 'FINAL' as const, controllerBurnAtoms: burn, externalSupportBurnAtoms: r.externalSupportBurn,
      earnedScaled: r.earnedScaled, protocolCostWei: rational(burn * c.worldPrice, c.tokenUnit),
      returnMultiple: rational(r.earnedScaled * c.tokenUnit, c.rewardDenominator * burn * c.worldPrice) }
  }).sort(compareReturns).slice(0, 25)
  return { version: 2, chainId: c.identity.chainId, core: c.identity.core, updatedAt: c.head.timestamp, indexedThroughBlock: c.head.blockNumber, leaders }
}
/** Integer-only truncation for amounts, including sub-wei reference costs. */
export function formatFraction(n: bigint, d: bigint, decimals = 6): string {
  if (n < 0n || d <= 0n) throw new Error('Invalid display fraction')
  const scale = 10n ** BigInt(decimals), units = n * scale / d
  if (n > 0n && units === 0n) return '<0.' + '0'.repeat(decimals - 1) + '1'
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return (units / scale).toString() + (fraction ? '.' + fraction : '')
}
export function formatReturn(r: Rational) {
  const decimals = r.numerator < 10n * r.denominator ? 2 : 1, scale = 10n ** BigInt(decimals)
  if (r.numerator > 0n && r.numerator * 100n < r.denominator) return '<0.01×'
  const rounded = (r.numerator * scale * 2n + r.denominator) / (2n * r.denominator)
  return formatFraction(rounded, scale, decimals) + '×'
}
export const formatSettled = (scaled: bigint, decimals = 6) => formatFraction(scaled, REWARD_DENOMINATOR * TOKEN_UNIT, decimals)
export function validateLeaderboard(value: LeaderboardSnapshot, chainId: number, core?: Address) {
  if (value.version !== 2 || value.chainId !== chainId || (core && value.core.toLowerCase() !== core.toLowerCase())
    || typeof value.updatedAt !== 'bigint' || value.updatedAt < 0n || typeof value.indexedThroughBlock !== 'bigint'
    || value.indexedThroughBlock < 0n || !Array.isArray(value.leaders) || value.leaders.length > 25) throw new Error('Leaderboard instance mismatch')
  const keys = new Set<string>()
  for (const [i, r] of value.leaders.entries()) {
    if (!/^0x[\da-f]{40}$/i.test(r.controller) || !Number.isInteger(r.landId) || r.landId < 1 || r.landId > 50
      || typeof r.epoch !== 'bigint' || r.epoch < 1n || typeof r.startedAt !== 'bigint' || r.startedAt > value.updatedAt || r.startedAt < 0n
      || typeof r.controllerBurnAtoms !== 'bigint' || r.controllerBurnAtoms < MIN_LEADERBOARD_BURN_ATOMS || typeof r.externalSupportBurnAtoms !== 'bigint' || r.externalSupportBurnAtoms < 0n
      || typeof r.earnedScaled !== 'bigint' || r.earnedScaled < 0n || (r.endedAt === undefined ? r.status !== 'LIVE'
        : r.status !== 'FINAL' || typeof r.endedAt !== 'bigint' || r.endedAt < r.startedAt || r.endedAt > value.updatedAt)) throw new Error('Invalid return row')
    const expectedCost = rational(r.controllerBurnAtoms * REFERENCE_WORLD_PRICE, TOKEN_UNIT)
    const expectedReturn = rational(r.earnedScaled * TOKEN_UNIT, REWARD_DENOMINATOR * r.controllerBurnAtoms * REFERENCE_WORLD_PRICE)
    for (const [actual, expected] of [[r.protocolCostWei, expectedCost], [r.returnMultiple, expectedReturn]]) {
      if (actual?.numerator !== expected.numerator || actual?.denominator !== expected.denominator) throw new Error('Invalid return arithmetic')
    }
    const key = reignKey(r)
    if (keys.has(key) || i > 0 && compareReturns(value.leaders[i - 1], r) > 0) throw new Error('Invalid return order')
    keys.add(key)
  }
  return value
}
