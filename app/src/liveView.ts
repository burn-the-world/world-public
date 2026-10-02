import { type Address } from 'viem'
import { coreAbi, tokenAbi, profileAbi } from './abi'
import { minimumAttackAtoms, pendingNumerator, validateResistance, weightOf, type WorldSnapshot, type LandProfile } from './domain'
import type { WorldReader } from './chain'

/** Separate live wallet/selected-LAND view: never relabel an older world snapshot as a new head. */
export async function readLiveView(reader: WorldReader, base: WorldSnapshot, account?: Address, id?: number, globals = false): Promise<WorldSnapshot> {
  if (id !== undefined && (!Number.isInteger(id) || id < 1 || id > 50)) throw new Error('Invalid LAND')
  let client = reader.liveClient
  let block = await client.getBlock({ blockTag: 'latest' })
  if (block.number !== null && block.number < base.blockNumber) {
    client = reader.publicClient; block = await client.getBlock({ blockTag: 'latest' })
  }
  if (block.number === null || !block.hash || block.number < base.blockNumber) throw new Error('Invalid live block')
  const { core, token } = base.addresses
  const calls: any[] = []
  if (globals) calls.push({ address: core, abi: coreAbi, functionName: 'checkpoint' },
    { address: core, abi: coreAbi, functionName: 'accountedBNB' },
    { address: token, abi: tokenAbi, functionName: 'totalSupply' })
  const walletOffset = calls.length
  if (account) calls.push({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [account] },
    { address: token, abi: tokenAbi, functionName: 'allowance', args: [account, core] },
    { address: core, abi: coreAbi, functionName: 'claimable', args: [account] })
  const landOffset = calls.length
  if (id !== undefined) calls.push({ address: core, abi: coreAbi, functionName: 'lands', args: [BigInt(id)] },
    { address: core, abi: coreAbi, functionName: 'currentResistanceRaw', args: [BigInt(id)] },
    { address: core, abi: coreAbi, functionName: 'minimumAttackAtoms', args: [BigInt(id)] })
  if (id !== undefined && !globals) calls.push({ address: core, abi: coreAbi, functionName: 'checkpoint' })
  const [data, native] = await Promise.all([(client === reader.publicClient ? reader.publicMany(calls, block.number) : reader.liveMany(calls, block.number)),
    account ? client.getBalance({ address: account, blockNumber: block.number }) : Promise.resolve(0n)])
  const result = { ...base }
  if (globals) {
    const [U, J] = data[0] as [bigint, bigint]
    Object.assign(result, { U, J, accountedBNB: data[1], totalSupply: data[2] })
  }
  if (account) result.wallet = { address: account, balance: data[walletOffset] as bigint,
    allowance: data[walletOffset + 1] as bigint, claimable: data[walletOffset + 2] as bigint, nativeBalance: native }
  if (id !== undefined) {
    const [controller, resistanceRaw, lastResistanceUpdate, epoch, j] = data[landOffset] as [Address, bigint, bigint, bigint, bigint]
    const currentResistanceRaw = data[landOffset + 1] as bigint, minimum = data[landOffset + 2] as bigint
    validateResistance(resistanceRaw); validateResistance(currentResistanceRaw)
    if (currentResistanceRaw > resistanceRaw || minimum !== minimumAttackAtoms(currentResistanceRaw) || lastResistanceUpdate > block.timestamp) throw new Error('Invalid live Resistance')
    const land = { id, controller, resistanceRaw, lastResistanceUpdate, epoch, j, weight: weightOf(id), currentResistanceRaw, minimumAttackAtoms: minimum }
    const [U, J] = data[globals ? 0 : landOffset + 3] as [bigint, bigint]
    pendingNumerator(land, J)
    Object.assign(result, { U, J, lands: base.lands.map(item => item.id === id ? land : item) })
  }
  // Other LANDs are unchanged. Only use this view for wallet/selected LAND, never world history accounting.
  Object.assign(result, { blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp })
  return result
}
export async function readLiveProfile(reader: WorldReader, view: WorldSnapshot, id: number): Promise<LandProfile> {
  const land = view.lands[id - 1]
  const raw = await reader.liveClient.readContract({ address: view.addresses.profile!, abi: profileAbi,
    functionName: 'getCurrentProfile', args: [BigInt(id)], blockNumber: view.blockNumber }) as [boolean, Address, bigint, string, string, string]
  if (raw[1].toLowerCase() !== land.controller.toLowerCase() || raw[2] !== land.epoch) throw new Error('Profile context changed')
  return { status: 'available', valid: raw[0], controller: raw[1], epoch: raw[2],
    name: raw[0] ? raw[3] : '', logoURI: raw[0] ? raw[4] : '', website: raw[0] ? raw[5] : '' }
}
