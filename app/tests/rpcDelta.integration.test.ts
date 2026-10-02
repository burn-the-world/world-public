import { expect, it } from 'vitest'
import { createWalletClient, http, parseUnits } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { startAnvil, stopAnvil, deployWorld, LOCAL_MNEMONIC } from '../scripts/anvil'
import { createWorldReader, executeWorldAction, type WorldAction } from '../src/chain'

it('matches full pinned state after targeted attack, unrelated takeover, defense, settle, Profile and reorg', async () => {
  const env = await startAnvil(18568, 31360)
  try {
    const d = await deployWorld(env)
    const reader = createWorldReader({ chainId: 31360, rpcUrl: env.rpcUrl, nativeSymbol: 'BNB',
      deploymentAddress: d.deploymentAddress, deploymentBlock: d.deploymentBlock, recentBlockWindow: 1000n })
    const account = mnemonicToAccount(LOCAL_MNEMONIC)
    const wallet = createWalletClient({ account, chain: env.chain, transport: http(env.rpcUrl) })
    const act = (action: WorldAction) => executeWorldAction(reader, wallet, account.address, action, () => {})
    const amount = parseUnits('1000',18)
    await act({kind:'buy',amount,quotedCost:await reader.quoteBuy(amount)})
    await act({kind:'approve',amount})
    let previous = await reader.readSnapshot(account.address)
    await reader.readProfiles(previous)
    const snapshotId = await env.client.request({method:'evm_snapshot' as never} as never)
    for(const id of [1,2]) {
      const land=await reader.readLand(id)
      await act({kind:'attack',id,amount:parseUnits('10',18),expectedEpoch:land.epoch,
        expectedResistanceRaw:land.resistanceRaw,expectedLastResistanceUpdate:land.lastResistanceUpdate})
    }
    let land=await reader.readLand(2)
    await act({kind:'defend',id:2,amount:parseUnits('1',18),expectedEpoch:land.epoch,
      expectedResistanceRaw:land.resistanceRaw,expectedLastResistanceUpdate:land.lastResistanceUpdate})
    await act({kind:'profile',id:2,expectedEpoch:land.epoch,name:'Delta'})
    await env.client.request({method:'evm_increaseTime' as never,params:[10000] as never} as never)
    await act({kind:'settle',id:2})
    const delta=await reader.readSnapshot(account.address,previous,[1])
    const full=await reader.readSnapshot(account.address)
    expect(delta).toEqual(full)
    expect(await reader.readProfiles(delta)).toEqual(await reader.readProfiles(full))
    expect((await reader.readProfiles(delta))[2].name).toBe('Delta')
    previous=delta
    await env.client.request({method:'evm_revert' as never,params:[snapshotId] as never} as never)
    const reverted=await reader.readSnapshot(account.address,previous,[1])
    expect(reverted).toEqual(await reader.readSnapshot(account.address))
    expect(reverted.lands[1].epoch).toBe(0n)
  } finally { await stopAnvil(env.child) }
},60_000)
