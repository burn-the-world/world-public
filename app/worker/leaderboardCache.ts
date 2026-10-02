import { parseData, serializeData } from '../src/dataCodec'
import { LEADERBOARD_TTL, MIN_LEADERBOARD_BURN_ATOMS, leaderboardSnapshot, reignKey, type LeaderboardCheckpoint, type LeaderboardSnapshot } from '../src/leaderboard'
import { validateCheckpoint } from './leaderboardIndex'
import { observeCache, observeLeaderboard } from './observe'
import type { WorkerCache } from './shared'

type Stored = { checkpoint: LeaderboardCheckpoint; snapshot: LeaderboardSnapshot; checkedAt: number; retryAt: number }
export interface Background { waitUntil(promise: Promise<unknown>): void }
const pending = new Map<string, Promise<void>>()
const initializing = new Map<string, Promise<Stored>>()
/** The public response contains only top aggregate rows. The private cursor is evictable per location. */
export async function cachedLeaderboard(request: Request, cache: WorkerCache, bootstrap: () => Promise<LeaderboardCheckpoint>,
  sync: (checkpoint: LeaderboardCheckpoint) => Promise<{ checkpoint: LeaderboardCheckpoint; target: bigint; events: number }>, ctx?: Background, now = Date.now()) {
  const key = new Request(new URL(`/__leaderboard/reigns-v3/min-${MIN_LEADERBOARD_BURN_ATOMS}/latest`, request.url)), start = performance.now()
  const retained = await cache.match(key)
  let stored: Stored
  if (retained) { stored = parseData(await retained.text()) as Stored; validateCheckpoint(stored.checkpoint) }
  else {
    if (!initializing.has(key.url)) {
      const first = (async () => {
        // Another cold request may have completed its put since our first match.
        const ready = await cache.match(key)
        if (ready) return parseData(await ready.text()) as Stored
        const checkpoint = validateCheckpoint(await bootstrap())
        const value = { checkpoint, snapshot: leaderboardSnapshot(checkpoint), checkedAt: 0, retryAt: 0 }
        await save(value)
        return value
      })().finally(() => initializing.delete(key.url))
      initializing.set(key.url, first)
    }
    stored = await initializing.get(key.url)!
  }
  async function save(value: Stored) {
    await cache.put(key, new Response(serializeData(value), { headers: { 'cache-control': 'public, max-age=2592000' } }))
  }
  const fresh = now - stored.checkedAt < LEADERBOARD_TTL, stale = !fresh
  const status = fresh ? 'HIT' : retained ? 'STALE' : 'BOOTSTRAP'
  if (stale && now >= stored.retryAt && !pending.has(key.url)) {
    const refresh = (async () => {
      const begun = performance.now()
      try {
        const next = await sync(stored.checkpoint)
        validateCheckpoint(next.checkpoint)
        if (next.checkpoint.head.blockNumber < stored.checkpoint.head.blockNumber || next.checkpoint.head.blockNumber > next.target
          || serializeData(next.checkpoint.identity) !== serializeData(stored.checkpoint.identity)
          || stored.checkpoint.reigns.some(old => !next.checkpoint.reigns.some(row => reignKey(row) === reignKey(old)
            && row.earnedScaled >= old.earnedScaled && row.openingBurn === old.openingBurn && row.startedAt === old.startedAt
            && (old.endedAt === undefined || row.endedAt === old.endedAt && row.earnedScaled === old.earnedScaled
              && row.attackProgressBurn === old.attackProgressBurn && row.defenseBurn === old.defenseBurn && row.externalSupportBurn === old.externalSupportBurn)
            && row.attackProgressBurn >= old.attackProgressBurn && row.defenseBurn >= old.defenseBurn
            && row.externalSupportBurn >= old.externalSupportBurn))) throw new Error('Checkpoint regression')
        // Each published prefix is complete and reconciled at its own indexedThroughBlock.
        await save({ checkpoint: next.checkpoint, snapshot: leaderboardSnapshot(next.checkpoint), checkedAt: Date.now(), retryAt: 0 })
        observeLeaderboard(stored.checkpoint.head.blockNumber, next.checkpoint.head.blockNumber, next.target, next.events, true, performance.now() - begun)
      } catch {
        // Keep the last complete result; back off without exposing raw upstream errors.
        await save({ ...stored, retryAt: Date.now() + 60_000 })
        observeLeaderboard(stored.checkpoint.head.blockNumber, stored.checkpoint.head.blockNumber, stored.checkpoint.head.blockNumber, 0, false, performance.now() - begun)
      }
    })().finally(() => pending.delete(key.url))
    pending.set(key.url, refresh)
    if (ctx) ctx.waitUntil(refresh)
    else await refresh // Deterministic direct/local invocation; production always supplies waitUntil.
  }
  observeCache('leaderboard', status, 200, performance.now() - start)
  return new Response(serializeData(stored.snapshot), { headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-world-cache': status, 'x-world-stale': String(stale), 'x-content-type-options': 'nosniff' } })
}
