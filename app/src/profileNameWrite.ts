import { t } from './i18n'
import { profileAbi } from './abi'
import { decodeAbiParameters, encodeFunctionData, hexToString, stringToHex, type Hex, type Address, type PublicClient } from 'viem'
import { byteLength, type Land, type ProfileLimits } from './domain'

export function validateLandName(name: string, limits: Pick<ProfileLimits, 'name'>) {
  if (byteLength(name) > limits.name) throw new Error(t('copy241', { v0: 'name', v1: limits.name }))
}

/** Opaque compatibility fields. Never interpreted, displayed or normalized by the UI. */
export interface PreservedProfileFields { logoURI: string; website: string }

function losslessString(bytes: Hex): string {
  const text = hexToString(bytes)
  if (stringToHex(text).toLowerCase() !== bytes.toLowerCase()) throw new Error('Profile field cannot round-trip')
  return text
}

export async function readProfileFieldsForName(client: PublicClient, address: Address, land: Land, deploymentBlock: bigint): Promise<PreservedProfileFields> {
  try {
    const head = await client.getBlockNumber({ cacheTime: 0 })
    if (head < deploymentBlock) throw new Error('Incomplete Profile history')
    // Read the same getter, decoding its dynamic fields as bytes first. Invalid
    // UTF-8 must fail closed instead of being replaced silently by TextDecoder.
    const response = await client.call({ to: address, data: encodeFunctionData({ abi: profileAbi, functionName: 'getCurrentProfile', args: [BigInt(land.id)] }), blockNumber: head })
    if (!response.data) throw new Error('Missing Profile data')
    const raw = decodeAbiParameters([{ type: 'bool' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }], response.data)
    if (raw[1].toLowerCase() !== land.controller.toLowerCase() || raw[2] !== land.epoch) throw new Error('Profile context changed')
    if (raw[0]) return { logoURI: losslessString(raw[4]), website: losslessString(raw[5]) }

    // The getter hides the stored record after a takeover. Recover its last write
    // from canonical events; never equate an invalid current Profile with empty storage.
    const anchor = (await client.getBlock({ blockNumber: head })).hash
    if (!anchor) throw new Error('Missing canonical Profile anchor')
    let toBlock = head
    let fields: PreservedProfileFields | undefined
    while (toBlock >= deploymentBlock) {
      const fromBlock = toBlock >= deploymentBlock + 4999n ? toBlock - 4999n : deploymentBlock
      const logs = await client.getContractEvents({ address, abi: profileAbi, eventName: 'ProfileUpdated', args: { landId: BigInt(land.id) }, fromBlock, toBlock, strict: true })
      const last = logs.filter(log => !log.removed && log.blockNumber !== null && log.logIndex !== null)
        .sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex! - a.logIndex! : a.blockNumber! > b.blockNumber! ? -1 : 1)[0]
      if (last) {
        const args = last.args as { landId: bigint; logoURI: string; website: string }
        if (args.landId !== BigInt(land.id) || typeof args.logoURI !== 'string' || typeof args.website !== 'string') throw new Error('Invalid Profile history')
        const bytes = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }], last.data)
        fields = { logoURI: losslessString(bytes[1]), website: losslessString(bytes[2]) }
        if (fields.logoURI !== args.logoURI || fields.website !== args.website) throw new Error('Inconsistent Profile event')
        break
      }
      if (fromBlock === deploymentBlock) { fields = { logoURI: '', website: '' }; break }
      toBlock = fromBlock - 1n
    }
    if (!fields || (await client.getBlock({ blockNumber: head })).hash !== anchor) throw new Error('Profile history changed')
    return fields
  } catch { throw new Error(t('profilePreservationFailed')) }
}
