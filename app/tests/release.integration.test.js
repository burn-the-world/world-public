import { expect, it } from 'vitest'
import { createWalletClient, getContractAddress, http } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { startAnvil, stopAnvil, LOCAL_MNEMONIC } from '../scripts/anvil'
import { compileRelease } from '../../scripts/verify-release.mjs'

it('verified Prague artifact creates Token/Core/Profile in order with permanent CREATE bindings', async () => {
  const release = compileRelease()
  const env = await startAnvil(18592, 31360)
  try {
    const account = mnemonicToAccount(LOCAL_MNEMONIC)
    const wallet = createWalletClient({ account, chain: env.chain, transport: http(env.rpcUrl) })
    const receipt = await env.client.waitForTransactionReceipt({ hash: await wallet.deployContract({
      abi: release.contracts.WorldDeploymentBSCV2.abi, bytecode: release.contracts.WorldDeploymentBSCV2.bytecode,
    }) })
    expect(receipt.status).toBe('success')
    const factory = receipt.contractAddress
    expect(factory).toBeTruthy()
    const read = (address, name, functionName) => env.client.readContract({ address,
      abi: release.contracts[name].abi, functionName })
    const [token, core, profile] = await Promise.all(['token', 'core', 'profile'].map(fn => read(factory, 'WorldDeploymentBSCV2', fn)))
    for (const [address, nonce] of [[token, 1n], [core, 2n], [profile, 3n]]) {
      expect(address.toLowerCase()).toBe(getContractAddress({ from: factory, nonce }).toLowerCase())
    }
    expect((await read(token, 'WorldTokenBSCV2', 'core')).toLowerCase()).toBe(core.toLowerCase())
    expect((await read(core, 'WorldCoreBSCV2', 'token')).toLowerCase()).toBe(token.toLowerCase())
    expect((await read(profile, 'WorldLandProfileBSCV2', 'core')).toLowerCase()).toBe(core.toLowerCase())
    expect(await read(token, 'WorldTokenBSCV2', 'totalSupply')).toBe(0n)
    expect(await read(core, 'WorldCoreBSCV2', 'N')).toBe(50n)
    expect(await read(core, 'WorldCoreBSCV2', 'W')).toBe(65n)
  } finally {
    await stopAnvil(env.child)
  }
}, 45_000)
