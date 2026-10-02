import { zeroAddress, decodeEventLog, keccak256, type Hex, type AbiEvent, type Log } from 'viem'
import { coreAbi } from '../src/abi'
import { weightOf, TOKEN_UNIT, REWARD_DENOMINATOR, MAX_WAR_ATOMS, validateResistance } from '../src/domain'
import type { WorldReader } from '../src/chain'
import { REFERENCE_WORLD_PRICE, reignKey, type LeaderboardCheckpoint, type CheckpointBlock } from '../src/leaderboard'

export interface AggregateEvent {
  eventName: string; args: Record<string, unknown>; blockNumber: bigint; blockHash: Hex; timestamp: bigint
  transactionHash: Hex; transactionIndex: number; logIndex: number
}
const relevant = ['Earned', 'Taken', 'AttackProgress', 'Defended']
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
function integer(value: unknown): bigint { if (typeof value !== 'bigint' || value < 0n) throw new Error('Invalid aggregate integer'); return value }
function address(value: unknown): `0x${string}` { if (typeof value !== 'string' || !/^0x[\da-f]{40}$/i.test(value) || same(value, zeroAddress)) throw new Error('Invalid controller'); return value as `0x${string}` }
function amount(value: unknown) { const n = integer(value); if (n === 0n || n >= MAX_WAR_ATOMS) throw new Error('Invalid burn amount'); return n }
export function validateCheckpoint(c: LeaderboardCheckpoint) {
  if (c.version !== 3 || c.lands.length !== 50 || c.head.blockNumber < c.identity.deploymentBlock || c.globalJ < 0n
    || c.worldPrice !== REFERENCE_WORLD_PRICE || c.tokenUnit !== TOKEN_UNIT || c.rewardDenominator !== REWARD_DENOMINATOR
    || !/^0x[\da-f]{64}$/i.test(c.head.blockHash)) throw new Error('Invalid reign checkpoint')
  integer(c.globalJ); integer(c.head.timestamp)
  const keys = new Set<string>(), epochs = new Map<number, typeof c.reigns>()
  for (const r of c.reigns) {
    address(r.controller); integer(r.epoch); integer(r.startedAt); amount(r.openingBurn)
    for (const n of [r.attackProgressBurn, r.defenseBurn, r.externalSupportBurn, r.earnedScaled]) integer(n)
    if (!Number.isInteger(r.landId) || r.landId < 1 || r.landId > 50 || r.epoch === 0n || r.startedAt > c.head.timestamp
      || r.endedAt !== undefined && (integer(r.endedAt) < r.startedAt || r.endedAt > c.head.timestamp)
      || keys.has(reignKey(r))) throw new Error('Invalid reign')
    keys.add(reignKey(r))
    const list = epochs.get(r.landId) ?? []; list.push(r); epochs.set(r.landId, list)
  }
  c.lands.forEach((land, i) => {
    integer(land.j); integer(land.epoch); integer(land.startedAt); validateResistance(integer(land.resistanceRaw)); integer(land.lastResistanceUpdate)
    if (land.id !== i + 1 || land.j > c.globalJ || land.startedAt > c.head.timestamp || land.lastResistanceUpdate > c.head.timestamp) throw new Error('Invalid LAND checkpoint')
    const list = (epochs.get(land.id) ?? []).sort((a, b) => a.epoch < b.epoch ? -1 : 1)
    if (same(land.controller, zeroAddress)) {
      if (land.epoch !== 0n || land.startedAt !== 0n || land.j !== 0n || land.resistanceRaw !== 0n || land.lastResistanceUpdate !== 0n || list.length) throw new Error('Invalid neutral LAND')
    } else {
      address(land.controller)
      if (land.epoch === 0n || BigInt(list.length) !== land.epoch) throw new Error('Missing reign')
      list.forEach((r, n) => {
        const next = list[n + 1]
        if (r.epoch !== BigInt(n + 1) || (next ? r.endedAt !== next.startedAt
          : r.endedAt !== undefined || !same(r.controller, land.controller) || r.startedAt !== land.startedAt)) throw new Error('Invalid reign boundary')
      })
    }
  })
  return c
}
export const compareEvents = (a: AggregateEvent, b: AggregateEvent) => a.blockNumber !== b.blockNumber ? a.blockNumber < b.blockNumber ? -1 : 1
  : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
/** Complete block prefixes only. First-claim Earned is held until the following epoch-1 Taken. */
export function reduceAggregate(previous: LeaderboardCheckpoint, events: readonly AggregateEvent[], head: CheckpointBlock) {
  validateCheckpoint(previous)
  const c = structuredClone(previous), seen = new Set<string>(), rows = new Map(c.reigns.map(r => [reignKey(r), r]))
  if (head.blockNumber < c.head.blockNumber || head.timestamp < c.head.timestamp) throw new Error('Checkpoint rollback')
  let last: AggregateEvent | undefined, treasure: AggregateEvent | undefined
  for (const e of events.filter(e => relevant.includes(e.eventName)).sort(compareEvents)) {
    const key = `${e.blockNumber}:${e.logIndex}`
    if (seen.has(key) || e.blockNumber <= previous.head.blockNumber || e.blockNumber > head.blockNumber || e.timestamp < previous.head.timestamp
      || e.timestamp > head.timestamp || !Number.isSafeInteger(e.logIndex) || e.logIndex < 0 || !Number.isSafeInteger(e.transactionIndex) || e.transactionIndex < 0
      || (last && (e.timestamp < last.timestamp || e.blockNumber === last.blockNumber && (e.blockHash !== last.blockHash
        || e.timestamp !== last.timestamp || e.logIndex <= last.logIndex)))) throw new Error('Invalid event order')
    if (treasure && e.eventName !== 'Taken') throw new Error('Missing first takeover')
    seen.add(key)
    const id = integer(e.args.id); if (id < 1n || id > 50n) throw new Error('Invalid LAND')
    const land = c.lands[Number(id) - 1], current = rows.get(reignKey({ landId: land.id, controller: land.controller, epoch: land.epoch }))
    if (e.eventName === 'Earned') {
      const beneficiary = address(e.args.beneficiary), J = integer(e.args.J), delta = integer(e.args.delta)
      if (J < c.globalJ || J < land.j || delta !== weightOf(Number(id)) * (J - land.j)
        || current && !same(beneficiary, current.controller)) throw new Error('Invalid Earned entitlement')
      if (current) current.earnedScaled += delta
      else { if (!same(land.controller, zeroAddress)) throw new Error('Missing active reign'); treasure = e }
      land.j = J; c.globalJ = J
    } else if (e.eventName === 'Taken') {
      const owner = address(e.args.newController), epoch = integer(e.args.epoch), burn = amount(e.args.amount)
      if (epoch !== land.epoch + 1n || !same(String(e.args.oldController), land.controller)
        || !last || last.eventName !== 'Earned' || last.args.id !== id || last.transactionHash !== e.transactionHash || last.transactionIndex !== e.transactionIndex
        || last.blockNumber !== e.blockNumber || !same(String(last.args.beneficiary), current ? current.controller : owner)) throw new Error('Invalid takeover boundary')
      if (current) current.endedAt = e.timestamp
      const row = { landId: land.id, controller: owner, epoch, startedAt: e.timestamp, openingBurn: burn,
        attackProgressBurn: 0n, defenseBurn: 0n, externalSupportBurn: 0n, earnedScaled: treasure ? integer(treasure.args.delta) : 0n }
      if (rows.has(reignKey(row))) throw new Error('Duplicate reign')
      c.reigns.push(row); rows.set(reignKey(row), row); treasure = undefined
      land.controller = owner; land.epoch = epoch; land.startedAt = e.timestamp
    } else {
      if (!current || integer(e.args.epoch) !== land.epoch) throw new Error('Burn outside active reign')
      const burn = amount(e.args.amount)
      if (e.eventName === 'AttackProgress') {
        if (same(address(e.args.attacker), current.controller)) current.attackProgressBurn += burn
      } else if (same(address(e.args.supporter), current.controller)) current.defenseBurn += burn
      else current.externalSupportBurn += burn
    }
    if (e.eventName !== 'Earned') {
      land.resistanceRaw = validateResistance(integer(e.args.resistanceRaw))
      land.lastResistanceUpdate = integer(e.args.lastResistanceUpdate)
      if (land.lastResistanceUpdate !== e.timestamp) throw new Error('Invalid resistance time')
    }
    last = e
  }
  if (treasure) throw new Error('Missing first takeover')
  c.head = head
  return validateCheckpoint(c)
}

/** Bounded contiguous suffix; never restarts at deployment. Reorg keeps the last trusted snapshot. */
export async function syncLeaderboard(reader: WorldReader, previous: LeaderboardCheckpoint, maxBlocks = 50_000n) {
  validateCheckpoint(previous)
  const client = reader.publicClient, identity = previous.identity
  if (reader.config.chainId !== identity.chainId || reader.config.deploymentAddress?.toLowerCase() !== identity.deployment.toLowerCase()
    || await client.getChainId() !== identity.chainId) throw new Error('Wrong checkpoint instance')
  const latest = await client.getBlockNumber({ cacheTime: 0 })
  const safe = latest > 12n ? latest - 12n : latest
  const target = safe < previous.head.blockNumber ? previous.head.blockNumber : safe < previous.head.blockNumber + maxBlocks ? safe : previous.head.blockNumber + maxBlocks
  if (latest < previous.head.blockNumber) throw new Error('Head rollback')
  const [anchor, head, code] = await Promise.all([client.getBlock({ blockNumber: previous.head.blockNumber }), client.getBlock({ blockNumber: target }), client.getBytecode({ address: identity.core, blockNumber: target })])
  if (anchor.hash !== previous.head.blockHash || !head.hash || !code || keccak256(code) !== identity.coreCodeHash) throw new Error('Checkpoint reorganized or different Core')
  const events: AggregateEvent[] = []
  const blocks = new Map<bigint, Awaited<ReturnType<typeof client.getBlock>>>([[target, head]])
  const eventAbis = coreAbi.filter(item => item.type === 'event' && relevant.includes(item.name))
  for (let from = previous.head.blockNumber + 1n; from <= target; from += 5000n) {
    const to = from + 4999n < target ? from + 4999n : target
    const logs = await client.getLogs({ address: identity.core, events: eventAbis as AbiEvent[], fromBlock: from, toBlock: to, strict: true }) as Log[]
    if (logs.length + events.length > 512) throw new Error('Aggregate work budget exceeded')
    const missing = [...new Set(logs.map(l => l.blockNumber!))].filter(n => !blocks.has(n))
    if (missing.length + blocks.size > 65) throw new Error('Event block budget exceeded')
    await Promise.all(missing.map(async n => { blocks.set(n, await client.getBlock({ blockNumber: n })) }))
    for (const log of logs) {
      if (log.removed || log.blockNumber === null || log.blockHash === null || log.transactionHash === null || log.transactionIndex === null || log.logIndex === null
        || log.blockNumber < from || log.blockNumber > to || !same(log.address, identity.core) || blocks.get(log.blockNumber)?.hash !== log.blockHash) throw new Error('Invalid canonical log')
      const decoded = decodeEventLog({ abi: eventAbis, data: log.data, topics: log.topics, strict: true }) as unknown as { eventName: string; args: Record<string, unknown> }
      events.push({ ...decoded, blockNumber: log.blockNumber, blockHash: log.blockHash, timestamp: blocks.get(log.blockNumber)!.timestamp,
        transactionHash: log.transactionHash, transactionIndex: log.transactionIndex, logIndex: log.logIndex })
    }
  }
  const next = reduceAggregate(previous, events, { blockNumber: target, blockHash: head.hash, timestamp: head.timestamp })
  const values = await reader.publicMany(Array.from({ length: 50 }, (_, i) => ({ address: identity.core, abi: coreAbi, functionName: 'lands', args: [BigInt(i + 1)] })), target)
  next.lands.forEach((land, i) => {
    const [owner, raw, lastUpdate, epoch, j] = values[i] as [`0x${string}`, bigint, bigint, bigint, bigint]
    if (!same(owner, land.controller) || epoch !== land.epoch || j !== land.j || raw !== land.resistanceRaw || lastUpdate !== land.lastResistanceUpdate) throw new Error('Missing events: LAND storage mismatch')
  })
  if ((await client.getBlock({ blockNumber: target })).hash !== head.hash) throw new Error('Reorganization during sync')
  return { checkpoint: next, target: safe, events: events.length }
}
