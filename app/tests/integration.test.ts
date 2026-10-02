import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { createWalletClient, decodeEventLog, getAddress, getContractAddress, http, parseUnits, zeroAddress, encodeAbiParameters, encodeFunctionData, type Hex, type Abi, type Address, type TransactionReceipt } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { createWorldReader, executeWorldAction, worldErrorMessage, type WorldAction } from '../src/chain'
import { B, REWARD_DENOMINATOR, RESISTANCE_Q as Q, attackPreview, pendingNumerator, type WorldSnapshot } from '../src/domain'
import { deployWorld, LOCAL_MNEMONIC, startAnvil, stopAnvil } from '../scripts/anvil'
import { projectRoot, loadParticipantFixture } from '../scripts/compile.mjs'

const PORT = Number(process.env.WORLD_TEST_PORT || 18560)
const CHAIN = 31360
const H = 3_888_000n
const T = 5_184_000n
const world = (value: string) => parseUnits(value, 18)
const stringify = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)
const accounts = [0, 1, 2].map(addressIndex => mnemonicToAccount(LOCAL_MNEMONIC, { addressIndex }))
const [A, BOB, C] = accounts
type Account = typeof A
type LandTuple = readonly [Address, bigint, bigint, bigint, bigint]
const evidence: Record<string, any> = { version: 'BSC Burn + Resistance V2 frontend', execution: 'Real localhost Anvil; frontend reader/writer with local test signers. No public transactions, no Solidity recompilation.', startedAt: new Date().toISOString(), deployments: [], receipts: [], assertions: [], fixtures: [] }

describe('V2 frontend against fresh real factory deployments', () => {
  let env: Awaited<ReturnType<typeof startAnvil>>
  let deployed: Awaited<ReturnType<typeof deployWorld>>
  let reader: ReturnType<typeof createWorldReader>
  let coreAbi: Abi, tokenAbi: Abi, profileAbi: Abi
  let fixedTime: bigint
  const wallet = (account: Account) => createWalletClient({ account, chain: env.chain, transport: http(env.rpcUrl) })

  beforeAll(async () => { env = await startAnvil(PORT, CHAIN) }, 30_000)
  beforeEach(async () => {
    deployed = await deployWorld(env)
    coreAbi = deployed.artifacts.WorldCoreBSCV2.abi
    tokenAbi = deployed.artifacts.WorldTokenBSCV2.abi
    profileAbi = deployed.artifacts.WorldLandProfileBSCV2.abi
    fixedTime = (await env.client.getBlock()).timestamp
    reader = createWorldReader({ chainId: CHAIN, rpcUrl: env.rpcUrl, nativeSymbol: 'BNB', deploymentAddress: deployed.deploymentAddress,
      deploymentBlock: deployed.deploymentBlock, recentBlockWindow: 50_000n })
    evidence.deployments.push({ factory: deployed.deploymentAddress, token: deployed.tokenAddress, core: deployed.coreAddress, profile: deployed.profileAddress,
      transactionHash: deployed.deploymentHash, block: deployed.deploymentBlock, chainId: CHAIN, rpcUrl: env.rpcUrl })
  }, 30_000)
  afterAll(async () => {
    evidence.finishedAt = new Date().toISOString()
    evidence.allPassed = evidence.assertions.length === 14
    fs.mkdirSync(path.join(projectRoot, 'test-results'), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'test-results/integration-evidence-v2.json'), stringify(evidence) + '\n')
    if (env) await stopAnvil(env.child)
  })

  async function rpc(method: string, params: unknown[] = []) { return env.client.request({ method, params } as never) }
  async function pin() { await rpc('evm_setNextBlockTimestamp', [Number(fixedTime)]) }
  async function advance(seconds: bigint) { fixedTime += seconds; await pin(); await rpc('evm_mine') }
  async function record(receipt: TransactionReceipt, detail: Record<string, unknown>) {
    const block = await env.client.getBlock({ blockNumber: receipt.blockNumber })
    const transaction = await env.client.getTransaction({ hash: receipt.transactionHash })
    evidence.receipts.push({ ...detail, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, timestamp: block.timestamp,
      status: receipt.status, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, from: receipt.from, to: receipt.to,
      value: transaction.value, logs: receipt.logs })
  }
  async function act(account: Account, action: WorldAction, customWallet = wallet(account), customReader = reader) {
    await pin()
    const stages: string[] = []
    const receipt = await executeWorldAction(customReader, customWallet, account.address, action, stage => stages.push(stage))
    expect(receipt.status).toBe('success')
    expect(stages).toEqual(['checking', 'simulating', 'confirm', 'pending', 'success'])
    await record(receipt, { viaFrontendWriter: true, action, stages })
    return receipt
  }
  async function buy(account: Account, amount: bigint) { return act(account, { kind: 'buy', amount, quotedCost: await reader.quoteBuy(amount) }) }
  async function approve(account: Account, amount: bigint) { return act(account, { kind: 'approve', amount }) }
  async function funded(account: Account, amount = world('10000')) { await buy(account, amount); await approve(account, amount) }
  async function warAction(kind: 'attack' | 'defend', id: number, amount: bigint): Promise<WorldAction> {
    const land = await reader.readLand(id)
    return { kind, id, amount, expectedEpoch: land.epoch, expectedResistanceRaw: land.resistanceRaw, expectedLastResistanceUpdate: land.lastResistanceUpdate }
  }
  async function war(account: Account, kind: 'attack' | 'defend', id: number, amount: bigint) { return act(account, await warAction(kind, id, amount)) }
  async function core<T>(functionName: string, args: readonly unknown[] = [], blockNumber?: bigint): Promise<T> {
    return env.client.readContract({ address: deployed.coreAddress, abi: coreAbi, functionName, args, blockNumber }) as Promise<T>
  }
  async function token<T>(functionName: string, args: readonly unknown[] = [], blockNumber?: bigint): Promise<T> {
    return env.client.readContract({ address: deployed.tokenAddress, abi: tokenAbi, functionName, args, blockNumber }) as Promise<T>
  }
  async function rawTx(account: Account, address: Address, abi: Abi, functionName: string, args: readonly unknown[], value = 0n, gas?: bigint) {
    await pin()
    const hash = await wallet(account).writeContract({ address, abi, functionName, args, value, ...(gas ? { gas } : {}) })
    const receipt = await env.client.waitForTransactionReceipt({ hash })
    await record(receipt, { fixtureDirectCall: true, functionName, args })
    return receipt
  }
  async function profile(id: number) {
    return env.client.readContract({ address: deployed.profileAddress, abi: profileAbi, functionName: 'getCurrentProfile', args: [BigInt(id)] }) as Promise<readonly [boolean, Address, bigint, string, string, string]>
  }
  function coreEvents(receipt: TransactionReceipt) {
    return receipt.logs.filter(log => log.address.toLowerCase() === deployed.coreAddress.toLowerCase()).flatMap(log => {
      try { return [decodeEventLog({ abi: coreAbi, data: log.data, topics: log.topics })] } catch { return [] }
    })
  }
  function passed(name: string, details: unknown = {}) { evidence.assertions.push({ name, passed: true, details }) }

  it('changes only the name while preserving old chain fields across clearing and a new epoch', async () => {
    await funded(A); await war(A, 'attack', 23, world('1'))
    const logo='ipfs://legacy/头像.png', website='https://legacy.example/original'
    await rawTx(A, deployed.profileAddress, profileAbi, 'setProfile', [23n,1n,'Original',logo,website])
    await act(A,{kind:'profile',id:23,expectedEpoch:1n,name:'Rabbit Hole'})
    expect((await profile(23)).slice(3)).toEqual(['Rabbit Hole',logo,website])
    await act(A,{kind:'profile',id:23,expectedEpoch:1n,name:''})
    expect((await profile(23)).slice(3)).toEqual(['',logo,website])
    await war(A, 'attack', 23, world('2'))
    expect((await profile(23)).slice(3)).toEqual(['','',''])
    await act(A,{kind:'profile',id:23,expectedEpoch:2n,name:'New reign'})
    expect((await profile(23)).slice(3)).toEqual(['New reign',logo,website])
    passed('name_only_preserves_legacy_fields_after_clear_and_epoch_change')
  }, 60_000)

  it('leaves non-UTF-8 legacy chain bytes untouched instead of replacing them during a name save', async () => {
    await funded(A);await war(A,'attack',23,world('1'))
    const selector=encodeFunctionData({abi:profileAbi,functionName:'setProfile',args:[23n,1n,'Original','','']}).slice(0,10)
    const encoded=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'string'},{type:'bytes'},{type:'string'}],[23n,1n,'Original','0xff','legacy'])
    await pin()
    const hash=await wallet(A).sendTransaction({to:deployed.profileAddress,data:(selector+encoded.slice(2)) as Hex})
    const receipt=await env.client.waitForTransactionReceipt({hash});expect(receipt.status).toBe('success');await record(receipt,{fixtureDirectCall:true,case:'non_utf8_legacy'})
    const getter=encodeFunctionData({abi:profileAbi,functionName:'getCurrentProfile',args:[23n]})
    const before=await env.client.call({to:deployed.profileAddress,data:getter})
    await expect(executeWorldAction(reader,wallet(A),A.address,{kind:'profile',id:23,expectedEpoch:1n,name:'New'})).rejects.toThrow(/字段|Profile/)
    expect((await env.client.call({to:deployed.profileAddress,data:getter})).data).toBe(before.data)
    passed('name_only_refuses_lossy_non_utf8_fields')
  },60_000)

  async function parity(snapshot: WorldSnapshot, beneficiaries: Address[]) {
    const n = snapshot.blockNumber
    expect(snapshot.timestamp).toBe((await env.client.getBlock({ blockNumber: n })).timestamp)
    expect(snapshot.lands).toHaveLength(50)
    expect(snapshot.parameters).toMatchObject({ N: 50, W: 65n, B, T, resistanceHalfLife: H, tokenUnit: 10n ** 18n,
      worldPrice: 1_000_000_000_000n, maxWarAtoms: 1n << 128n, resistanceLimit: 1n << 192n })
    const rows = await Promise.all(snapshot.lands.map(async land => {
      const [tuple, current, minimum] = await Promise.all([core<LandTuple>('lands', [BigInt(land.id)], n),
        core<bigint>('currentResistanceRaw', [BigInt(land.id)], n), core<bigint>('minimumAttackAtoms', [BigInt(land.id)], n)])
      expect([land.controller, land.resistanceRaw, land.lastResistanceUpdate, land.epoch, land.j]).toEqual(tuple)
      expect(land.currentResistanceRaw).toBe(current); expect(land.minimumAttackAtoms).toBe(minimum)
      expect(minimum).toBe(current / Q + 1n)
      return pendingNumerator(land, snapshot.J)
    }))
    const claims = await Promise.all(beneficiaries.map(address => core<bigint>('claimable', [address], n)))
    const pending = rows.reduce((a, b) => a + b, 0n)
    expect(snapshot.U * 65n + pending + claims.reduce((a, b) => a + b, 0n)).toBe(snapshot.accountedBNB * REWARD_DENOMINATOR)
    expect(snapshot.totalSupply).toBe(await token<bigint>('totalSupply', [], n))
    expect(snapshot.coreWorldBalance).toBe(await token<bigint>('balanceOf', [deployed.coreAddress], n))
  }

  it('validates new three-contract bindings, 50 block-pinned LAND and all-mint paid buys', async () => {
    const addresses = await reader.resolveAddresses()
    expect(getAddress(addresses.core)).toBe(getAddress(deployed.coreAddress))
    for (const [nonce, address] of [[1n, deployed.tokenAddress], [2n, deployed.coreAddress], [3n, deployed.profileAddress]] as const)
      expect(getAddress(address)).toBe(getAddress(getContractAddress({ from: deployed.deploymentAddress, nonce })))
    expect(await token<bigint>('totalSupply')).toBe(0n)
    expect(await token<number>('decimals')).toBe(18)
    const q = world('1000') + 1n
    expect(await reader.quoteBuy(q)).toBe(1_000_000_000_000_001n)
    await buy(A, q)
    expect(await token<bigint>('balanceOf', [A.address])).toBe(q)
    expect(await token<bigint>('totalSupply')).toBe(q)
    const snap = await reader.readSnapshot(A.address)
    await advance(60n)
    await parity(snap, accounts.map(a => a.address))
    expect(snap.lands.reduce((sum, land) => sum + land.weight, 0n)).toBe(65n)
    passed('deployment_buy_block_pinned_50_land', { q, snapshotBlock: snap.blockNumber })
  }, 60_000)

  it('executes Burn first occupation, partial attack, equality, strict capture, third-party defense and self-takeover', async () => {
    await funded(A); await funded(BOB); await funded(C)
    const before = await token<bigint>('totalSupply')
    await war(A, 'attack', 1, world('100'))
    await act(A, { kind: 'profile', id: 1, expectedEpoch: 1n, name: '初始王冠' })
    expect((await profile(1))[0]).toBe(true)
    const partial = await war(BOB, 'attack', 1, world('40'))
    expect(coreEvents(partial).some(e => e.eventName === 'AttackProgress')).toBe(true)
    expect((await reader.readLand(1)).resistanceRaw).toBe(world('60') * Q)
    const equal = await war(BOB, 'attack', 1, world('60'))
    expect(coreEvents(equal).some(e => e.eventName === 'Taken')).toBe(false)
    expect(await reader.readLand(1)).toMatchObject({ resistanceRaw: 0n, epoch: 1n, controller: A.address })
    await war(BOB, 'attack', 1, 1n)
    expect(await reader.readLand(1)).toMatchObject({ resistanceRaw: Q, epoch: 2n, controller: BOB.address })
    expect((await profile(1))[0]).toBe(false)
    await war(C, 'defend', 1, 3n)
    expect(await reader.readLand(1)).toMatchObject({ resistanceRaw: 4n * Q, epoch: 2n, controller: BOB.address })
    await act(BOB, { kind: 'profile', id: 1, expectedEpoch: 2n, name: '新主' })
    const self = await war(BOB, 'attack', 1, 5n)
    expect(await reader.readLand(1)).toMatchObject({ resistanceRaw: Q, epoch: 3n, controller: BOB.address })
    expect((await profile(1))[0]).toBe(false)
    const burned = world('200') + 9n
    expect(await token<bigint>('totalSupply')).toBe(before - burned)
    expect(await token<bigint>('balanceOf', [deployed.coreAddress])).toBe(0n)
    await parity(await reader.readSnapshot(A.address), accounts.map(a => a.address))
    passed('war_burn_lifecycle', { burned, selfReceipt: self.transactionHash })
  }, 90_000)

  it('keeps sub-atom live walls and fractional takeover excess with exact same-second allowance consumption', async () => {
    await funded(A); await funded(BOB)
    await war(A, 'attack', 2, 1n)
    await advance(1n)
    const tiny = await reader.readLand(2)
    expect(tiny.currentResistanceRaw).toBeGreaterThan(0n); expect(tiny.currentResistanceRaw).toBeLessThan(Q)
    expect(tiny.minimumAttackAtoms).toBe(1n)
    expect(attackPreview(tiny, 1n).taken).toBe(true)
    await approve(BOB, 1n)
    const supply = await token<bigint>('totalSupply')
    await war(BOB, 'attack', 2, 1n)
    expect((await reader.readLand(2)).resistanceRaw).toBe(Q - tiny.currentResistanceRaw)
    expect(await reader.readAllowance(BOB.address)).toBe(0n)
    expect(await token<bigint>('totalSupply')).toBe(supply - 1n)
    passed('fractional_excess_and_exact_allowance', { beforeRaw: tiny.currentResistanceRaw, excess: Q - tiny.currentResistanceRaw })
  }, 60_000)

  it('uses controlled 45-day blocks: 1000 then 0.01 gives500.01; read/settle/Profile do not refresh anchors', async () => {
    await funded(A)
    await war(A, 'attack', 3, world('1000'))
    const old = await reader.readLand(3)
    await advance(H)
    const live = await reader.readLand(3)
    expect(live.currentResistanceRaw).toBe(world('500') * Q)
    expect(live.resistanceRaw).toBe(old.resistanceRaw)
    await act(A, { kind: 'settle', id: 3 })
    await act(A, { kind: 'profile', id: 3, expectedEpoch: 1n, name: '' })
    await act(A, { kind: 'sync' })
    expect((await reader.readLand(3)).lastResistanceUpdate).toBe(old.lastResistanceUpdate)
    const receipt = await war(A, 'defend', 3, world('0.01'))
    expect((await reader.readLand(3)).resistanceRaw).toBe(world('500.01') * Q)
    expect((await env.client.getBlock({ blockNumber: receipt.blockNumber })).timestamp - old.lastResistanceUpdate).toBe(H)
    passed('controlled45_microdefend_no_reanchor', { old: old.resistanceRaw, newRaw: (await reader.readLand(3)).resistanceRaw, elapsed: H })
  }, 90_000)

  it('rejects same-epoch stale wall plans but decodes a real defense race after the last wallet check', async () => {
    await funded(A); await funded(BOB)
    await war(A, 'attack', 4, world('100'))
    const stale = await warAction('attack', 4, world('100') + 1n)
    await war(A, 'defend', 4, 1n)
    await expect(act(BOB, stale)).rejects.toThrow(/状态/)
    const latest = await reader.readLand(4)
    const amount = latest.minimumAttackAtoms
    const baseWallet = wallet(BOB)
    const raceWallet = { ...baseWallet, writeContract: async (request: Parameters<typeof baseWallet.writeContract>[0]) => {
      const defensive = await rawTx(A, deployed.coreAddress, coreAbi, 'defend', [4n, 1n, world('100')])
      expect(defensive.status).toBe('success')
      await pin()
      return baseWallet.writeContract(request)
    } } as typeof baseWallet
    const receipt = await act(BOB, await warAction('attack', 4, amount), raceWallet)
    expect(coreEvents(receipt).some(event => event.eventName === 'AttackProgress')).toBe(true)
    expect(coreEvents(receipt).some(event => event.eventName === 'Taken')).toBe(false)
    expect((await reader.readLand(4)).controller).toBe(A.address)
    passed('same_epoch_race_receipt_truth', { amount, receipt: receipt.transactionHash })
  }, 90_000)

  it('refreshes the real live wall after authorization waits while leaving the user amount unchanged', async () => {
    await funded(A); await buy(BOB, world('1000'))
    await war(A, 'attack', 5, world('1000'))
    const old = await reader.readLand(5)
    expect(attackPreview(old, world('600')).taken).toBe(false)
    const baseWallet = wallet(BOB)
    const delayedApproval = { ...baseWallet, writeContract: async (request: Parameters<typeof baseWallet.writeContract>[0]) => {
      await advance(H)
      return baseWallet.writeContract(request)
    } } as typeof baseWallet
    await act(BOB, { kind: 'approve', amount: world('600') }, delayedApproval)
    const refreshed = await reader.readLand(5)
    expect(refreshed.currentResistanceRaw).toBe(world('500') * Q)
    expect(refreshed.lastResistanceUpdate).toBe(old.lastResistanceUpdate)
    const receipt = await war(BOB, 'attack', 5, world('600'))
    expect((await reader.readLand(5)).resistanceRaw).toBe(world('100') * Q)
    expect(coreEvents(receipt).some(event => event.eventName === 'Taken')).toBe(true)
    passed('approval_delay_refresh_amount_unchanged', { amount: world('600'), beforeRaw: old.currentResistanceRaw, afterApprovalRaw: refreshed.currentResistanceRaw })
  }, 90_000)

  it('separates 60-day Treasury, neutral treasure, old-owner claims, loss of all land and retained withdrawal remainder', async () => {
    await buy(A, world('1300000')); await approve(A, world('1300000'))
    const start = await core<bigint>('t0')
    fixedTime = start
    await advance(T)
    const snapshot = await reader.readSnapshot(A.address)
    expect(snapshot.U).toBe(parseUnits('0.65', 18) * B)
    for (const land of snapshot.lands) {
      const expected = land.id === 1 ? '0.06' : land.id <= 6 ? '0.03' : '0.01'
      expect(pendingNumerator(land, snapshot.J) / REWARD_DENOMINATOR).toBe(parseUnits(expected, 18))
    }
    await war(A, 'attack', 1, 1n)
    expect(await reader.readClaimable(A.address)).toBe(parseUnits('0.06', 18) * REWARD_DENOMINATOR)
    // Existing tokens transferred to B: no new income resets the Treasury anchor.
    await rawTx(A, deployed.tokenAddress, tokenAbi, 'transfer', [BOB.address, 100n])
    await approve(BOB, 100n)
    await advance(3601n)
    await war(BOB, 'attack', 1, 2n)
    const credit = await reader.readClaimable(A.address)
    expect(credit).toBeGreaterThan(parseUnits('0.06', 18) * REWARD_DENOMINATOR)
    expect((await reader.readSnapshot(A.address)).lands.some(land => land.controller === A.address)).toBe(false)
    const nativeBefore = await env.client.getBalance({ address: A.address })
    const receipt = await act(A, { kind: 'withdraw' })
    const paid = credit / REWARD_DENOMINATOR
    expect(await reader.readClaimable(A.address)).toBe(credit % REWARD_DENOMINATOR)
    expect(await env.client.getBalance({ address: A.address })).toBe(nativeBefore + paid - receipt.gasUsed * receipt.effectiveGasPrice)
    expect(await core<bigint>('t0')).toBe(start)
    await parity(await reader.readSnapshot(A.address), accounts.map(a => a.address))
    passed('treasury60_old_owner_claim_remainder', { start, paid, remainder: credit % REWARD_DENOMINATOR })
  }, 90_000)

  it('keeps empty Profiles editable, enforces UTF8 byte lengths and invalidates on capture/recapture', async () => {
    await funded(A); await funded(BOB)
    await war(A, 'attack', 6, world('10'))
    await act(A, { kind: 'profile', id: 6, expectedEpoch: 1n, name: '' })
    expect((await profile(6))[0]).toBe(true)
    const exact = '界'.repeat(21) + 'A'
    await act(A, { kind: 'profile', id: 6, expectedEpoch: 1n, name: exact })
    await expect(act(A, { kind: 'profile', id: 6, expectedEpoch: 1n, name: exact + 'B' })).rejects.toThrow(/64|字节/)
    await war(BOB, 'attack', 6, world('11'))
    expect((await profile(6))[0]).toBe(false)
    await act(BOB, { kind: 'profile', id: 6, expectedEpoch: 2n, name: '新王国' })
    await war(A, 'attack', 6, world('2'))
    expect((await profile(6))[0]).toBe(false)
    await act(A, { kind: 'profile', id: 6, expectedEpoch: 3n, name: '重夺' })
    passed('profile_utf8_empty_recapture')
  }, 90_000)

  it('rejects stale epochs, insufficient authorization/balance, wallet rejection, and real mined rollback without reporting Burn', async () => {
    await funded(A); await buy(BOB, 2n)
    await war(A, 'attack', 7, 1n)
    const action = await warAction('attack', 7, 2n)
    await expect(act(BOB, action)).rejects.toThrow(/授权/)
    await approve(BOB, 10n)
    await expect(act(BOB, await warAction('attack', 7, 3n))).rejects.toThrow(/余额/)
    const baseWallet = wallet(BOB)
    const rejection = { ...baseWallet, writeContract: async () => { throw Object.assign(new Error('User rejected request'), { code: 4001 }) } } as typeof baseWallet
    await expect(act(BOB, action, rejection)).rejects.toThrow(/rejected/)
    expect(worldErrorMessage(new Error('User rejected request'))).toContain('未提交')
    const beforeSupply = await token<bigint>('totalSupply')
    const beforeBalance = await token<bigint>('balanceOf', [BOB.address])
    const beforeAllowance = await reader.readAllowance(BOB.address)
    const failed = await rawTx(BOB, deployed.coreAddress, coreAbi, 'attack', [7n, 0n, 2n], 0n, 500_000n)
    expect(failed.status).toBe('reverted'); expect(failed.logs).toHaveLength(0)
    expect(await token<bigint>('totalSupply')).toBe(beforeSupply)
    expect(await token<bigint>('balanceOf', [BOB.address])).toBe(beforeBalance)
    expect(await reader.readAllowance(BOB.address)).toBe(beforeAllowance)
    const stale = { ...action, expectedEpoch: 0n } as WorldAction
    await expect(act(BOB, stale)).rejects.toThrow(/状态/)
    passed('rejections_real_rollback', { failedReceipt: failed.transactionHash, rejectedWalletWasTestDouble: true })
  }, 90_000)

  it('confirms BNB donations once, treats accidental WORLD as unsellable, and leaves holder burns outside LAND rewards', async () => {
    await funded(A)
    await rawTx(A, deployed.tokenAddress, tokenAbi, 'transfer', [deployed.coreAddress, 100n])
    const supply = await token<bigint>('totalSupply')
    await buy(A, 100n)
    expect(await token<bigint>('totalSupply')).toBe(supply + 100n)
    expect(await token<bigint>('balanceOf', [deployed.coreAddress])).toBe(100n)
    const accounted = await core<bigint>('accountedBNB')
    await pin()
    const hash = await wallet(A).sendTransaction({ to: deployed.coreAddress, value: 12345n })
    const donation = await env.client.waitForTransactionReceipt({ hash })
    await record(donation, { localBNBDonation: true })
    expect(await core<bigint>('accountedBNB')).toBe(accounted)
    await act(A, { kind: 'sync' }); await act(A, { kind: 'sync' })
    expect(await core<bigint>('accountedBNB')).toBe(accounted + 12345n)
    await war(A, 'attack', 8, 25n)
    await rawTx(A, deployed.tokenAddress, tokenAbi, 'burn', [7n])
    passed('bnb_sync_unsellable_world_no_doublecount')
  }, 90_000)

  it('keeps Core usable during Profile getter faults, refuses RPC interruption and wrong identity', async () => {
    await funded(A); await war(A, 'attack', 9, 10n)
    let mode: 'profile' | 'offline' = 'profile'
    let faults = 0
    const proxy = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const payload = JSON.parse(Buffer.concat(chunks).toString())
        const handle = async (item: any) => {
          if (mode === 'offline' || (item.method === 'eth_call' && item.params?.[0]?.data?.toLowerCase().includes('e0805c22'))) {
            faults++; return { id: item.id, jsonrpc: '2.0', error: { code: -32000, message: 'Local integration RPC fault fixture' } }
          }
          return (await fetch(env.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) })).json()
        }
        const result = Array.isArray(payload) ? await Promise.all(payload.map(handle)) : await handle(payload)
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
      } catch (error) { response.writeHead(500).end(String(error)) }
    })
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
    try {
      const faulty = createWorldReader({ ...reader.config, rpcUrl: `http://127.0.0.1:${(proxy.address() as { port: number }).port}` })
      const snap = await faulty.readSnapshot(A.address)
      const profiles = await faulty.readProfiles(snap)
      expect(Object.values(profiles).every(p => p.status === 'unavailable')).toBe(true)
      expect(faults).toBeGreaterThanOrEqual(50)
      await act(A, { kind: 'settle', id: 9 }, wallet(A), faulty)
      mode = 'offline'
      await expect(faulty.readSnapshot(A.address)).rejects.toThrow()
      await expect(act(A, { kind: 'settle', id: 9 }, wallet(A), faulty)).rejects.toThrow()
      const wrong = createWorldReader({ ...reader.config, chainId: 56 })
      await expect(wrong.validate()).rejects.toThrow(/网络/)
      const wrongFactory = createWorldReader({ ...reader.config, deploymentAddress: deployed.tokenAddress })
      await expect(wrongFactory.validate()).rejects.toThrow()
      passed('profile_rpc_faults_identity', { faults, faultsWereLocalProxy: true })
    } finally { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())) }
  }, 90_000)

  it('reads a contract controller correctly and runs its own buy/approve/war/Profile/claim calls without granting wallet proxy rights', async () => {
    const fixture = loadParticipantFixture()
    await pin()
    const hash = await wallet(A).deployContract({ abi: fixture.abi, bytecode: fixture.bytecode.object,
      args: [deployed.coreAddress, deployed.tokenAddress, deployed.profileAddress] })
    const receipt = await env.client.waitForTransactionReceipt({ hash })
    const address = receipt.contractAddress!
    await record(receipt, { existingCompiledTestParticipant: true })
    await pin()
    const deposit = await wallet(A).sendTransaction({ to: address, value: parseUnits('1', 18) })
    await record(await env.client.waitForTransactionReceipt({ hash: deposit }), { testParticipantFunding: true })
    for (const [fn, args] of [['buy', [world('100')]], ['approve', [world('100')]], ['attack', [10n, 0n, world('10')]], ['defend', [10n, 1n, world('1')]], ['edit', [10n, 1n]]] as const)
      expect((await rawTx(A, address, fixture.abi, fn, args)).status).toBe('success')
    expect((await reader.readLand(10)).controller).toBe(getAddress(address))
    await expect(act(A, { kind: 'profile', id: 10, expectedEpoch: 1n, name: '不能代签' })).rejects.toThrow(/Controller/)
    await advance(T)
    await rawTx(A, address, fixture.abi, 'settle', [10n])
    const claim = await reader.readClaimable(address)
    const balance = await env.client.getBalance({ address })
    await rawTx(A, address, fixture.abi, 'withdraw', [claim / REWARD_DENOMINATOR])
    expect(await env.client.getBalance({ address })).toBe(balance + claim / REWARD_DENOMINATOR)
    await parity(await reader.readSnapshot(A.address), [...accounts.map(a => a.address), address])
    evidence.fixtures.push({ type: 'existing compiled BSCV2Participant', address, note: 'Not production protocol. Calls originate from contract itself; external test driver is not a proxy permission in DApp.' })
    passed('contract_controller_reader_and_own_calls')
  }, 90_000)
})
