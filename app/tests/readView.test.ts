import { expect, it } from 'vitest'
import { visibleLands, visiblePending, observedRollback } from '../src/readView'
import type { AppProps } from '../src/uiTypes'
import type { Land, WorldSnapshot } from '../src/domain'
const controller = '0x1111111111111111111111111111111111111111' as const
const land: Land = { id: 1, controller, weight: 6n, epoch: 1n, resistanceRaw: 0n,
  currentResistanceRaw: 0n, minimumAttackAtoms: 1n, lastResistanceUpdate: 0n, j: 0n }
it('uses the matching live J after settlement instead of subtracting new j from an old shared index', () => {
  const oldJ = 1n << 190n, newJ = 1n << 191n
  const p = { snapshot: { J: oldJ, lands: [land] } as WorldSnapshot,
    landObservations: { 1: { land: { ...land, j: newJ }, J: newJ, blockNumber: 101n } } } as AppProps
  expect(visiblePending(p, land)).toBe(0n)
})
it('shows the receipt-refreshed controller without modifying the cached public snapshot', () => {
  const replacement = '0x2222222222222222222222222222222222222222' as const
  const snapshot = { J: 100n, lands: [land] } as WorldSnapshot
  const p = { snapshot, landObservations: { 1: { land: { ...land, controller: replacement, epoch: 2n }, J: 100n, blockNumber: 101n } } } as AppProps
  expect(visibleLands(p)[0].controller).toBe(replacement)
  expect(snapshot.lands[0].controller).toBe(controller)
})


it.each(['lower head', 'replaced head'])('invalidates receipt overlays on an observed %s', kind => {
  const previous = { addresses: { core: controller, token: controller, profile: controller, deployment: controller },
    blockNumber: 100n, blockHash: '0x1111', timestamp: 1000n, J: 100n, lands: [land] } as WorldSnapshot
  const next = { ...previous, ...(kind === 'lower head' ? { blockNumber: 99n } : { blockHash: '0x2222' }) }
  expect(observedRollback(previous, next)).toBe(true)
  expect(observedRollback(previous, { ...previous, blockNumber: 101n, timestamp: 1001n })).toBe(false)
})
