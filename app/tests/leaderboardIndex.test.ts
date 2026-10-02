import { describe, expect, it, vi } from 'vitest'
import { encodeEventTopics, encodeAbiParameters, keccak256, zeroAddress, parseUnits } from 'viem'
import { coreAbi } from '../src/abi'
import { reduceAggregate, syncLeaderboard } from '../worker/leaderboardIndex'
import type { WorldReader } from '../src/chain'
import { A, H, checkpoint, take } from './leaderboardFixture'
function fixture() {
  const previous = checkpoint(); previous.identity.coreCodeHash = keccak256('0x6000')
  const records = take(), final = reduceAggregate(previous, records, { blockNumber: 60n, blockHash: H, timestamp: 600n })
  const logs = records.map(e => ({ ...e, address: A, removed: false,
    topics: encodeEventTopics({ abi: coreAbi, eventName: e.eventName, args: e.args }),
    data: e.eventName === 'Earned' ? encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [0n, 0n])
      : encodeAbiParameters(Array.from({ length: 5 }, () => ({ type: 'uint256' })), [1n, parseUnits('1', 18), 0n, 0n, 20n]) }))
  const client = { getChainId: vi.fn(async () => 97), getBlockNumber: vi.fn(async () => 72n),
    getBlock: vi.fn(async ({ blockNumber }: any) => ({ number: blockNumber, hash: H, timestamp: blockNumber * 10n })),
    getBytecode: vi.fn(async () => '0x6000'), getLogs: vi.fn(async () => logs) }
  const publicMany = vi.fn(async () => final.lands.map(l => [l.controller, l.resistanceRaw, l.lastResistanceUpdate, l.epoch, l.j]))
  const reader = { publicClient: client, config: { chainId: 97, deploymentAddress: A }, publicMany } as unknown as WorldReader
  return { reader, previous, client, publicMany, logs }
}
describe('minimal verified suffix index', () => {
  it('scans only checkpoint + 1 and verifies the resulting 50 LAND state', async () => {
    const f = fixture(), value = await syncLeaderboard(f.reader, f.previous)
    expect(f.client.getLogs.mock.calls[0][0]).toMatchObject({ fromBlock: 2n, toBlock: 60n, address: A })
    expect(f.publicMany.mock.calls[0][0]).toHaveLength(50); expect(value.checkpoint.lands[0].controller).toBe(A)
    expect(value.events).toBe(2); expect(value.target).toBe(60n)
    expect(f.client.getBlock.mock.calls.every(([input]) => input.blockNumber >= f.previous.head.blockNumber)).toBe(true)
  })
  it.each(['chain', 'anchor', 'storage', 'resistance', 'removed', 'rpc', 'duplicate', 'code'])('fails closed on %s without rescan or prefix mutation', async kind => {
    const f = fixture(), before = structuredClone(f.previous)
    if (kind === 'chain') f.client.getChainId.mockResolvedValue(1)
    if (kind === 'anchor') f.client.getBlock.mockImplementation(async ({ blockNumber }: any) => ({ number: blockNumber, hash: blockNumber === 1n ? `0x${'cc'.repeat(32)}` : H, timestamp: blockNumber * 10n }))
    if (kind === 'storage') f.publicMany.mockResolvedValue(Array.from({ length: 50 }, () => [zeroAddress, 0n, 0n, 0n, 0n]))
    if (kind === 'resistance') f.publicMany.mockImplementation(async () => (await reduceAggregate(f.previous, take(), { blockNumber: 60n, blockHash: H, timestamp: 600n })).lands.map(l => [l.controller, 1n, l.lastResistanceUpdate, l.epoch, l.j]))
    if (kind === 'removed') f.logs[0].removed = true
    if (kind === 'rpc') f.client.getLogs.mockRejectedValue(new Error('RPC range incomplete'))
    if (kind === 'duplicate') f.logs.push(f.logs[0])
    if (kind === 'code') f.client.getBytecode.mockResolvedValue('0x6001')
    await expect(syncLeaderboard(f.reader, f.previous)).rejects.toThrow()
    expect(f.previous).toEqual(before)
    expect(f.client.getLogs.mock.calls.every(([input]) => input.fromBlock > f.previous.head.blockNumber)).toBe(true)
  })
})
