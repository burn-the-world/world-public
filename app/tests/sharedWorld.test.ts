import { describe, expect, it, vi } from 'vitest'
import { createSharedWorld } from '../src/sharedWorld'
import { serializeData } from '../src/dataCodec'
import { B, W, N, RESISTANCE_HALF_LIFE, MAX_WAR_ATOMS, RESISTANCE_LIMIT, weightOf, type WorldSnapshot } from '../src/domain'
import type { WorldReader } from '../src/chain'

const core = '0x1111111111111111111111111111111111111111' as const
function fixture() {
  const s: WorldSnapshot = {
    addresses: { core, token: core, deployment: core, profile: core }, blockNumber: 100n, timestamp: 1000n, blockHash: `0x${'1'.repeat(64)}`,
    U: 100n * B, J: 0n, accountedBNB: 100n, totalSupply: 2n ** 255n, coreNativeBalance: 100n, coreWorldBalance: 0n,
    parameters: { N, W, B, T: 5184000n, tokenUnit: 10n ** 18n, worldPrice: 10n ** 12n, resistanceHalfLife: RESISTANCE_HALF_LIFE, maxWarAtoms: MAX_WAR_ATOMS, resistanceLimit: RESISTANCE_LIMIT },
    lands: Array.from({ length: N }, (_, i) => ({ id: i + 1, weight: weightOf(i + 1), controller: core, epoch: 1n,
      resistanceRaw: 0n, lastResistanceUpdate: 1000n, currentResistanceRaw: 0n, minimumAttackAtoms: 1n, j: 0n })),
  }
  const reader = { config: { chainId: 97, coreAddress: core }, adoptShared: vi.fn(), adoptLimits: vi.fn() } as unknown as WorldReader
  const request = vi.fn(async () => new Response(serializeData(s)))
  return { s, reader, request }
}
describe('shared world browser boundary', () => {
  it('preserves large bigint quantities and coalesces multi-component reads', async () => {
    const f = fixture(), shared = createSharedWorld('https://world.example', f.reader, f.request)
    const values = await Promise.all([shared.snapshot(), shared.snapshot()])
    expect(values[0].totalSupply).toBe(2n ** 255n); expect(values[0].lands).toHaveLength(50)
    expect(f.request).toHaveBeenCalledTimes(1)
  })
  it.each(['instance', 'weights', 'resistance', 'units', 'time', 'wallet'])('rejects invalid shared %s', async kind => {
    const f = fixture()
    if (kind === 'instance') f.s.addresses.core = '0x2222222222222222222222222222222222222222'
    if (kind === 'weights') f.s.lands[0].weight = 5n
    if (kind === 'resistance') f.s.lands[0].minimumAttackAtoms = 0n
    if (kind === 'units') f.s.parameters.tokenUnit = 10n ** 9n
    if (kind === 'time') f.s.lands[0].lastResistanceUpdate = 1001n
    if (kind === 'wallet') f.s.wallet = { address: core, balance: 1n, allowance: 0n, claimable: 0n, nativeBalance: 0n }
    await expect(createSharedWorld('https://world.example', f.reader, f.request).snapshot()).rejects.toThrow()
    expect(f.reader.adoptShared).not.toHaveBeenCalled()
  })
  it('does not revive a cached Profile from a different controller/epoch', async () => {
    const f = fixture()
    const old = { status: 'available', valid: true, controller: core, epoch: 0n, name: 'old ruler', logoURI: 'https://example.com/old.png', website: '' }
    const request = vi.fn(async () => new Response(serializeData({ 1: old })))
    const profiles = await createSharedWorld('https://world.example', f.reader, request).profiles(f.s)
    expect(profiles[1].status).toBe('unavailable'); expect(profiles[1].name).toBe('')
  })
})
