import { expect, it } from 'vitest'
import { createWalletClient, http, parseUnits, type Hex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { startAnvil, stopAnvil, deployWorld, LOCAL_MNEMONIC } from '../scripts/anvil'
import { loadParticipantFixture } from '../scripts/compile.mjs'
import { coreAbi, tokenAbi } from '../src/abi'
import { createWorldReader } from '../src/chain'
import { REWARD_DENOMINATOR, TOKEN_UNIT } from '../src/domain'
import { controllerBurn, leaderboardSnapshot } from '../src/leaderboard'
import { freshLeaderboardFixture } from '../scripts/leaderboard-fixture'
import { syncLeaderboard } from '../worker/leaderboardIndex'

it('real chain: controller-only burns, program controller, self epochs, partial withdrawal, one atom and same-block closing credit', async () => {
  const env = await startAnvil(18584, 31360)
  try {
    const d = await deployWorld(env), A = mnemonicToAccount(LOCAL_MNEMONIC), B = mnemonicToAccount(LOCAL_MNEMONIC, { addressIndex: 1 })
    const wa = createWalletClient({ account: A, chain: env.chain, transport: http(env.rpcUrl) })
    const wb = createWalletClient({ account: B, chain: env.chain, transport: http(env.rpcUrl) })
    const reader = createWorldReader({ chainId: 31360, rpcUrl: env.rpcUrl, nativeSymbol: 'BNB', deploymentAddress: d.deploymentAddress, deploymentBlock: d.deploymentBlock })
    const start = await freshLeaderboardFixture(reader), fixture = loadParticipantFixture(), q = (s: string) => parseUnits(s, 18)
    const receipt = async (hash: Hex) => { const r = await env.client.waitForTransactionReceipt({ hash }); expect(r.status).toBe('success'); return r }
    const deployed = await receipt(await wa.deployContract({ abi: fixture.abi, bytecode: fixture.bytecode.object, args: [d.coreAddress, d.tokenAddress, d.profileAddress] }))
    const participant = deployed.contractAddress!
    await receipt(await wa.sendTransaction({ to: participant, value: q('1') }))
    // Time-jump fixtures use a fixed local gas ceiling; latest-block estimates precede the simulated jump.
    const core = async (wallet: typeof wa, name: string, args: unknown[], value?: bigint) => receipt(await wallet.writeContract({ address: d.coreAddress, abi: coreAbi, functionName: name, args, value, gas: 1_000_000n }))
    const actor = async (name: string, args: unknown[]) => receipt(await wa.writeContract({ address: participant, abi: fixture.abi, functionName: name, args, gas: 1_000_000n }))
    for (const wallet of [wa, wb]) {
      await core(wallet, 'buyWorld', [q('5000'), wallet.account.address], q('0.005'))
      await receipt(await wallet.writeContract({ address: d.tokenAddress, abi: tokenAbi, functionName: 'approve', args: [d.coreAddress, q('5000')] }))
    }
    await actor('buy', [q('5000')]); await actor('approve', [q('5000')])
    const time = async () => env.client.request({ method: 'evm_increaseTime', params: [86400] } as never)
    await time()
    await core(wa, 'attack', [7n, 0n, q('10')]); await core(wa, 'attack', [8n, 0n, q('1')])
    await core(wb, 'defend', [7n, 1n, q('4')]); await core(wa, 'defend', [7n, 1n, q('2')])
    await core(wb, 'attack', [7n, 1n, q('1')]); await core(wa, 'attack', [7n, 1n, q('1')])
    await core(wa, 'settleLand', [7n]); await core(wa, 'attack', [7n, 1n, q('20')])
    await time(); await core(wb, 'attack', [7n, 2n, q('30')])
    await time(); await actor('attack', [7n, 3n, q('40')]); await actor('defend', [7n, 4n, q('1')])
    // A voluntary Token burn is not a LAND investment.
    await receipt(await wb.writeContract({ address: d.tokenAddress, abi: tokenAbi, functionName: 'burn', args: [q('1')] }))
    const claim = await reader.readClaimable(A.address), withdrawn = claim / REWARD_DENOMINATOR / 2n
    expect(withdrawn).toBeGreaterThan(0n); await core(wa, 'withdrawRewards', [A.address, withdrawn])
    await core(wa, 'attack', [9n, 0n, 1n])
    await env.client.request({ method: 'evm_increaseTime', params: [3600] } as never)
    await env.client.request({ method: 'evm_setAutomine', params: [false] } as never)
    let first!: Hex, second!: Hex
    try {
      const nonce = await env.client.getTransactionCount({ address: A.address, blockTag: 'pending' })
      first = await wa.writeContract({ address: participant, abi: fixture.abi, functionName: 'settle', args: [7n], nonce, gas: 300000n })
      second = await wa.writeContract({ address: participant, abi: fixture.abi, functionName: 'attack', args: [7n, 4n, q('60')], nonce: nonce + 1, gas: 500000n })
      await env.client.request({ method: 'evm_mine', params: [] } as never)
    } finally { await env.client.request({ method: 'evm_setAutomine', params: [true] } as never) }
    const one = await receipt(first), two = await receipt(second)
    expect(one.blockNumber).toBe(two.blockNumber); expect(one.transactionIndex).toBeLessThan(two.transactionIndex)
    await env.client.request({ method: 'anvil_mine', params: ['0x14'] } as never)
    const c = (await syncLeaderboard(reader, start)).checkpoint, seven = c.reigns.filter(r => r.landId === 7)
    expect(seven.map(r => r.epoch)).toEqual([1n, 2n, 3n, 4n, 5n])
    expect(seven.map(controllerBurn)).toEqual([q('13'), q('20'), q('30'), q('41'), q('60')])
    expect(seven[0].externalSupportBurn).toBe(q('4'))
    expect(seven[0].attackProgressBurn).toBe(q('1'))
    expect(seven[0].defenseBurn).toBe(q('2'))
    expect(seven[4].earnedScaled).toBe(0n); expect(seven[4].controller.toLowerCase()).toBe(participant.toLowerCase())
    expect(seven.slice(0, 4).every(r => r.endedAt !== undefined)).toBe(true)
    const ownCredits = c.reigns.filter(r => r.controller.toLowerCase() === A.address.toLowerCase()).reduce((sum, r) => sum + r.earnedScaled, 0n)
    expect(ownCredits).toBe(await reader.readClaimable(A.address) + withdrawn * REWARD_DENOMINATOR)
    const s = leaderboardSnapshot(c)
    const dust = c.reigns.find(r => r.landId === 9)!
    expect(controllerBurn(dust)).toBe(1n)
    expect(s.leaders.some(r => r.landId === 9)).toBe(false)
    expect(s.leaders.find(r => r.landId === 7 && r.epoch === 5n)?.returnMultiple.numerator).toBe(0n)
    const repeated = (await syncLeaderboard(reader, c)).checkpoint
    expect(repeated.reigns).toEqual(c.reigns)
    expect(TOKEN_UNIT).toBe(q('1'))
  } finally { await stopAnvil(env.child) }
}, 90_000)
