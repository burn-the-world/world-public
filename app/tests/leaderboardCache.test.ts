import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedLeaderboard } from '../worker/leaderboardCache'
import { reduceAggregate } from '../worker/leaderboardIndex'
import { serializeData } from '../src/dataCodec'
import type { WorkerCache } from '../worker/shared'
import { A, H, checkpoint, take } from './leaderboardFixture'
function fixture() {
  const values = new Map<string, Response>(), jobs: Promise<unknown>[] = []
  const cache: WorkerCache = { match: async key => values.get(key.url)?.clone(), put: async (key, value) => { values.set(key.url, value.clone()) } }
  const initial = reduceAggregate(checkpoint(), take(), { blockNumber: 3n, blockHash: H, timestamp: 30n })
  const bootstrap = vi.fn(async () => structuredClone(initial))
  const sync = vi.fn(async (c: typeof initial) => ({ checkpoint: { ...c, head: { ...c.head, blockNumber: c.head.blockNumber + 1n } }, target: c.head.blockNumber + 1n, events: 0 }))
  const context = { waitUntil: (p: Promise<unknown>) => jobs.push(p) }
  const request = new Request('https://leaderboard.example/api/leaderboard')
  return { cache, values, jobs, bootstrap, sync, context, request }
}
describe('shared 10-minute leaderboard, stale while refresh', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_700_000_000_000) })
  afterEach(() => vi.useRealTimers())
  it('cold start immediately returns the verified bootstrap and uses only one background suffix', async () => {
    const f = fixture(), response = await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)
    expect(response.status).toBe(200); expect(response.headers.get('x-world-cache')).toBe('BOOTSTRAP')
    expect(await response.text()).not.toMatch(/events|transactionHash|args|openingBurn|attackProgressBurn/)
    await Promise.all(f.jobs); expect(f.bootstrap).toHaveBeenCalledTimes(1); expect(f.sync).toHaveBeenCalledTimes(1)
  })
  it('20 independent users inside one TTL share one upstream update', async () => {
    const f = fixture(); await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context); await Promise.all(f.jobs)
    for (let i = 0; i < 20; i++) expect((await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)).headers.get('x-world-cache')).toBe('HIT')
    expect(f.sync).toHaveBeenCalledTimes(1); expect(f.bootstrap).toHaveBeenCalledTimes(1)
  })
  it('20 simultaneous cold visitors coalesce bootstrap and refresh', async () => {
    const f = fixture()
    const responses = await Promise.all(Array.from({ length: 20 }, () => cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)))
    await Promise.all(f.jobs)
    expect(responses.every(r => r.status === 200)).toBe(true)
    expect(f.bootstrap).toHaveBeenCalledTimes(1); expect(f.sync).toHaveBeenCalledTimes(1)
  })
  it('expired snapshot remains visible while concurrent users coalesce refresh', async () => {
    const f = fixture(); await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context); await Promise.all(f.jobs)
    let resolve!: (v: any) => void
    f.sync.mockImplementation(() => new Promise(r => { resolve = r }))
    vi.setSystemTime(Date.now() + 600_001)
    const first = await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)
    const second = await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)
    expect(first.headers.get('x-world-stale')).toBe('true'); expect(await first.text()).toBe(await second.text())
    expect(f.sync).toHaveBeenCalledTimes(2)
    const next = await f.bootstrap.mock.results[0].value
    next.head = { ...next.head, blockNumber: 5n, timestamp: 50n }
    resolve({ checkpoint: next, target: 5n, events: 0 })
    await Promise.all(f.jobs)
    expect(await (await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)).text()).toContain('"$worldBigint":"5"')
  })
  it.each(['rpc', 'partial', 'reorg'])('never overwrites trusted results on %s failure; backs off', async kind => {
    const f = fixture(); await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context); await Promise.all(f.jobs)
    const before = await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)
    if (kind === 'rpc') f.sync.mockRejectedValue(new Error('test-only-private-diagnostic'))
    else f.sync.mockImplementation(async c => ({ checkpoint: kind === 'partial' ? { ...c, lands: [] } : { ...c, identity: { ...c.identity, chainId: 1 } }, target: c.head.blockNumber, events: 0 }))
    vi.setSystemTime(Date.now() + 600_001)
    await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context); await Promise.all(f.jobs)
    const after = await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)
    expect(after.status).toBe(200); expect(await after.text()).toBe(await before.text()); expect(f.sync).toHaveBeenCalledTimes(2)
    expect(serializeData([...f.values.keys()])).not.toContain('diagnostic')
    vi.setSystemTime(Date.now() + 59_000)
    await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)
    expect(f.sync).toHaveBeenCalledTimes(2)
  })
  it('never changes already FINAL credits or burns during a refresh', async () => {
    const f = fixture()
    const final = reduceAggregate(checkpoint(), [...take(), ...take(1n, A, A, 2n, 0n, 0n, 3n)], { blockNumber: 3n, blockHash: H, timestamp: 30n })
    f.bootstrap.mockResolvedValue(final)
    await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context); await Promise.all(f.jobs)
    const before = await (await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)).text()
    f.sync.mockImplementation(async c => { const copy = structuredClone(c); copy.reigns[0].earnedScaled += 1n; return { checkpoint: copy, target: c.head.blockNumber, events: 0 } })
    vi.setSystemTime(Date.now() + 600_001)
    await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context); await Promise.all(f.jobs)
    expect(await (await cachedLeaderboard(f.request, f.cache, f.bootstrap, f.sync, f.context)).text()).toBe(before)
  })
})
