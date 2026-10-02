import { t, knownMessage, localizeMessage } from './i18n'
import {
  createPublicClient, defineChain, http, getAddress, zeroAddress, formatUnits, getContractAddress,
  BaseError, ContractFunctionRevertedError, decodeEventLog,
  type Abi, type Address, type Hex, type WalletClient, type TransactionReceipt, type Transport, type EIP1193Provider,
} from 'viem'
import { coreAbi, tokenAbi, deploymentAbi, profileAbi } from './abi'
import { B, W, N, MAX_UINT256, MAX_WAR_ATOMS, RESISTANCE_HALF_LIFE, RESISTANCE_LIMIT,
  validateResistance, validateWarAmount, minimumAttackAtoms, defendPreview, VERSION_NAMESPACE, pendingNumerator, weightOf,
  treasuryParts, type WorldSnapshot, type Land, type LandProfile,
  type ProfileLimits, type WorldParameters } from './domain'
import { assertTransactionsEnabled, requireDeploymentBlock, type WorldConfig } from './config'
import { readProfileFieldsForName, validateLandName } from './profileNameWrite'
import { walletReadTransport, type WalletReadEvent } from './readTransport'

type Addresses = { core: Address; token: Address; profile?: Address; deployment?: Address }
type ReadCall = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }
const CANONICAL_MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11' as Address
const equalAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const hasCode = (code: Hex | undefined) => code !== undefined && code !== '0x'

function assertLandId(id: number) {
  if (!Number.isInteger(id) || id < 1 || id > N) throw new Error(t('copy150'))
}
function validateLand(land: Land, timestamp: bigint) {
  validateResistance(land.resistanceRaw)
  validateResistance(land.currentResistanceRaw)
  if (land.currentResistanceRaw > land.resistanceRaw || land.lastResistanceUpdate > timestamp
    || land.minimumAttackAtoms !== minimumAttackAtoms(land.currentResistanceRaw)
    || land.weight !== weightOf(land.id)) throw new Error(t('copy151'))
}
/** Any consumer cache must include the complete instance identity, wallet and epoch. */
/** Any consumer cache must include the complete instance identity, wallet and epoch. */
export function worldQueryKey(chainId: number, addresses: Addresses, account?: Address, landId?: number, epoch?: bigint): string {
  return [VERSION_NAMESPACE, chainId, addresses.deployment, addresses.core, addresses.token, addresses.profile,
    account ?? 'readonly', landId ?? 'all', epoch ?? 'all'].map(value => String(value ?? '').toLowerCase()).join(':')
}

export interface ReaderOptions {
  transport?: Transport
  fetchFn?: typeof fetch
  observeWalletRead?: (event: WalletReadEvent) => void
  walletProvider?: () => EIP1193Provider | undefined
}
export function createWorldReader(config: WorldConfig, options: ReaderOptions = {}) {
  const chain = defineChain({
    id: config.chainId, name: `WORLD · ${config.chainId}`,
    nativeCurrency: { name: config.nativeSymbol, symbol: config.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  })
  const publicClient = createPublicClient({
    chain,
    // Same-origin proxy supports JSON-RPC batches, including historical logs.
    transport: options.transport ?? http(config.rpcUrl, { fetchFn: options.fetchFn, batch: { batchSize: 50, wait: 10 }, retryCount: 1, timeout: 20_000 }),
    cacheTime: 0,
  })
  const liveClient = options.walletProvider ? createPublicClient({ chain, cacheTime: 0,
    transport: walletReadTransport(config.chainId, options.walletProvider, request => publicClient.request(request as never), 2000, options.observeWalletRead),
  }) : publicClient
  let liveMulticall: Address | null | undefined
  let multicallCache: { block: bigint; address?: Address } | undefined
  let deploylessSupported = true

  async function assertRpcChain() {
    if (await publicClient.getChainId() !== config.chainId) {
      throw new Error(t('copy152', { v0: config.chainId }))
    }
  }

  async function many(calls: ReadCall[], blockNumber: bigint, client = publicClient): Promise<unknown[]> {
    if (client !== publicClient) {
      if (!calls.length) return []
      if (liveMulticall === undefined) {
        const candidate = config.multicallAddress ?? CANONICAL_MULTICALL
        liveMulticall = hasCode(await client.getBytecode({ address: candidate, blockNumber })) ? candidate : null
      }
      try { return [...await client.multicall({ contracts: calls, blockNumber, allowFailure: false,
        batchSize: 16_384, ...(liveMulticall ? { multicallAddress: liveMulticall } : { deployless: true }) })] }
      catch { return Promise.all(calls.map(call => client.readContract({ ...call, blockNumber }))) }
    }
    if (calls.length === 0) return []
    if (!multicallCache) {
      const candidate = config.multicallAddress ?? CANONICAL_MULTICALL
      const code = await publicClient.getBytecode({ address: candidate, blockNumber })
      multicallCache = { block: blockNumber, address: hasCode(code) ? candidate : undefined }
    }
    if (multicallCache.address || deploylessSupported) {
      try {
        return [...await publicClient.multicall({
          contracts: calls, blockNumber, allowFailure: false, batchSize: 16_384,
          ...(multicallCache.address
            ? { multicallAddress: multicallCache.address }
            : { deployless: true }),
        })]
      } catch {
        // Some RPCs reject contract-creation eth_call. Reads still remain pinned
        // to the same block, in bounded concurrent HTTP JSON-RPC batches.
        if (!multicallCache.address) deploylessSupported = false
      }
    }
    const result: unknown[] = []
    for (let offset = 0; offset < calls.length; offset += 24) {
      result.push(...await Promise.all(calls.slice(offset, offset + 24).map(call =>
        publicClient.readContract({ ...call, blockNumber }))))
    }
    return result
  }

  function assertConfigured() {
    if (!config.deploymentAddress) {
      throw new Error(t('copy153'))
    }
  }

  async function validateAt(blockNumber: bigint): Promise<{ addresses: Addresses; parameters: WorldParameters }> {
    assertConfigured()
    await assertRpcChain()
    let core = config.coreAddress
    let token = config.tokenAddress
    let profile = config.profileAddress
    if (config.deploymentAddress) {
      if (!hasCode(await publicClient.getBytecode({ address: config.deploymentAddress, blockNumber }))) {
        throw new Error(t('copy154'))
      }
      const pair = await many([
        { address: config.deploymentAddress, abi: deploymentAbi, functionName: 'core' },
        { address: config.deploymentAddress, abi: deploymentAbi, functionName: 'token' },
        { address: config.deploymentAddress, abi: deploymentAbi, functionName: 'profile' },
      ], blockNumber) as [Address, Address, Address]
      if (core && !equalAddress(core, pair[0])) throw new Error(t('copy155'))
      if (token && !equalAddress(token, pair[1])) throw new Error(t('copy156'))
      if (profile && !equalAddress(profile, pair[2])) throw new Error(t('copy157'))
      ;[core, token, profile] = pair
      for (const [address, nonce] of [[token, 1n], [core, 2n], [profile, 3n]] as const) {
        if (!equalAddress(address, getContractAddress({ from: config.deploymentAddress, nonce }))) {
          throw new Error(t('copy158'))
        }
      }
    }
    if (!core || !token || equalAddress(core, zeroAddress) || equalAddress(token, zeroAddress)) {
      throw new Error(t('copy159'))
    }
    const coreAddress = getAddress(core)
    const tokenAddress = getAddress(token)
    const [coreCode, tokenCode, profileCode] = await Promise.all([
      publicClient.getBytecode({ address: coreAddress, blockNumber }),
      publicClient.getBytecode({ address: tokenAddress, blockNumber }),
      profile ? publicClient.getBytecode({ address: profile, blockNumber }) : Promise.resolve(undefined),
    ])
    if (!hasCode(coreCode) || !hasCode(tokenCode) || !hasCode(profileCode)) throw new Error(t('copy160'))
    const values = await many([
      { address: coreAddress, abi: coreAbi, functionName: 'token' },
      { address: tokenAddress, abi: tokenAbi, functionName: 'core' },
      ...['N', 'W', 'B', 'T', 'TOKEN_UNIT', 'WORLD_PRICE'].map(functionName => ({ address: coreAddress, abi: coreAbi, functionName })),
      { address: tokenAddress, abi: tokenAbi, functionName: 'decimals' },
      ...['RESISTANCE_HALF_LIFE', 'MAX_WAR_ATOMS', 'RESISTANCE_LIMIT'].map(functionName => ({ address: coreAddress, abi: coreAbi, functionName })),
      { address: profile!, abi: profileAbi, functionName: 'core' },
    ], blockNumber)
    if (!equalAddress(values[0] as string, tokenAddress) || !equalAddress(values[1] as string, coreAddress)) {
      throw new Error(t('copy161'))
    }
    if (!equalAddress(values[12] as string, coreAddress)) throw new Error(t('copy162'))
    if (values[2] !== BigInt(N) || values[3] !== W || values[4] !== B || values[5] !== 5_184_000n
      || values[6] !== 10n ** 18n || values[7] !== 10n ** 12n || Number(values[8]) !== 18
      || values[9] !== RESISTANCE_HALF_LIFE || values[10] !== MAX_WAR_ATOMS || values[11] !== RESISTANCE_LIMIT) {
      throw new Error(t('copy163'))
    }
    return {
      addresses: { core: coreAddress, token: tokenAddress, deployment: config.deploymentAddress,
        ...(profile && !equalAddress(profile, zeroAddress) ? { profile: getAddress(profile) } : {}) },
      parameters: { N: Number(values[2]), W: values[3] as bigint, B: values[4] as bigint,
        T: values[5] as bigint, tokenUnit: values[6] as bigint, worldPrice: values[7] as bigint,
        resistanceHalfLife: values[9] as bigint, maxWarAtoms: values[10] as bigint, resistanceLimit: values[11] as bigint },
    }
  }

  let validation: { block: bigint; identity: string; value: Promise<{ addresses: Addresses; parameters: WorldParameters }> } | undefined
  const identity = () => [config.chainId, config.rpcUrl, config.deploymentAddress, config.coreAddress, config.tokenAddress, config.profileAddress].join(':')
  function validatedAt(block: bigint) {
    const key = identity()
    if (!validation || validation.identity !== key || block < validation.block) {
      const entry = { block, identity: key, value: validateAt(block) }
      validation = entry
      void entry.value.catch(() => { if (validation === entry) validation = undefined })
    }
    return validation!.value
  }

  async function context(live = false) {
    assertConfigured()
    const block = await (live ? liveClient : publicClient).getBlock({ blockTag: 'latest' })
    if (block.number === null) throw new Error(t('copy164'))
    return { block, ...await validatedAt(block.number) }
  }

  async function validate() { return (await context(true)).addresses }
  async function readParameters() { return (await context(true)).parameters }

  const profileCache = new WeakMap<WorldSnapshot, Record<number, LandProfile>>()
  const deltaSources = new WeakMap<WorldSnapshot, { previous: WorldSnapshot; changed: Set<number> }>()
  async function readSnapshot(account?: Address, previous?: WorldSnapshot, affectedIds: number[] = []): Promise<WorldSnapshot> {
    const { block, addresses, parameters } = await context()
    const blockNumber = block.number!
    const { core, token } = addresses
    let reuse = previous && previous.addresses.core === core && previous.blockNumber <= blockNumber
      && blockNumber - previous.blockNumber <= 1000n ? previous : undefined
    const changed = new Set(affectedIds)
    if (reuse) {
      const anchor = await publicClient.getBlock({ blockNumber: reuse.blockNumber })
      if (!reuse.blockHash || anchor.hash !== reuse.blockHash) { reuse = undefined; validation = undefined }
      else if (blockNumber > reuse.blockNumber) {
        const logs = await publicClient.getLogs({ address: [core, ...(addresses.profile ? [addresses.profile] : [])],
          fromBlock: reuse.blockNumber + 1n, toBlock: blockNumber })
        for (const log of logs) {
          if (log.removed) throw new Error(t('copy165'))
          const decoded = decodeEventLog({ abi: equalAddress(log.address, core) ? coreAbi : profileAbi, data: log.data, topics: log.topics })
          const args = decoded.args as unknown as Record<string, unknown>
          const id = args.id ?? args.landId
          if (typeof id === 'bigint') { assertLandId(Number(id)); changed.add(Number(id)) }
        }
      }
    }
    const calls: ReadCall[] = [
      { address: core, abi: coreAbi, functionName: 'checkpoint' },
      { address: core, abi: coreAbi, functionName: 'accountedBNB' },
      { address: token, abi: tokenAbi, functionName: 'totalSupply' },
      { address: token, abi: tokenAbi, functionName: 'balanceOf', args: [core] },
    ]
    const offsets = new Map<number, number>()
    const decayOffsets = new Map<number, number>()
    for (let id = 1; id <= parameters.N; id++) {
      if (!reuse || changed.has(id)) {
        offsets.set(id, calls.length)
        calls.push({ address: core, abi: coreAbi, functionName: 'lands', args: [BigInt(id)] })
        calls.push({ address: core, abi: coreAbi, functionName: 'weightOf', args: [BigInt(id)] })
        calls.push({ address: core, abi: coreAbi, functionName: 'currentResistanceRaw', args: [BigInt(id)] })
        calls.push({ address: core, abi: coreAbi, functionName: 'minimumAttackAtoms', args: [BigInt(id)] })
      } else if (reuse.lands[id - 1].resistanceRaw !== 0n) {
        // Exact on-chain decay; no approximate financial state.
        decayOffsets.set(id, calls.length)
        calls.push({ address: core, abi: coreAbi, functionName: 'currentResistanceRaw', args: [BigInt(id)] })
      }
    }
    const walletOffset = calls.length
    if (account) calls.push(
      { address: token, abi: tokenAbi, functionName: 'balanceOf', args: [account] },
      { address: token, abi: tokenAbi, functionName: 'allowance', args: [account, core] },
      { address: core, abi: coreAbi, functionName: 'claimable', args: [account] },
    )
    const [data, coreNativeBalance, walletNativeBalance] = await Promise.all([
      many(calls, blockNumber), publicClient.getBalance({ address: core, blockNumber }),
      account ? publicClient.getBalance({ address: account, blockNumber }) : Promise.resolve(0n),
    ])
    const [U, J] = data[0] as readonly [bigint, bigint]
    const lands: Land[] = []
    for (let id = 1; id <= parameters.N; id++) {
      const offset = offsets.get(id)
      if (offset === undefined && reuse) {
        const raw = decayOffsets.has(id) ? data[decayOffsets.get(id)!] as bigint : 0n
        const land = { ...reuse.lands[id - 1], currentResistanceRaw: raw, minimumAttackAtoms: minimumAttackAtoms(raw) }
        validateLand(land, block.timestamp); pendingNumerator(land, J); lands.push(land); continue
      }
      if (offset === undefined) throw new Error('LAND snapshot incomplete')
      const [controller, resistanceRaw, lastResistanceUpdate, epoch, j] = data[offset] as [Address, bigint, bigint, bigint, bigint]
      const land: Land = { id, controller, resistanceRaw, lastResistanceUpdate, epoch, j, weight: data[offset + 1] as bigint,
        currentResistanceRaw: data[offset + 2] as bigint, minimumAttackAtoms: data[offset + 3] as bigint }
      validateLand(land, block.timestamp)
      pendingNumerator(land, J)
      if (land.weight !== weightOf(id)) throw new Error(t('copy166'))
      lands.push(land)
    }
    if (lands.reduce((sum, land) => sum + land.weight, 0n) !== parameters.W) throw new Error(t('copy167'))
    treasuryParts(U, data[1] as bigint, parameters.B)
    const result: WorldSnapshot = {
      blockNumber, blockHash: block.hash ?? undefined, timestamp: block.timestamp, U, J,
      accountedBNB: data[1] as bigint, totalSupply: data[2] as bigint,
      coreWorldBalance: data[3] as bigint, coreNativeBalance, addresses, lands, parameters,
    }
    if (account) result.wallet = {
      address: getAddress(account), balance: data[walletOffset] as bigint,
      allowance: data[walletOffset + 1] as bigint, claimable: data[walletOffset + 2] as bigint,
      nativeBalance: walletNativeBalance,
    }
    const canonical = await publicClient.getBlock({ blockNumber })
    if (!block.hash || canonical.hash !== block.hash) { validation = undefined; throw new Error(t('copy168')) }
    if (reuse) deltaSources.set(result, { previous: reuse, changed })
    return result
  }

  async function quoteBuy(q: bigint): Promise<bigint> {
    if (q <= 0n || q > MAX_UINT256) throw new Error(t('copy169'))
    const { block, addresses } = await context(true)
    return liveClient.readContract({ address: addresses.core, abi: coreAbi, functionName: 'quoteBuy', args: [q], blockNumber: block.number! }) as Promise<bigint>
  }

  async function readLand(id: number): Promise<Land> {
    assertLandId(id)
    const { block, addresses } = await context(true)
    const [raw, weight, currentResistanceRaw, minimum] = await many([
      { address: addresses.core, abi: coreAbi, functionName: 'lands', args: [BigInt(id)] },
      { address: addresses.core, abi: coreAbi, functionName: 'weightOf', args: [BigInt(id)] },
      { address: addresses.core, abi: coreAbi, functionName: 'currentResistanceRaw', args: [BigInt(id)] },
      { address: addresses.core, abi: coreAbi, functionName: 'minimumAttackAtoms', args: [BigInt(id)] },
    ], block.number!, liveClient)
    const [controller, resistanceRaw, lastResistanceUpdate, epoch, j] = raw as [Address, bigint, bigint, bigint, bigint]
    const land = { id, controller, resistanceRaw, lastResistanceUpdate, epoch, j, weight: weight as bigint,
      currentResistanceRaw: currentResistanceRaw as bigint, minimumAttackAtoms: minimum as bigint }
    validateLand(land, block.timestamp)
    return land
  }

  async function readAllowance(account: Address): Promise<bigint> {
    const { block, addresses } = await context(true)
    return liveClient.readContract({ address: addresses.token, abi: tokenAbi,
      functionName: 'allowance', args: [account, addresses.core], blockNumber: block.number! }) as Promise<bigint>
  }

  async function readClaimable(account: Address): Promise<bigint> {
    const { block, addresses } = await context(true)
    return liveClient.readContract({ address: addresses.core, abi: coreAbi,
      functionName: 'claimable', args: [account], blockNumber: block.number! }) as Promise<bigint>
  }

  const pendingProfileBindings = new Map<string, Promise<Address>>()
  function validateProfileAt(addresses: Addresses, blockNumber: bigint): Promise<Address> {
    const key = `${addresses.core}:${addresses.profile}:${blockNumber}`
    let pending = pendingProfileBindings.get(key)
    if (!pending) {
      pending = checkProfileBinding(addresses, blockNumber)
      pendingProfileBindings.set(key, pending)
      void pending.finally(() => pendingProfileBindings.delete(key)).catch(() => {})
    }
    return pending
  }
  async function checkProfileBinding(addresses: Addresses, blockNumber: bigint): Promise<Address> {
    if (!addresses.profile || !hasCode(await publicClient.getBytecode({ address: addresses.profile, blockNumber }))) {
      throw new Error(t('copy170'))
    }
    const bound = await publicClient.readContract({ address: addresses.profile, abi: profileAbi, functionName: 'core', blockNumber }) as Address
    if (!equalAddress(bound, addresses.core)) { validation = undefined; limits = undefined; throw new Error(t('copy171')) }
    return addresses.profile
  }

  async function loadProfileLimits(snapshot?: WorldSnapshot): Promise<ProfileLimits> {
    const { block, addresses } = snapshot ? { block: { number: snapshot.blockNumber }, addresses: snapshot.addresses } : await context()
    const profile = await validateProfileAt(addresses, block.number!)
    const values = await many(['MAX_NAME_BYTES', 'MAX_LOGO_URI_BYTES', 'MAX_WEBSITE_BYTES'].map(functionName =>
      ({ address: profile, abi: profileAbi, functionName })), block.number!) as bigint[]
    if (values[0] !== 64n || values[1] !== 256n || values[2] !== 256n) throw new Error(t('copy172'))
    return { name: Number(values[0]), logoURI: Number(values[1]), website: Number(values[2]) }
  }

  let limits: Promise<ProfileLimits> | undefined
  function readProfileLimits(snapshot?: WorldSnapshot): Promise<ProfileLimits> {
    if (!limits) { limits = loadProfileLimits(snapshot); void limits.catch(() => { limits = undefined }) }
    return limits
  }

  async function readProfiles(snapshot: WorldSnapshot): Promise<Record<number, LandProfile>> {
    const delta = deltaSources.get(snapshot)
    const previousProfiles = delta && profileCache.get(delta.previous)
    const result: Record<number, LandProfile> = {}
    for (const land of snapshot.lands) result[land.id] = { status: 'unavailable', valid: false,
      controller: land.controller, epoch: land.epoch, name: '', logoURI: '', website: '' }
    let profile: Address
    try {
      await assertRpcChain()
      profile = await validateProfileAt(snapshot.addresses, snapshot.blockNumber)
    } catch { return result }
    // One EVM multicall for metadata, with per-record failure isolation.
    const pending = snapshot.lands.filter(land => {
      const old = previousProfiles?.[land.id]
      if (old?.status === 'available' && !delta!.changed.has(land.id)
        && equalAddress(old.controller, land.controller) && old.epoch === land.epoch) { result[land.id] = old; return false }
      return true
    })
    const calls = pending.map(land => ({ address: profile, abi: profileAbi,
      functionName: 'getCurrentProfile', args: [BigInt(land.id)] }))
    let batch: readonly ({ status: 'success'; result: unknown } | { status: 'failure'; error: unknown })[] | undefined
    if (calls.length && (multicallCache?.address || deploylessSupported)) {
      try {
        batch = await publicClient.multicall({ contracts: calls, blockNumber: snapshot.blockNumber, allowFailure: true,
          batchSize: 16_384, ...(multicallCache?.address ? { multicallAddress: multicallCache.address } : { deployless: true }) })
      } catch { /* Provider-specific multicall failure falls back to a JSON-RPC batch. */ }
    }
    await Promise.all(pending.map(async (land, index) => {
      try {
        if (batch?.[index]?.status === 'failure') return
        const entry = batch?.[index]
        const raw = entry?.status === 'success' ? entry.result : await publicClient.readContract({ ...calls[index], blockNumber: snapshot.blockNumber })
        const [valid, controller, epoch, name, logoURI, website] = raw as [boolean, Address, bigint, string, string, string]
        if (!equalAddress(controller, land.controller) || epoch !== land.epoch) throw new Error(t('copy173'))
        result[land.id] = { status: 'available', valid, controller, epoch,
          name: valid ? name : '', logoURI: valid ? logoURI : '', website: valid ? website : '' }
      } catch { /* An individual failure retains only that land's unavailable profile. */ }
    }))
    profileCache.set(snapshot, result)
    return result
  }

  async function preserveProfileFields(land: Land) {
    const addresses = await validate()
    if (!addresses.profile) throw new Error(t('copy170'))
    return readProfileFieldsForName(liveClient, addresses.profile, land, requireDeploymentBlock(config))
  }
  return { publicClient, liveClient, config, readProfileFieldsForName: preserveProfileFields,
    adoptLimits: (value: ProfileLimits) => { if (value.name !== 64 || value.logoURI !== 256 || value.website !== 256) throw new Error(t('copy172')); limits = Promise.resolve(value) },
    adoptConstants: (value: { parameters: WorldParameters; addresses: Addresses; blockNumber: bigint }) => {
      const p = value.parameters
      if (p.N !== N || p.W !== W || p.B !== B || p.T !== 5184000n || p.tokenUnit !== 10n ** 18n
        || p.worldPrice !== 10n ** 12n || p.resistanceHalfLife !== RESISTANCE_HALF_LIFE
        || p.maxWarAtoms !== MAX_WAR_ATOMS || p.resistanceLimit !== RESISTANCE_LIMIT) throw new Error(t('copy163'))
      validation = { block: value.blockNumber, identity: identity(), value: Promise.resolve(value) }
    },
    adoptShared: (snapshot: WorldSnapshot) => { validation = { block: snapshot.blockNumber, identity: identity(),
      value: Promise.resolve({ addresses: snapshot.addresses, parameters: snapshot.parameters }) } }, publicMany: (calls: ReadCall[], block: bigint) => many(calls, block), liveMany: (calls: ReadCall[], block: bigint) => many(calls, block, liveClient), resolveAddresses: validate, validate, readParameters,
    readSnapshot, quoteBuy, readLand, readAllowance, readClaimable,
    readProfiles, readProfileLimits }
}

export type WorldReader = ReturnType<typeof createWorldReader>
export type WorldAction =
  | { kind: 'buy'; amount: bigint; quotedCost: bigint }
  | { kind: 'approve'; amount: bigint }
  | { kind: 'attack' | 'defend'; id: number; amount: bigint; expectedEpoch: bigint; expectedResistanceRaw: bigint; expectedLastResistanceUpdate: bigint }
  | { kind: 'settle'; id: number }
  | { kind: 'profile'; id: number; expectedEpoch: bigint; name: string }
  | { kind: 'withdraw' }
  | { kind: 'sync' }
export type TransactionStage = 'checking' | 'simulating' | 'confirm' | 'pending' | 'success'

const activeTransactions = new WeakSet<WorldReader>()
export async function executeWorldAction(
  reader: WorldReader, walletClient: WalletClient, account: Address, action: WorldAction,
  onStage?: (stage: TransactionStage, hash?: Hex) => void,
): Promise<TransactionReceipt> {
  assertTransactionsEnabled(reader.config)
  if (activeTransactions.has(reader)) throw new Error(t('copy185'))
  activeTransactions.add(reader)
  try { return await executeAction(reader, walletClient, account, action, onStage) }
  finally { activeTransactions.delete(reader) }
}

async function executeAction(
  reader: WorldReader, walletClient: WalletClient, account: Address, action: WorldAction,
  onStage?: (stage: TransactionStage, hash?: Hex) => void,
): Promise<TransactionReceipt> {
  const publicClient = reader.liveClient ?? reader.publicClient
  const assertWallet = async () => {
    const [addresses, walletChain, rpcChain] = await Promise.all([
      walletClient.getAddresses(), walletClient.getChainId(), publicClient.getChainId(),
    ])
    if (!addresses[0] || !equalAddress(addresses[0], account)) {
      throw new Error(t('copy186'))
    }
    if (walletChain !== reader.config.chainId || rpcChain !== reader.config.chainId) {
      throw new Error(t('copy187', { v0: reader.config.chainId }))
    }
  }
  if ('amount' in action && (action.amount <= 0n || action.amount > MAX_UINT256)) {
    throw new Error(t('copy188'))
  }
  onStage?.('checking')
  await assertWallet()
  const addresses = await reader.validate()
  let functionName: string
  let args: readonly unknown[] = []
  let preservedProfile: Awaited<ReturnType<WorldReader['readProfileFieldsForName']>> | undefined
  let value: bigint | undefined
  let contract = addresses.core
  let abi: Abi = coreAbi
  switch (action.kind) {
    case 'buy': {
      const freshQuote = await reader.quoteBuy(action.amount)
      if (freshQuote !== action.quotedCost) throw new Error(t('copy189'))
      functionName = 'buyWorld'; args = [action.amount, account]; value = freshQuote
      break
    }
    case 'approve':
      contract = addresses.token; abi = tokenAbi; functionName = 'approve'; args = [addresses.core, action.amount]
      break
    case 'attack':
    case 'defend': {
      const land = await reader.readLand(action.id)
      validateWarAmount(action.amount)
      if (land.epoch !== action.expectedEpoch || land.resistanceRaw !== action.expectedResistanceRaw
        || land.lastResistanceUpdate !== action.expectedLastResistanceUpdate) {
        throw new Error(t('copy190'))
      }
      if (action.kind === 'defend') {
        if (equalAddress(land.controller, zeroAddress)) throw new Error(t('copy191'))
        defendPreview(land, action.amount)
      }
      if (await reader.readAllowance(account) < action.amount) throw new Error(t('copy192'))
      const balance = await publicClient.readContract({ address: addresses.token, abi: tokenAbi, functionName: 'balanceOf', args: [account] }) as bigint
      if (balance < action.amount) throw new Error(t('copy193'))
      functionName = action.kind; args = [BigInt(action.id), action.expectedEpoch, action.amount]
      break
    }
    case 'settle':
      assertLandId(action.id); functionName = 'settleLand'; args = [BigInt(action.id)]
      break
    case 'withdraw': {
      const parameters = await reader.readParameters()
      const amountWei = (await reader.readClaimable(account)) / (parameters.W * parameters.B)
      if (amountWei === 0n) throw new Error(t('copy194'))
      functionName = 'withdrawRewards'; args = [account, amountWei]
      break
    }
    case 'profile': {
      assertLandId(action.id)
      const land = await reader.readLand(action.id)
      if (!equalAddress(land.controller, account) || equalAddress(land.controller, zeroAddress)) throw new Error(t('copy195'))
      if (land.epoch !== action.expectedEpoch) throw new Error(t('copy190'))
      if (!addresses.profile) throw new Error(t('copy170'))
      validateLandName(action.name, await reader.readProfileLimits())
      preservedProfile = await reader.readProfileFieldsForName(land)
      contract = addresses.profile; abi = profileAbi; functionName = 'setProfile'
      args = [BigInt(action.id), action.expectedEpoch, action.name, preservedProfile!.logoURI, preservedProfile!.website]
      // Nonpayable Profile: no BNB value and no token approval.
      break
    }
    case 'sync': functionName = 'syncSurplus'; break
  }
  onStage?.('simulating')
  const { request } = await publicClient.simulateContract({
    address: contract, abi, functionName, args, account, ...(value === undefined ? {} : { value }),
  })
  // A later block can take a more expensive checkpoint branch than the estimate
  // (new t0/J0 storage values or nonzero decay remainder). Set an explicit gas
  // allowance rather than letting an injected RPC forward a bare minimum limit.
  // This changes only the gas limit; buyWorld's exact msg.value is unchanged.
  const estimatedGas = await publicClient.estimateContractGas({ ...request, account })
  const gas = (estimatedGas * 130n + 99n) / 100n + 50_000n
  const [nativeBalance, gasPrice] = await Promise.all([
    publicClient.getBalance({ address: account }), publicClient.getGasPrice(),
  ])
  if (nativeBalance < (value ?? 0n) + gas * gasPrice) throw new Error(t('copy196'))
  // Recheck immediately before opening the wallet prompt. Epoch is also checked
  // by Core when mined. The stored wall/time catches same-epoch attacks/defends;
  // natural decay alone is allowed and never silently increases the user's amount.
  if (action.kind === 'attack' || action.kind === 'defend') {
    const latest = await reader.readLand(action.id)
    if (latest.epoch !== action.expectedEpoch || latest.resistanceRaw !== action.expectedResistanceRaw
      || latest.lastResistanceUpdate !== action.expectedLastResistanceUpdate) {
      throw new Error(t('copy190'))
    }
  }
  if (action.kind === 'profile') {
    const latest = await reader.readLand(action.id)
    if (latest.epoch !== action.expectedEpoch || !equalAddress(latest.controller, account)) {
      throw new Error(t('copy190'))
    }
    const fields = await reader.readProfileFieldsForName(latest)
    if (fields.logoURI !== preservedProfile!.logoURI || fields.website !== preservedProfile!.website) {
      throw new Error(t('profilePreservationChanged'))
    }
  }
  await assertWallet()
  onStage?.('confirm')
  // Keep a matching local signer when used by the Anvil integration runner.
  // Injected wallets use the explicitly checked JSON-RPC address.
  const signingAccount = walletClient.account?.type === 'local'
    && equalAddress(walletClient.account.address, account) ? walletClient.account : account
  const hash = await walletClient.writeContract({ ...request, gas, account: signingAccount, chain: publicClient.chain })
  onStage?.('pending', hash)
  let changedAction: 'cancelled' | 'replaced' | undefined
  const receipt = await publicClient.waitForTransactionReceipt({
    hash, confirmations: 1, timeout: 180_000,
    onReplaced(replacement) {
      if (replacement.reason !== 'repriced') changedAction = replacement.reason
      onStage?.('pending', replacement.transactionReceipt.transactionHash)
    },
  })
  if (changedAction === 'cancelled') throw new Error(t('copy197'))
  if (changedAction === 'replaced') throw new Error(t('copy198'))
  if (receipt.status !== 'success') throw new Error(t('copy199'))
  onStage?.('success', receipt.transactionHash)
  return receipt
}

export function worldErrorMessage(error: unknown): string {
  const reverted = error instanceof BaseError
    ? error.walk(cause => cause instanceof ContractFunctionRevertedError)
    : undefined
  let name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined
  const raw = error instanceof Error ? error.message : String(error)
  name ??= raw.match(/\b(StaleEpoch|ERC20InsufficientAllowance|ERC20InsufficientBalance|IncorrectPayment|NeutralLand|ResistanceRange|InsufficientClaim|NotController|NameTooLong|LogoURITooLong|WebsiteTooLong)\b/)?.[1]
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (/missing trie node|historical state|archive state|state is not available/i.test(raw)) return t('historyUnavailable')
  if (code === '-32002') return t('walletPending')
  if (code === '4100') return t('walletUnauthorized')
  if (code === '4900' || code === '4901') return t('walletDisconnected')
  if (/limit exceeded|triggered rate limit|Request exceeds defined limit/i.test(raw)) return t('copy200')
  if (name === 'StaleEpoch' || /StaleEpoch|stale epoch/i.test(raw)) return t('copy190')
  if (name === 'ERC20InsufficientAllowance') return t('copy192')
  if (name === 'ERC20InsufficientBalance') return t('copy193')
  if (name === 'IncorrectPayment') return t('copy201')
  if (name === 'NeutralLand') return t('copy191')
  if (name === 'ResistanceRange') return t('copy202')
  if (name === 'InsufficientClaim') return t('copy203')
  if (name === 'NotController' || /NotController/.test(raw)) return t('copy204')
  if (name === 'NameTooLong' || name === 'LogoURITooLong' || name === 'WebsiteTooLong') return t('copy205')
  if (/user rejected|user denied|rejected the request|4001/i.test(raw)) return t('copy206')
  if (/transaction.*timed out|waitForTransactionReceipt|timed out while waiting/i.test(raw)) return t('copy207')
  if (/insufficient funds/i.test(raw)) return t('copy208')
  if (/fetch failed|failed to fetch|HTTP request failed|ECONNREFUSED/i.test(raw)) return t('copy209')
  if (knownMessage(raw)) return localizeMessage(raw)
  if (/revert|contract function|execution failed/i.test(raw)) return t('contractFailure')
  if (/RPC|HTTP|network|timeout|503|502|429/i.test(raw)) return t('rpcFailure')
  return t('genericError')
}
