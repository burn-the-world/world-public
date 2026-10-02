import type { WorldSnapshot } from './domain'

const instanceFields = ['deployment', 'core', 'token', 'profile'] as const
export function sameWorldInstance(a: WorldSnapshot, b: WorldSnapshot): boolean {
  return instanceFields.every(key => !!a.addresses[key] && !!b.addresses[key]
    && a.addresses[key]!.toLowerCase() === b.addresses[key]!.toLowerCase())
}
/** Wallet fields do not affect the current world state. Missing hashes never qualify for reuse. */
export function sameWorldSnapshot(a: WorldSnapshot, b: WorldSnapshot): boolean {
  return sameWorldInstance(a,b) && !!a.blockHash && !!b.blockHash
    && a.blockHash.toLowerCase() === b.blockHash.toLowerCase()
    && a.blockNumber === b.blockNumber && a.timestamp === b.timestamp && a.J === b.J
    && a.lands.length === b.lands.length && a.lands.every((land,i) => {
      const next=b.lands[i]
      return next.id === land.id && next.epoch === land.epoch && next.j === land.j
        && next.weight === land.weight && next.controller.toLowerCase() === land.controller.toLowerCase()
    })
}
/** Keep a previously verified block visible while a newer block is being checked. */
export function canRetainWorldSnapshot(previous: WorldSnapshot, current: WorldSnapshot): boolean {
  if (!sameWorldInstance(previous,current) || !previous.blockHash || !current.blockHash) return false
  if (current.blockNumber === previous.blockNumber) return sameWorldSnapshot(previous,current)
  return current.blockNumber > previous.blockNumber && current.timestamp >= previous.timestamp && current.J >= previous.J
}
