import { describe, it, expect, vi } from 'vitest'
import { encodeAbiParameters, stringToHex, type PublicClient, type Address } from 'viem'
import { readProfileFieldsForName } from '../src/profileNameWrite'
import type { Land } from '../src/domain'

const owner = '0x1111111111111111111111111111111111111111' as Address
const profile = '0x2222222222222222222222222222222222222222' as Address
const land = { id: 23, controller: owner, epoch: 2n } as Land
const opaque = { logoURI: ' ipfs://legacy/头像.png ', website: 'javascript:legacy-string' }
const bytesTypes = [{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }] as const
function response(valid: boolean, controller = owner, epoch = 2n, logo = stringToHex(opaque.logoURI), website = stringToHex(opaque.website)) {
  return { data: encodeAbiParameters([{ type: 'bool' }, { type: 'address' }, { type: 'uint256' }, ...bytesTypes], [valid, controller, epoch, '0x', logo, website]) }
}
function fixture(valid = true) {
  const client = { getBlockNumber: vi.fn().mockResolvedValue(7000n), call: vi.fn().mockResolvedValue(response(valid)),
    getBlock: vi.fn().mockResolvedValue({ hash: '0xabc' }), getContractEvents: vi.fn().mockResolvedValue([]) }
  const read = () => readProfileFieldsForName(client as unknown as PublicClient, profile, land, 1n)
  return { client, read }
}
const log = (blockNumber = 5n, logIndex = 1, patch: Record<string, any> = {}) => {
  const args = patch.args ?? { landId: 23n, ...opaque }
  const data = encodeAbiParameters(bytesTypes, ['0x', stringToHex(args.logoURI ?? ''), stringToHex(args.website ?? '')])
  return { removed: false, blockNumber, logIndex, args, data, ...patch }
}

describe('name-only writes preserve opaque chain fields', () => {
  it('preserves a valid current record exactly without parsing URLs or using history', async () => {
    const f = fixture(); expect(await f.read()).toEqual(opaque); expect(f.client.getContractEvents).not.toHaveBeenCalled()
  })
  it('recovers hidden fields from the last event after an epoch/controller change', async () => {
    const f = fixture(false); f.client.getContractEvents.mockResolvedValueOnce([log(6500n, 0), log(6500n, 2, { args: { landId: 23n, logoURI: 'last', website: 'last-site' } }), log(6400n)])
    expect(await f.read()).toEqual({ logoURI: 'last', website: 'last-site' })
  })
  it('walks contiguous bounded ranges backward and never skips unverified blocks', async () => {
    const f = fixture(false); f.client.getContractEvents.mockResolvedValueOnce([]).mockResolvedValueOnce([log()]); expect(await f.read()).toEqual(opaque)
    expect(f.client.getContractEvents.mock.calls.map(([r]) => [r.fromBlock, r.toBlock])).toEqual([[2001n, 7000n], [1n, 2000n]])
  })
  it('uses empty fields only after complete canonical history proves no previous submission', async () => {
    const f = fixture(false); expect(await f.read()).toEqual({ logoURI: '', website: '' }); expect(f.client.getContractEvents).toHaveBeenCalledTimes(2)
  })
  it('ignores removed events', async () => {
    const f = fixture(false); f.client.getContractEvents.mockResolvedValueOnce([log(6900n, 2, { removed: true }), log(6000n)]); expect(await f.read()).toEqual(opaque)
  })
  it.each(['controller', 'epoch'])('fails closed on a changed %s', async field => {
    const f = fixture(); f.client.call.mockResolvedValue(response(true, field === 'controller' ? profile : owner, field === 'epoch' ? 3n : 2n))
    await expect(f.read()).rejects.toThrow(/字段|Profile/)
  })
  it('fails closed when historical reads fail rather than overwriting with empty values', async () => {
    const f = fixture(false); f.client.getContractEvents.mockRejectedValue(new Error('archive unavailable')); await expect(f.read()).rejects.toThrow(/字段|Profile/)
  })
  it('fails closed on malformed event fields', async () => {
    const f = fixture(false); f.client.getContractEvents.mockResolvedValueOnce([log(6500n, 1, { args: { landId: 23n } })]); await expect(f.read()).rejects.toThrow(/字段|Profile/)
  })
  it('refuses getter bytes that would be changed by JavaScript UTF-8 replacement', async () => {
    const f=fixture();f.client.call.mockResolvedValue(response(true,owner,2n,'0xff'))
    await expect(f.read()).rejects.toThrow(/字段|Profile/)
  })
  it('refuses lossy historical event strings rather than rewriting their bytes', async () => {
    const f=fixture(false);f.client.getContractEvents.mockResolvedValueOnce([log(6500n,1,{data:encodeAbiParameters(bytesTypes,['0x','0xff','0x'])})])
    await expect(f.read()).rejects.toThrow(/字段|Profile/)
  })
  it('fails closed on reorg during reconstruction', async () => {
    const f = fixture(false); f.client.getBlock.mockResolvedValueOnce({ hash: '0xabc' }).mockResolvedValueOnce({ hash: '0xdef' }); await expect(f.read()).rejects.toThrow(/字段|Profile/)
  })
  it('does not scan when the configured deployment block is newer than the head', async () => {
    const f = fixture(false); f.client.getBlockNumber.mockResolvedValue(0n); await expect(f.read()).rejects.toThrow(/字段|Profile/); expect(f.client.getContractEvents).not.toHaveBeenCalled()
  })
})
