import { zeroAddress } from 'viem'
import type { LeaderboardCheckpoint } from '../src/leaderboard'
import { REFERENCE_WORLD_PRICE } from '../src/leaderboard'
import { TOKEN_UNIT, REWARD_DENOMINATOR } from '../src/domain'
import type { AggregateEvent } from '../worker/leaderboardIndex'
export const A = '0x1111111111111111111111111111111111111111', C = '0x2222222222222222222222222222222222222222'
export const H = `0x${'ab'.repeat(32)}` as const
export function checkpoint(): LeaderboardCheckpoint {
  return { version: 3, identity: { chainId: 97, core: A, deployment: A, token: A, profile: A, genesisHash: H, deploymentBlock: 1n, deploymentBlockHash: H, coreCodeHash: H, factoryCodeHash: H },
    head: { blockNumber: 1n, timestamp: 10n, blockHash: H }, globalJ: 0n, reigns: [], worldPrice: REFERENCE_WORLD_PRICE, tokenUnit: TOKEN_UNIT, rewardDenominator: REWARD_DENOMINATOR,
    lands: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, controller: zeroAddress, epoch: 0n, startedAt: 0n, j: 0n, resistanceRaw: 0n, lastResistanceUpdate: 0n })) }
}
export function event(name: 'Taken' | 'Earned' | 'Defended' | 'AttackProgress', args: Record<string, unknown>, block = 2n, logIndex = 0, transactionIndex = 0): AggregateEvent {
  return { eventName: name, args: name === 'Earned' ? args : { resistanceRaw: 0n, lastResistanceUpdate: block * 10n, ...args }, blockNumber: block, timestamp: block * 10n, blockHash: H, transactionHash: H, transactionIndex, logIndex }
}
export function take(id = 1n, owner = A, old = zeroAddress, epoch = 1n, J = 0n, delta = 0n, block = 2n, burn = TOKEN_UNIT) {
  return [event('Earned', { id, beneficiary: old === zeroAddress ? owner : old, J, delta }, block),
    event('Taken', { id, oldController: old, newController: owner, epoch, amount: burn }, block, 1)]
}
