import { canRetainWorldSnapshot } from './worldSnapshot'
import type { Land, WorldSnapshot } from './domain'
import { pendingNumerator } from './domain'
import type { AppProps } from './uiTypes'

export type LandObservation = { land: Land; J: bigint; blockNumber: bigint }
export function visibleLands(p: Pick<AppProps, 'snapshot' | 'landObservations'>): Land[] {
  return p.snapshot?.lands.map(land => p.landObservations?.[land.id]?.land ?? land) ?? []
}
export function visiblePending(p: Pick<AppProps, 'snapshot' | 'landObservations'>, land: Land): bigint {
  const observed = p.landObservations?.[land.id]
  return pendingNumerator(observed?.land ?? land, observed?.J ?? p.snapshot?.J ?? 0n)
}


export function observedRollback(previous: WorldSnapshot | undefined, next: WorldSnapshot): boolean {
  return !!previous && !canRetainWorldSnapshot(previous, next)
}
