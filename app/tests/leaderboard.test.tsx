import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '../src/App'
import { Leaderboard } from '../src/LeaderboardPage'
import { MIN_LEADERBOARD_BURN_ATOMS, controllerBurn, formatFraction, formatReturn, formatSettled, leaderboardSnapshot, rational, reignKey, validateLeaderboard } from '../src/leaderboard'
import { parseData, serializeData } from '../src/dataCodec'
import { reduceAggregate, validateCheckpoint } from '../worker/leaderboardIndex'
import { REWARD_DENOMINATOR as D, TOKEN_UNIT } from '../src/domain'
import { i18n } from '../src/i18n'
import { A, C, H, checkpoint, take, event } from './leaderboardFixture'
const head = (blockNumber = 10n) => ({ blockNumber, blockHash: H, timestamp: blockNumber * 10n })
describe('exact per-reign Return Leaderboard', () => {
  it('keeps multiple LANDs for the same controller separate', () => {
    const c = reduceAggregate(checkpoint(), [...take(), ...take(7n, A, undefined, 1n, 4n, 4n, 3n)], head())
    expect(c.reigns).toHaveLength(2); expect(c.reigns.map(reignKey).every(x => x.includes(A))).toBe(true)
    expect(leaderboardSnapshot(c).leaders.map(x => x.landId)).toEqual([7, 1])
  })
  it('assigns first treasure to epoch 1 and closing credits to the old reign across self and controller changes', () => {
    const c = reduceAggregate(checkpoint(), [...take(1n, A, undefined, 1n, 10n, 60n), ...take(1n, C, A, 2n, 20n, 60n, 3n),
      ...take(1n, C, C, 3n, 25n, 30n, 4n)], head())
    expect(c.reigns.map(x => [x.controller, x.epoch, x.earnedScaled, x.endedAt])).toEqual([[A, 1n, 120n, 30n], [C, 2n, 30n, 40n], [C, 3n, 0n, undefined]])
    expect(new Set(c.reigns.map(reignKey)).size).toBe(3)
  })
  it('only counts controller burns, with separate external support; failed pre-conquest attacks stay with their old reign', () => {
    const c = reduceAggregate(checkpoint(), [...take(7n, A, undefined, 1n, 0n, 0n, 2n, 10n),
      event('Defended', { id: 7n, epoch: 1n, supporter: C, amount: 4n }, 3n),
      event('Defended', { id: 7n, epoch: 1n, supporter: A, amount: 2n }, 4n),
      event('AttackProgress', { id: 7n, epoch: 1n, attacker: C, amount: 1n }, 5n),
      event('AttackProgress', { id: 7n, epoch: 1n, attacker: A, amount: 3n }, 6n),
      ...take(7n, C, A, 2n, 5n, 5n, 7n, 20n)], head())
    expect(controllerBurn(c.reigns[0])).toBe(15n); expect(c.reigns[0].externalSupportBurn).toBe(4n)
    expect(controllerBurn(c.reigns[1])).toBe(20n); expect(c.reigns[1].earnedScaled).toBe(0n)
    expect(c.reigns[0].earnedScaled).toBe(5n)
  })
  it('does not substitute withdrawal, present claimable, projected rewards or time for Earned', () => {
    let c = reduceAggregate(checkpoint(), take(7n, A, undefined, 1n, 10n, 10n), head(3n))
    const other = { ...event('Earned', {}, 4n), eventName: 'Withdrawn', args: { amountWei: 999999n } }
    c = reduceAggregate(c, [other], head())
    expect(c.reigns[0].earnedScaled).toBe(10n)
    expect(reduceAggregate(c, [], head(11n)).reigns[0].earnedScaled).toBe(10n)
  })
  it('sorts block, transaction and log indices before attributing same-block Earned and Taken', () => {
    const first = take(7n, A), self = take(7n, A, A, 2n, 9n, 4n, 3n)
    self.forEach(e => { e.transactionIndex = 1; e.logIndex += 5 })
    const settle = event('Earned', { id: 7n, beneficiary: A, J: 5n, delta: 5n }, 3n, 2, 0)
    const c = reduceAggregate(checkpoint(), [self[1], settle, first[1], self[0], first[0]], head())
    expect(c.reigns.map(r => r.earnedScaled)).toEqual([9n, 0n])
    expect(c.reigns[0].endedAt).toBe(30n)
  })
  it('permits repeated zero-credit settles and exact zero returns', () => {
    const c = reduceAggregate(checkpoint(), [...take(7n), event('Earned', { id: 7n, beneficiary: A, J: 0n, delta: 0n }, 3n)], head())
    expect(leaderboardSnapshot(c).leaders[0].returnMultiple).toEqual({ numerator: 0n, denominator: 1n })
    expect(formatReturn(rational(0n, 100n))).toBe('0×')
  })
  it('preserves a one-atom reign in the ledger but excludes its inflated return from the leaderboard', () => {
    const c = reduceAggregate(checkpoint(), take(7n, A, undefined, 1n, D, D, 2n, 1n), head())
    expect(controllerBurn(c.reigns[0])).toBe(1n)
    expect(c.reigns[0].earnedScaled).toBe(D)
    expect(rational(controllerBurn(c.reigns[0]) * c.worldPrice, c.tokenUnit)).toEqual({ numerator: 1n, denominator: 1000000n })
    expect(leaderboardSnapshot(c).leaders).toEqual([])
  })
  it('admits exactly 1 WORLD and more, but not one atom below the threshold', () => {
    const c = reduceAggregate(checkpoint(), [...take(7n, A, undefined, 1n, D, D, 2n, TOKEN_UNIT - 1n),
      ...take(8n, A, undefined, 1n, D, D, 3n, TOKEN_UNIT),
      ...take(9n, A, undefined, 1n, D, D, 4n, TOKEN_UNIT + 1n)], head())
    expect(MIN_LEADERBOARD_BURN_ATOMS).toBe(10n ** 18n)
    expect(leaderboardSnapshot(c).leaders.map(r => r.landId)).toEqual([8, 9])
    expect(c.reigns).toHaveLength(3)
  })
  it('qualifies only when cumulative controller burn reaches 1 WORLD; enemy attacks and external support do not qualify', () => {
    let c = reduceAggregate(checkpoint(), [...take(7n, A, undefined, 1n, 0n, 0n, 2n, TOKEN_UNIT / 2n),
      event('Defended', { id: 7n, epoch: 1n, supporter: C, amount: TOKEN_UNIT }, 3n),
      event('AttackProgress', { id: 7n, epoch: 1n, attacker: C, amount: TOKEN_UNIT }, 4n)], head(4n))
    expect(leaderboardSnapshot(c).leaders).toEqual([])
    c = reduceAggregate(c, [event('Defended', { id: 7n, epoch: 1n, supporter: A, amount: TOKEN_UNIT / 4n }, 5n)], head(5n))
    expect(leaderboardSnapshot(c).leaders).toEqual([])
    c = reduceAggregate(c, [event('AttackProgress', { id: 7n, epoch: 1n, attacker: A, amount: TOKEN_UNIT / 4n }, 6n)], head())
    expect(leaderboardSnapshot(c).leaders[0].controllerBurnAtoms).toBe(TOKEN_UNIT)
    expect(c.reigns[0].externalSupportBurn).toBe(TOKEN_UNIT)
  })
  it('does not combine sub-threshold self-takeover epochs to qualify the same controller', () => {
    const c = reduceAggregate(checkpoint(), [...take(7n, A, undefined, 1n, 0n, 0n, 2n, TOKEN_UNIT / 2n),
      ...take(7n, A, A, 2n, 0n, 0n, 3n, TOKEN_UNIT / 2n)], head())
    expect(c.reigns).toHaveLength(2)
    expect(leaderboardSnapshot(c).leaders).toEqual([])
  })
  it('filters sub-threshold high multiples before selecting the top 25', () => {
    const c = checkpoint()
    for (let id = 7; id <= 36; id++) {
      Object.assign(c, reduceAggregate(c, take(BigInt(id), A, undefined, 1n, D, D, BigInt(id + 1), 1n), head(BigInt(id + 1))))
    }
    Object.assign(c, reduceAggregate(c, take(37n, A, undefined, 1n, D, D, 38n), head(38n)))
    expect(leaderboardSnapshot(c).leaders.map(r => r.landId)).toEqual([37])
  })
  it.each(['missing-earned', 'epoch', 'beneficiary', 'delta', 'duplicate', 'rollback', 'missing-treasure-taken', 'burn-epoch', 'burn-zero', 'tx-log-order'])('rejects %s without changing the trusted prefix', kind => {
    const c = checkpoint(), before = serializeData(c), events = take()
    if (kind === 'missing-earned') events.shift()
    if (kind === 'epoch') events[1].args.epoch = 2n
    if (kind === 'beneficiary') events[0].args.beneficiary = C
    if (kind === 'delta') events[0].args.delta = 1n
    if (kind === 'duplicate') events.push(events[0])
    if (kind === 'missing-treasure-taken') events.pop()
    if (kind === 'burn-epoch') events.push(event('Defended', { id: 1n, epoch: 2n, supporter: A, amount: 1n }, 3n))
    if (kind === 'burn-zero') events[1].args.amount = 0n
    if (kind === 'tx-log-order') events[0].transactionIndex = 1
    expect(() => reduceAggregate(c, events, head(kind === 'rollback' ? 0n : 3n))).toThrow()
    expect(serializeData(c)).toBe(before)
  })
  it('sorts enormous close fractions without float conversion, even when display multiples tie', () => {
    const n = 2n ** 220n, c = reduceAggregate(checkpoint(), [...take(7n, A, undefined, 1n, n, n, 2n),
      ...take(8n, C, undefined, 1n, n + 1n, n + 1n, 3n)], head())
    const rows = leaderboardSnapshot(c).leaders
    expect(rows.map(x => x.landId)).toEqual([8, 7])
    expect(formatReturn(rows[0].returnMultiple)).toBe(formatReturn(rows[1].returnMultiple))
    expect(parseData(serializeData(c))).toEqual(c)
    expect(() => parseData('{"n":{"$worldBigint":"1.5"}}')).toThrow()
  })
  it.each([[287n, 100n, '2.87×'], [204n, 10n, '20.4×'], [65n, 100n, '0.65×'], [1n, 1n, '1×'],
    [100n, 1n, '100×'], [1000n, 1n, '1000×'], [1n, 10000n, '<0.01×']] as const)('formats %s/%s with integer rounding', (n, d, label) => expect(formatReturn(rational(n, d))).toBe(label))
  it('uses deterministic exact ties and top 25 without merging a controller', () => {
    const c = checkpoint()
    for (let id = 7; id < 37; id++) {
      const next = reduceAggregate(c, take(BigInt(id), A, undefined, 1n, 0n, 0n, BigInt(id)), head(BigInt(id)))
      Object.assign(c, next)
    }
    expect(leaderboardSnapshot(c).leaders).toHaveLength(25)
    expect(leaderboardSnapshot(c).leaders[0].landId).toBe(7)
  })
  it.each(['chain', 'fraction', 'negative', 'duplicate', 'sorted', 'zero-denominator', 'below-threshold', 'status'])('rejects malformed public %s', kind => {
    const s = leaderboardSnapshot(reduceAggregate(checkpoint(), [...take(), ...take(7n, A, undefined, 1n, 1n, 1n, 3n)], head()))
    if (kind === 'chain') s.chainId = 56
    if (kind === 'fraction') s.leaders[0].returnMultiple.numerator += 1n
    if (kind === 'negative') s.leaders[0].earnedScaled = -1n
    if (kind === 'duplicate') s.leaders.push(s.leaders[0])
    if (kind === 'sorted') s.leaders.reverse()
    if (kind === 'zero-denominator') s.leaders[0].controllerBurnAtoms = 0n
    if (kind === 'below-threshold') s.leaders[0].controllerBurnAtoms = TOKEN_UNIT - 1n
    if (kind === 'status') s.leaders[0].status = 'FINAL'
    expect(() => validateLeaderboard(s, 97)).toThrow()
  })
  it('rejects price drift, missing reigns and broken end boundaries', () => {
    const c = reduceAggregate(checkpoint(), take(), head())
    expect(() => validateCheckpoint({ ...c, worldPrice: 1n })).toThrow()
    expect(() => validateCheckpoint({ ...c, reigns: [] })).toThrow()
    c.reigns[0].endedAt = 40n; expect(() => validateCheckpoint(c)).toThrow()
  })
  it('replays the audited Testnet sample: LAND #1 100 WORLD / exact settled credit / 2.870654162x', () => {
    const data = parseData(fs.readFileSync('tests/fixtures/reign-audit.json', 'utf8')) as any
    const start = checkpoint()
    start.identity = data.identity; start.head = { blockNumber: data.identity.deploymentBlock, blockHash: data.identity.deploymentBlockHash, timestamp: data.deploymentTimestamp }
    const c = reduceAggregate(start, data.events, { blockNumber: data.target, blockHash: data.targetHash, timestamp: data.timestamp })
    const crown = c.reigns.find(r => r.landId === 1)!
    expect(controllerBurn(crown)).toBe(100n * TOKEN_UNIT)
    expect(crown.earnedScaled).toBe(1478338254128624748658651337084338858077999858n)
    const row = leaderboardSnapshot(c).leaders[0]
    expect(row.landId).toBe(1); expect(formatSettled(row.earnedScaled, 18)).toBe('0.000287065416215324')
    expect(formatFraction(row.returnMultiple.numerator, row.returnMultiple.denominator, 9)).toBe('2.870654162')
    expect(formatReturn(row.returnMultiple)).toBe('2.87×')
    c.lands.forEach((land, i) => { expect(land.controller.toLowerCase()).toBe(data.currentLands[i][0].toLowerCase()); expect(land.epoch).toBe(data.currentLands[i][3]); expect(land.j).toBe(data.currentLands[i][4]) })
  })
  it.each(['en', 'zh-CN'])('renders %s single ranking with LIVE/FINAL and no full History', async lang => {
    await i18n.changeLanguage(lang)
    const c = reduceAggregate(checkpoint(), [...take(), ...take(1n, A, A, 2n, 0n, 0n, 3n)], head())
    const s = leaderboardSnapshot(c)
    const profiles = { 1: { status: 'available' as const, valid: true, controller: A, epoch: 2n, name: 'Rabbit Hole', logoURI: '', website: '' } }
    const html = renderToStaticMarkup(<Leaderboard nativeSymbol="tBNB" onLand={() => {}} profiles={profiles} view={{ loading: false, data: s, stale: true }}/>)
    expect(html).not.toMatch(/ranking-categories|event-list|reign-detail|Current LANDs|Longest Reign/)
    expect(html).not.toMatch(/ranking-basis|ranking-exact|<details|<summary|Protocol cost basis|协议成本口径/)
    expect(html).toContain('1 WORLD')
    expect(html).toContain('LIVE'); expect(html).toContain('FINAL')
    expect(html.match(/Rabbit Hole/g)).toHaveLength(1)
    expect(html).toContain(lang === 'en' ? 'Return so far' : '截至目前的倍数')
    expect(html).toContain(lang === 'en' ? 'Last updated' : '更新于')
    const p = { config: { chainId: 97, nativeSymbol: 'tBNB' }, profiles: {}, loading: false, busy: false } as any
    const app = renderToStaticMarkup(<App {...p}/>); expect(app).not.toContain('history-scope'); expect(app).not.toContain('frontline-event')
    expect(app).not.toContain(lang === 'en' ? '>History<' : '>历史<')
    await i18n.changeLanguage('zh-CN')
  })
})
