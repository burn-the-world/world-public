import { expect, it } from 'vitest'
import { createWalletClient, http, parseUnits } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { startAnvil, stopAnvil, deployWorld, LOCAL_MNEMONIC } from '../scripts/anvil'
import { freshLeaderboardFixture } from '../scripts/leaderboard-fixture'
import { createWorldReader, executeWorldAction } from '../src/chain'
import { REWARD_DENOMINATOR } from '../src/domain'
import { syncLeaderboard } from '../worker/leaderboardIndex'
import { leaderboardSnapshot } from '../src/leaderboard'
it('real per-reign credits survive multi-LAND, self takeover, defense, partial withdrawal and reorg', async () => {
  const env = await startAnvil(18582, 31360)
  try {
    const d = await deployWorld(env), a = mnemonicToAccount(LOCAL_MNEMONIC), c = mnemonicToAccount(LOCAL_MNEMONIC, { addressIndex: 1 })
    const reader = createWorldReader({ chainId: 31360, rpcUrl: env.rpcUrl, nativeSymbol: 'BNB', deploymentAddress: d.deploymentAddress, deploymentBlock: d.deploymentBlock, recentBlockWindow: 5000n })
    const start = await freshLeaderboardFixture(reader)
    const wallet = (account: typeof a) => createWalletClient({ account, chain: env.chain, transport: http(env.rpcUrl) })
    const action = (account: typeof a, input: any) => executeWorldAction(reader, wallet(account), account.address, input)
    for (const account of [a, c]) {
      const amount = parseUnits('100', 18)
      await action(account, { kind: 'buy', amount, quotedCost: await reader.quoteBuy(amount) })
      await action(account, { kind: 'approve', amount })
    }
    const war = async (account: typeof a, id: number, kind: 'attack' | 'defend', amount: string) => {
      const l = await reader.readLand(id)
      return action(account, { kind, id, amount: parseUnits(amount, 18), expectedEpoch: l.epoch, expectedResistanceRaw: l.resistanceRaw, expectedLastResistanceUpdate: l.lastResistanceUpdate })
    }
    await war(a, 1, 'attack', '1'); await war(a, 7, 'attack', '1')
    await env.client.request({ method: 'evm_increaseTime', params: [86400] } as never)
    await war(a, 7, 'defend', '1'); await war(a, 7, 'defend', '1'); await war(a, 7, 'attack', '4')
    await war(c, 1, 'attack', '2'); await action(a, { kind: 'settle', id: 7 })
    const claim = await reader.readClaimable(a.address), withdrawn = claim / REWARD_DENOMINATOR / 2n
    expect(withdrawn).toBeGreaterThan(0n)
    await wallet(a).writeContract({ address: d.coreAddress, abi: d.artifacts.WorldCoreBSCV2.abi, functionName: 'withdrawRewards', args: [a.address, withdrawn] }).then(hash => env.client.waitForTransactionReceipt({ hash }))
    await env.client.request({ method: 'anvil_mine', params: ['0x14'] } as never)
    const synced = (await syncLeaderboard(reader, start)).checkpoint
    const credit = synced.reigns.filter(row => row.controller.toLowerCase() === a.address.toLowerCase()).reduce((sum, row) => sum + row.earnedScaled, 0n)
    expect(credit).toBe(await reader.readClaimable(a.address) + withdrawn * REWARD_DENOMINATOR)
    expect(synced.lands[6].epoch).toBe(2n)
    expect(synced.reigns).toHaveLength(4)
    expect(synced.reigns.filter(x => x.endedAt === undefined)).toHaveLength(2)
    expect(leaderboardSnapshot(synced).leaders.map(x => x.status).sort()).toEqual(['FINAL', 'FINAL', 'LIVE', 'LIVE'])
    const marker = await env.client.request({ method: 'evm_snapshot' } as never)
    await war(c, 7, 'attack', '5'); await env.client.request({ method: 'anvil_mine', params: ['0x14'] } as never)
    const fork = (await syncLeaderboard(reader, synced)).checkpoint
    await env.client.request({ method: 'evm_revert', params: [marker] } as never)
    await expect(syncLeaderboard(reader, fork)).rejects.toThrow()
    const restored = (await syncLeaderboard(reader, synced)).checkpoint
    expect(restored.lands[6].controller.toLowerCase()).toBe(a.address.toLowerCase())
  } finally { await stopAnvil(env.child) }
}, 90_000)
