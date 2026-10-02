import { describe, expect, it, vi } from 'vitest'
import { getContractAddress, zeroAddress, type Address, type Hex, type WalletClient } from 'viem'
import { createWorldReader, executeWorldAction, worldQueryKey, worldErrorMessage, type WorldReader } from '../src/chain'
import { loadConfig } from '../src/config'
import { B, W, RESISTANCE_Q, MAX_WAR_ATOMS, RESISTANCE_HALF_LIFE, RESISTANCE_LIMIT, REWARD_DENOMINATOR, weightOf, type WorldSnapshot } from '../src/domain'

const account = '0x1111111111111111111111111111111111111111' as Address
const other = '0x2222222222222222222222222222222222222222' as Address
const deployment = '0x6666666666666666666666666666666666666666' as Address
const core = getContractAddress({ from: deployment, nonce: 2n })
const token = getContractAddress({ from: deployment, nonce: 1n })
const profile = getContractAddress({ from: deployment, nonce: 3n })
const hash = `0x${'a'.repeat(64)}` as Hex
const replacementHash = `0x${'b'.repeat(64)}` as Hex
const land = { id: 1, weight: 6n, controller: account, resistanceRaw: 100n * RESISTANCE_Q, lastResistanceUpdate: 1n, currentResistanceRaw: 100n * RESISTANCE_Q, minimumAttackAtoms: 101n, epoch: 1n, j: 0n }
const action = { kind: 'attack' as const, id: 1, amount: 101n, expectedEpoch: 1n, expectedResistanceRaw: land.resistanceRaw, expectedLastResistanceUpdate: land.lastResistanceUpdate }

function fixture() {
  const publicClient = {
    getBalance: vi.fn().mockResolvedValue(10n ** 18n), getGasPrice: vi.fn().mockResolvedValue(1n),
    chain: { id: 31337 }, getChainId: vi.fn().mockResolvedValue(31337),
    readContract: vi.fn().mockResolvedValue(1000n),
    simulateContract: vi.fn().mockImplementation(async request => ({ request })),
    estimateContractGas: vi.fn().mockResolvedValue(142_472n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', transactionHash: hash }),
  }
  const reader = {
    publicClient, config: { chainId: 31337 },
    validate: vi.fn().mockResolvedValue({ core, token, profile }),
    quoteBuy: vi.fn().mockResolvedValue(42n),
    readLand: vi.fn().mockResolvedValue(land),
    readAllowance: vi.fn().mockResolvedValue(1000n),
    readClaimable: vi.fn().mockResolvedValue(3n * REWARD_DENOMINATOR + 7n),
    readParameters: vi.fn().mockResolvedValue({ N: 50, B, W, T: 5184000n, tokenUnit: 10n ** 18n, worldPrice: 10n ** 12n }),
    readProfileFieldsForName: vi.fn().mockResolvedValue({ logoURI: '', website: '' }),
    readProfileLimits: vi.fn().mockResolvedValue({ name: 64, logoURI: 256, website: 256 }),
  }
  const wallet = {
    getAddresses: vi.fn().mockResolvedValue([account]),
    getChainId: vi.fn().mockResolvedValue(31337),
    writeContract: vi.fn().mockResolvedValue(hash),
  }
  const stage = vi.fn()
  const execute = (selected = action) => executeWorldAction(reader as unknown as WorldReader,
    wallet as unknown as WalletClient, account, selected, stage)
  return { reader, wallet, publicClient, stage, execute }
}

describe('transaction preflight guards', () => {
  it('allows natural wall decay without resetting its anchor or auto-raising attack amount', async () => {
    const f = fixture()
    f.reader.readLand.mockResolvedValueOnce(land).mockResolvedValueOnce({ ...land, currentResistanceRaw: 70n * RESISTANCE_Q })
    await f.execute()
    expect(f.wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'attack', args: [1n, 1n, 101n] }))
    expect(f.wallet.writeContract).toHaveBeenCalledTimes(1)
  })
  it('rejects the first invalid war atom, insufficient wallet balance and insufficient BNB gas', async () => {
    const f = fixture()
    await expect(f.execute({ ...action, amount: MAX_WAR_ATOMS })).rejects.toThrow('2^128')
    f.publicClient.readContract.mockResolvedValue(100n)
    await expect(f.execute()).rejects.toThrow('WORLD 余额不足')
    f.publicClient.readContract.mockResolvedValue(1000n)
    f.publicClient.getBalance.mockResolvedValue(1n)
    await expect(f.execute()).rejects.toThrow('BNB 余额不足')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })
  it('treats wallet rejection and a simulated revert as no Burn success', async () => {
    const f = fixture()
    f.wallet.writeContract.mockRejectedValue(new Error('User rejected request 4001'))
    await expect(f.execute()).rejects.toThrow('4001')
    expect(worldErrorMessage(new Error('User rejected request 4001'))).toContain('未提交')
    expect(f.stage.mock.calls.some(call => call[0] === 'success')).toBe(false)
    f.publicClient.simulateContract.mockRejectedValue(new Error('execution reverted'))
    await expect(f.execute()).rejects.toThrow('execution reverted')
    expect(f.publicClient.waitForTransactionReceipt).not.toHaveBeenCalled()
  })
  it.each(['resistanceRaw', 'lastResistanceUpdate', 'epoch'] as const)('rejects changed LAND %s even before simulation', async field => {
    const f = fixture()
    f.reader.readLand.mockResolvedValue({ ...land, [field]: land[field] + 1n })
    await expect(f.execute()).rejects.toThrow('LAND 状态已经被其他玩家改变')
    expect(f.publicClient.simulateContract).not.toHaveBeenCalled()
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })

  it('catches same-epoch LAND wall changed during simulation', async () => {
    const f = fixture()
    f.reader.readLand.mockResolvedValueOnce(land).mockResolvedValueOnce({ ...land, resistanceRaw: land.resistanceRaw + 1n })
    await expect(f.execute()).rejects.toThrow('LAND 状态已经被其他玩家改变')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })

  it('catches an account switch immediately before signing', async () => {
    const f = fixture()
    f.wallet.getAddresses.mockResolvedValueOnce([account]).mockResolvedValueOnce([other])
    await expect(f.execute()).rejects.toThrow('钱包账户已改变')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })

  it.each(['wallet', 'rpc'] as const)('rejects a mismatched %s chain', async source => {
    const f = fixture()
    ;(source === 'wallet' ? f.wallet : f.publicClient).getChainId.mockResolvedValue(1)
    await expect(f.execute()).rejects.toThrow('网络不匹配')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })

  it('requires enough allowance without sending an automatic approval', async () => {
    const f = fixture()
    f.reader.readAllowance.mockResolvedValue(100n)
    await expect(f.execute()).rejects.toThrow('WORLD 授权不足')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })

  it('refuses a stale buy quote and uses exact fresh value after reconfirmation', async () => {
    const f = fixture()
    await expect(executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient,
      account, { kind: 'buy', amount: 100n, quotedCost: 41n })).rejects.toThrow('链上报价已改变')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
    await executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient,
      account, { kind: 'buy', amount: 100n, quotedCost: 42n })
    expect(f.wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: core, functionName: 'buyWorld', args: [100n, account], value: 42n,
    }))
  })

  it('approves only the requested amount and withdraws only integer wei', async () => {
    const f = fixture()
    await executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient,
      account, { kind: 'approve', amount: 101n })
    expect(f.wallet.writeContract).toHaveBeenLastCalledWith(expect.objectContaining({
      address: token, functionName: 'approve', args: [core, 101n],
    }))
    await executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient,
      account, { kind: 'withdraw' })
    expect(f.wallet.writeContract).toHaveBeenLastCalledWith(expect.objectContaining({
      functionName: 'withdrawRewards', args: [account, 3n],
    }))
  })

  it('buffers gas for a later checkpoint branch without increasing the exact buy payment', async () => {
    const f = fixture()
    await executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient,
      account, { kind: 'buy', amount: 100n, quotedCost: 42n })
    expect(f.publicClient.estimateContractGas).toHaveBeenCalledWith(expect.objectContaining({
      address: core, functionName: 'buyWorld', args: [100n, account], value: 42n, account,
    }))
    expect(f.wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      gas: 235_214n, value: 42n, args: [100n, account],
    }))
  })

  it('does not report a reverted receipt as success', async () => {
    const f = fixture()
    f.publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted', transactionHash: hash })
    await expect(f.execute()).rejects.toThrow('执行失败')
    expect(f.stage.mock.calls.some(call => call[0] === 'success')).toBe(false)
  })

  it.each(['cancelled', 'replaced'] as const)('does not report a %s replacement as the requested action success', async reason => {
    const f = fixture()
    f.publicClient.waitForTransactionReceipt.mockImplementation(async options => {
      options.onReplaced({ reason, transactionReceipt: { transactionHash: replacementHash } })
      return { status: 'success', transactionHash: replacementHash }
    })
    await expect(f.execute()).rejects.toThrow(reason === 'cancelled' ? '交易已在钱包中取消' : '交易已被其他交易替换')
    expect(f.stage).toHaveBeenCalledWith('pending', replacementHash)
    expect(f.stage.mock.calls.some(call => call[0] === 'success')).toBe(false)
  })

  it('accepts a repriced transaction and reports its actual receipt hash', async () => {
    const f = fixture()
    f.publicClient.waitForTransactionReceipt.mockImplementation(async options => {
      options.onReplaced({ reason: 'repriced', transactionReceipt: { transactionHash: replacementHash } })
      return { status: 'success', transactionHash: replacementHash }
    })
    await f.execute()
    expect(f.stage).toHaveBeenLastCalledWith('success', replacementHash)
  })
})

describe('configuration and actionable errors', () => {
  it('isolates every V2 query identity dimension including the account and epoch', () => {
    const addresses = { deployment, core, token, profile }
    const key = worldQueryKey(31359, addresses, account, 1, 1n)
    expect(key).toContain('burn-resistance:v2')
    const keys = [worldQueryKey(56, addresses, account, 1, 1n), worldQueryKey(31359, { ...addresses, core: other }, account, 1, 1n),
      worldQueryKey(31359, { ...addresses, token: other }, account, 1, 1n), worldQueryKey(31359, { ...addresses, profile: other }, account, 1, 1n),
      worldQueryKey(31359, { ...addresses, deployment: other }, account, 1, 1n), worldQueryKey(31359, addresses, other, 1, 1n),
      worldQueryKey(31359, addresses, account, 2, 1n), worldQueryKey(31359, addresses, account, 1, 2n)]
    expect(keys.every(changed => changed !== key)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('keeps chain configuration separate and parses exact bigint blocks', () => {
    expect(loadConfig({ VITE_CHAIN_ID: '97' }).nativeSymbol).toBe('tBNB')
    expect(loadConfig({ VITE_CHAIN_ID: '97', VITE_NATIVE_SYMBOL: ' tBNB ' }).nativeSymbol).toBe('tBNB')
    const config = loadConfig({ VITE_CHAIN_ID: '31338', VITE_NATIVE_SYMBOL: 'TEST', VITE_DEPLOYMENT_BLOCK: '9007199254740993' })
    expect(config.chainId).toBe(31338)
    expect(config.nativeSymbol).toBe('TEST')
    expect(config.deploymentBlock).toBe(9007199254740993n)
    expect(() => loadConfig({ VITE_CHAIN_ID: '-1' })).toThrow()
    expect(() => loadConfig({ VITE_CORE_ADDRESS: 'invalid' })).toThrow()
    expect(() => loadConfig({ VITE_RECENT_BLOCK_WINDOW: '0' })).toThrow()
  })

  it('explains stale epoch as a state change rather than a broken contract', () => {
    expect(worldErrorMessage(new Error('execution reverted: StaleEpoch()')))
      .toBe('LAND 状态已经被其他玩家改变，请刷新后重新确认。')
  })
  it('defaults to isolated local BSC V2 without inventing any deployment address', async () => {
    const config = loadConfig()
    expect(config.chainId).toBe(31359)
    expect(config.nativeSymbol).toBe('BNB')
    expect(config.deploymentAddress).toBeUndefined()
    const reader = createWorldReader(config)
    const rpc = vi.spyOn(reader.publicClient, 'getChainId')
    await expect(reader.readSnapshot()).rejects.toThrow('未配置部署')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('independent free Profile transactions', () => {
  const profileAction = { kind: 'profile' as const, id: 1, expectedEpoch: 1n, name: '天才明' }
  it('reads legacy fields afresh and ignores any extra fields supplied by old UI caches', async () => {
    const f = fixture()
    f.reader.readProfileFieldsForName.mockResolvedValue({ logoURI: 'ipfs://unchanged/头像', website: 'legacy-site' })
    await executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account,
      { ...profileAction, logoURI: '', website: '' } as typeof profileAction)
    expect(f.reader.readProfileFieldsForName).toHaveBeenCalledTimes(2)
    expect(f.wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({ args: [1n, 1n, '天才明', 'ipfs://unchanged/头像', 'legacy-site'] }))
  })
  it('never submits a name when legacy fields cannot be verified', async () => {
    const f = fixture()
    f.reader.readProfileFieldsForName.mockRejectedValue(new Error('Preservation unavailable'))
    await expect(executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account, profileAction)).rejects.toThrow('Preservation unavailable')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })
  it('blocks a same-epoch metadata change during simulation rather than overwriting it', async () => {
    const f = fixture()
    f.reader.readProfileFieldsForName.mockResolvedValueOnce({ logoURI: 'old', website: 'old' }).mockResolvedValueOnce({ logoURI: 'new', website: 'new' })
    await expect(executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account, profileAction)).rejects.toThrow(/确认|changed/i)
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })
  it('writes Profile with no BNB payment and no token approval', async () => {
    const f = fixture()
    await executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account, profileAction)
    expect(f.wallet.writeContract).toHaveBeenCalledTimes(1)
    expect(f.wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: profile, functionName: 'setProfile', args: [1n, 1n, '天才明', '', ''],
    }))
    expect(f.wallet.writeContract.mock.calls[0][0]).not.toHaveProperty('value')
    expect(f.reader.readAllowance).not.toHaveBeenCalled()
  })
  it('allows clearing only the name without pretending the Profile is invalid', async () => {
    const f = fixture()
    await executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account,
      { ...profileAction, name: '' })
    expect(f.wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({ args: [1n, 1n, '', '', ''] }))
  })
  it('rejects non-controller and stale epoch before prompting the wallet', async () => {
    const f = fixture()
    f.reader.readLand.mockResolvedValue({ ...land, controller: other })
    await expect(executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account, profileAction)).rejects.toThrow('Controller')
    f.reader.readLand.mockResolvedValue({ ...land, epoch: 2n })
    await expect(executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account, profileAction)).rejects.toThrow('状态已经')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })
  it('rechecks Profile controller and epoch after simulation', async () => {
    const f = fixture()
    f.reader.readLand.mockResolvedValueOnce(land).mockResolvedValueOnce({ ...land, controller: other })
    await expect(executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account, profileAction)).rejects.toThrow('状态已经')
    expect(f.wallet.writeContract).not.toHaveBeenCalled()
  })
  it('rejects excess UTF-8 bytes and isolates an unavailable Profile from Core actions', async () => {
    const f = fixture()
    await expect(executeWorldAction(f.reader as unknown as WorldReader, f.wallet as unknown as WalletClient, account,
      { ...profileAction, name: '天'.repeat(22) })).rejects.toThrow('UTF-8')
    f.reader.readProfileLimits.mockRejectedValue(new Error('Profile unavailable'))
    await f.execute()
    expect(f.wallet.writeContract).toHaveBeenCalledTimes(1)
    expect(f.wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'attack' }))
  })
  it('blocks simultaneous submissions on one reader and releases the guard on failure', async () => {
    const f = fixture()
    let resume!: () => void
    f.reader.validate.mockImplementationOnce(() => new Promise(resolve => { resume = () => resolve({ core, token, profile }) }))
    const first = f.execute()
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'))
    await expect(f.execute()).rejects.toThrow('上一笔操作尚未完成')
    resume(); await first
    await f.execute()
    expect(f.wallet.writeContract).toHaveBeenCalledTimes(2)
  })
})

describe('block-pinned BSC reads and metadata isolation', () => {
  function readingFixture() {
    const reader = createWorldReader(loadConfig({ VITE_CHAIN_ID: '31337', VITE_DEPLOYMENT_ADDRESS: deployment, VITE_CORE_ADDRESS: core,
      VITE_TOKEN_ADDRESS: token, VITE_PROFILE_ADDRESS: profile }))
    const client = reader.publicClient
    vi.spyOn(client, 'getChainId').mockResolvedValue(31337)
    vi.spyOn(client, 'getBlock').mockResolvedValue({ number: 73n, timestamp: 1000n, hash } as never)
    vi.spyOn(client, 'getBytecode').mockResolvedValue('0x6000')
    vi.spyOn(client, 'multicall').mockRejectedValue(new Error('Multicall intentionally unavailable'))
    vi.spyOn(client, 'getBalance').mockImplementation(async request => request.address === account ? 700n : 100n)
    const read = vi.spyOn(client, 'readContract').mockImplementation(async request => {
      const args = request.args as readonly unknown[] | undefined
      switch (request.functionName) {
        case 'token': return token
        case 'core': return core
        case 'profile': return profile
        case 'N': return 50n
        case 'W': return W
        case 'B': return B
        case 'T': return 5184000n
        case 'TOKEN_UNIT': return 10n ** 18n
        case 'WORLD_PRICE': return 10n ** 12n
        case 'decimals': return 18
        case 'checkpoint': return [100n * B, 0n]
        case 'accountedBNB': return 100n
        case 'RESISTANCE_HALF_LIFE': return RESISTANCE_HALF_LIFE
        case 'MAX_WAR_ATOMS': return MAX_WAR_ATOMS
        case 'RESISTANCE_LIMIT': return RESISTANCE_LIMIT
        case 'currentResistanceRaw': return 0n
        case 'minimumAttackAtoms': return 1n
        case 'totalSupply': return 99n
        case 'balanceOf': return args?.[0] === account ? 49n : 50n
        case 'allowance': return 9n
        case 'claimable': return 11n
        case 'weightOf': return weightOf(Number(args?.[0]))
        case 'lands': return [zeroAddress, 0n, 0n, 0n, 0n]
        case 'getCurrentProfile': return [false, zeroAddress, 0n, '', '', '']
        default: throw new Error(`Unexpected function ${request.functionName}`)
      }
    })
    return { reader, client, read }
  }

  it('rejects V1 parameters, wrong configured addresses and altered factory create order', async () => {
    const f = readingFixture()
    const original = f.read.getMockImplementation()!
    f.read.mockImplementation(async request => request.functionName === 'RESISTANCE_HALF_LIFE' ? 5184000n : original(request))
    await expect(f.reader.validate()).rejects.toThrow('不能连接旧实例')
    f.read.mockImplementation(original)
    f.reader.config.profileAddress = other
    await expect(f.reader.validate()).rejects.toThrow('PROFILE_ADDRESS')
    f.reader.config.profileAddress = undefined
    f.read.mockImplementation(async request => request.address === deployment && request.functionName === 'profile' ? other : original(request))
    await expect(f.reader.validate()).rejects.toThrow('创建顺序')
  })

  it('rejects inconsistent live resistance and RPC faults without replacing them with zero', async () => {
    const f = readingFixture()
    const original = f.read.getMockImplementation()!
    f.read.mockImplementation(async request => request.functionName === 'currentResistanceRaw' ? 1n : original(request))
    await expect(f.reader.readSnapshot()).rejects.toThrow('快照')
    f.read.mockImplementation(async request => {
      if (request.functionName === 'lands') throw new Error('RPC unavailable')
      return original(request)
    })
    await expect(f.reader.readSnapshot()).rejects.toThrow('RPC unavailable')
    expect(worldErrorMessage(new Error('HTTP request failed'))).toContain('无法连接 RPC')
  })

  it('pins all 50 LAND, parameters, balances and claims to the same block and never requests metadata', async () => {
    const f = readingFixture()
    const snapshot = await f.reader.readSnapshot(account)
    expect(snapshot.lands).toHaveLength(50)
    expect(snapshot.lands.reduce((sum, item) => sum + item.weight, 0n)).toBe(65n)
    expect(snapshot.parameters).toEqual({ N: 50, W, B, T: 5184000n, worldPrice: 10n ** 12n, tokenUnit: 10n ** 18n, resistanceHalfLife: RESISTANCE_HALF_LIFE, maxWarAtoms: MAX_WAR_ATOMS, resistanceLimit: RESISTANCE_LIMIT })
    expect(snapshot.wallet).toMatchObject({ balance: 49n, allowance: 9n, claimable: 11n, nativeBalance: 700n })
    expect(snapshot.accountedBNB).toBe(100n)
    expect(snapshot.blockHash).toBe(hash)
    expect(f.client.getBlock).toHaveBeenLastCalledWith({ blockNumber: 73n })
    for (const [request] of f.read.mock.calls) expect(request.blockNumber).toBe(73n)
    for (const [request] of vi.mocked(f.client.getBalance).mock.calls) expect(request.blockNumber).toBe(73n)
    expect(f.read.mock.calls.some(([request]) => request.functionName === 'getCurrentProfile')).toBe(false)
  })

  it('rejects a same-height and same-timestamp reorganization during the snapshot read', async () => {
    const f = readingFixture()
    vi.mocked(f.client.getBlock)
      .mockResolvedValueOnce({ number: 73n, timestamp: 1000n, hash } as never)
      .mockResolvedValueOnce({ number: 73n, timestamp: 1000n, hash: replacementHash } as never)
    await expect(f.reader.readSnapshot(account)).rejects.toThrow('读取期间发生链重组')
    expect(f.client.getBlock).toHaveBeenNthCalledWith(1, { blockTag: 'latest' })
    expect(f.client.getBlock).toHaveBeenNthCalledWith(2, { blockNumber: 73n })
  })

  it.each(['initial', 'confirmation'] as const)('rejects a missing %s block hash instead of creating unverifiable financial history', async missing => {
    const f = readingFixture()
    vi.mocked(f.client.getBlock)
      .mockResolvedValueOnce({ number: 73n, timestamp: 1000n, hash: missing === 'initial' ? null : hash } as never)
      .mockResolvedValueOnce({ number: 73n, timestamp: 1000n, hash: missing === 'confirmation' ? null : hash } as never)
    await expect(f.reader.readSnapshot(account)).rejects.toThrow('读取期间发生链重组')
  })

  it('caches verified constants and uses event-proven targeted state reads', async () => {
    const f = readingFixture()
    const previous = await f.reader.readSnapshot(account)
    const initialConstants = f.read.mock.calls.filter(([r]) => r.functionName === 'WORLD_PRICE').length
    f.read.mockClear()
    const next = await f.reader.readSnapshot(account, previous, [1])
    expect(next).toEqual(previous)
    expect(initialConstants).toBe(1)
    expect(f.read.mock.calls.filter(([r]) => r.functionName === 'WORLD_PRICE')).toHaveLength(0)
    expect(f.read.mock.calls.filter(([r]) => r.functionName === 'lands')).toHaveLength(1)
  })
  it('refreshes other changed lands from the intervening event range', async () => {
    const f = readingFixture()
    const previous = await f.reader.readSnapshot(account)
    vi.mocked(f.client.getBlock).mockImplementation(async ({ blockNumber }: any) => ({ number: blockNumber ?? 74n, timestamp: 1001n, hash }) as never)
    const { encodeEventTopics, encodeAbiParameters } = await import('viem')
    const logs = vi.spyOn(f.client, 'getLogs').mockResolvedValue([{
      address: core, removed: false,
      topics: encodeEventTopics({ abi: (await import('../src/abi')).coreAbi, eventName: 'Earned', args: { id: 2n, beneficiary: account } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [0n, 0n]),
    }] as never)
    f.read.mockClear()
    await f.reader.readSnapshot(account, previous, [1])
    expect(logs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 74n, toBlock: 74n }))
    expect(f.read.mock.calls.filter(([r]) => r.functionName === 'lands').map(([r]) => Number(r.args?.[0]))).toEqual([1, 2])
  })

  it('keeps Core readable while one Profile record fails; never revives a mismatched epoch', async () => {
    const f = readingFixture()
    const snapshot = await f.reader.readSnapshot(account)
    const original = f.read.getMockImplementation()!
    f.read.mockImplementation(async request => {
      if (request.functionName !== 'getCurrentProfile') return original(request)
      const id = Number((request.args as unknown[])[0])
      if (id === 1) throw new Error('RPC metadata error')
      if (id === 2) return [true, zeroAddress, 10n, 'Old epoch', '', '']
      return [false, zeroAddress, 0n, 'Must not leak invalid metadata', '', '']
    })
    const profiles = await f.reader.readProfiles(snapshot)
    expect(Object.keys(profiles)).toHaveLength(50)
    expect(profiles[1]).toMatchObject({ status: 'unavailable', valid: false, name: '' })
    expect(profiles[2]).toMatchObject({ status: 'unavailable', valid: false, name: '' })
    expect(profiles[3]).toMatchObject({ status: 'available', valid: false, name: '' })
    await expect(f.reader.readSnapshot(account)).resolves.toHaveProperty('accountedBNB', 100n)
    for (const [request] of f.read.mock.calls) expect(request.blockNumber).toBe(73n)
  })

  it('treats all-empty current Profile as valid and rejects wrong Profile binding as identity failure', async () => {
    const f = readingFixture()
    const snapshot = await f.reader.readSnapshot(account)
    const owned: WorldSnapshot = { ...snapshot, lands: [{ ...snapshot.lands[0], controller: account, epoch: 1n }] }
    const original = f.read.getMockImplementation()!
    f.read.mockImplementation(async request => request.functionName === 'getCurrentProfile'
      ? [true, account, 1n, '', '', ''] : original(request))
    expect((await f.reader.readProfiles(owned))[1]).toMatchObject({ status: 'available', valid: true, name: '' })
    f.read.mockImplementation(async request => request.address === profile && request.functionName === 'core' ? other : original(request))
    expect((await f.reader.readProfiles(owned))[1]).toMatchObject({ status: 'unavailable', valid: false })
    await expect(f.reader.readSnapshot()).rejects.toThrow('Profile 与当前 V2 Core 绑定不一致')
  })

})
