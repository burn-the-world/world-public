// Tests only: an empty checkpoint at the receipt of a freshly deployed, verified factory.
import { keccak256, zeroAddress } from 'viem'
import type { WorldReader } from '../src/chain'
import type { LeaderboardCheckpoint } from '../src/leaderboard'
import { REFERENCE_WORLD_PRICE } from '../src/leaderboard'
import { REWARD_DENOMINATOR, TOKEN_UNIT } from '../src/domain'
export async function freshLeaderboardFixture(reader: WorldReader): Promise<LeaderboardCheckpoint> {
  const addresses = await reader.resolveAddresses(), client = reader.publicClient
  const block = await client.getBlock({ blockNumber: reader.config.deploymentBlock })
  const [genesis, coreCode, factoryCode] = await Promise.all([client.getBlock({ blockNumber: 0n }),
    client.getBytecode({ address: addresses.core, blockNumber: block.number }), client.getBytecode({ address: addresses.deployment!, blockNumber: block.number })])
  if (!block.hash || !genesis.hash || !coreCode || !factoryCode || !addresses.profile || !addresses.deployment) throw new Error('Invalid fresh fixture')
  return { version: 3, identity: { ...addresses as Required<typeof addresses>, chainId: reader.config.chainId,
    genesisHash: genesis.hash, deploymentBlock: block.number, deploymentBlockHash: block.hash,
    factoryCodeHash: keccak256(factoryCode), coreCodeHash: keccak256(coreCode) },
    head: { blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp }, globalJ: 0n, reigns: [],
    worldPrice: REFERENCE_WORLD_PRICE, tokenUnit: TOKEN_UNIT, rewardDenominator: REWARD_DENOMINATOR,
    lands: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, controller: zeroAddress, epoch: 0n, j: 0n, startedAt: 0n, resistanceRaw: 0n, lastResistanceUpdate: 0n })) }
}
