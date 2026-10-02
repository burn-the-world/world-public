import { t } from './i18n'
import { createReadCache } from './readTransport'
import { parseData } from './dataCodec'
import { LEADERBOARD_TTL, validateLeaderboard, type LeaderboardSnapshot } from './leaderboard'
import { B, W, N, RESISTANCE_HALF_LIFE, MAX_WAR_ATOMS, RESISTANCE_LIMIT, weightOf, validateResistance, minimumAttackAtoms, pendingNumerator, treasuryParts,
  type WorldSnapshot, type LandProfile, type ProfileLimits } from './domain'
import type { WorldReader } from './chain'

export function createSharedWorld(origin: string, reader: WorldReader, request = fetch) {
  const cache = createReadCache()
  function load<T>(path: string, ttl: number): Promise<T> {
    return cache.read(path, ttl, async () => {
      const response = await request(new URL('/api/' + path, origin), { signal: AbortSignal.timeout(25_000) })
      if (!response.ok) throw new Error('Shared RPC data unavailable')
      return parseData(await response.text()) as T
    })
  }
  function check(s: WorldSnapshot): WorldSnapshot {
    const c = reader.config, p = s.parameters, a = s.addresses
    if (typeof s.blockNumber !== 'bigint' || typeof s.timestamp !== 'bigint' || !/^0x[\da-f]{64}$/i.test(s.blockHash ?? '')
      || s.wallet || s.lands.length !== N || p.N !== N || p.W !== W || p.B !== B || p.T !== 5184000n
      || p.tokenUnit !== 10n ** 18n || p.worldPrice !== 10n ** 12n || p.resistanceHalfLife !== RESISTANCE_HALF_LIFE
      || p.maxWarAtoms !== MAX_WAR_ATOMS || p.resistanceLimit !== RESISTANCE_LIMIT
      || ![c.deploymentAddress, c.coreAddress, c.tokenAddress, c.profileAddress].every((v, i) => !v ||
        v.toLowerCase() === [a.deployment, a.core, a.token, a.profile][i]?.toLowerCase())) throw new Error('Shared instance mismatch')
    s.lands.forEach((land, i) => {
      validateResistance(land.resistanceRaw); validateResistance(land.currentResistanceRaw)
      if (typeof land.epoch !== 'bigint' || typeof land.j !== 'bigint' || !/^0x[\da-f]{40}$/i.test(land.controller)
        || land.id !== i + 1 || land.weight !== weightOf(land.id) || land.lastResistanceUpdate > s.timestamp
        || land.currentResistanceRaw > land.resistanceRaw || land.minimumAttackAtoms !== minimumAttackAtoms(land.currentResistanceRaw)) throw new Error('Invalid shared LAND')
      pendingNumerator(land, s.J)
    })
    treasuryParts(s.U, s.accountedBNB, p.B)
    reader.adoptShared(s)
    return s
  }
  return {
    snapshot: async () => check(await load<WorldSnapshot>('world-snapshot', 2_000)),
    constants: async () => { const value = await load<ProfileLimits>('constants', 86_400_000); reader.adoptLimits(value); return value },
    profiles: async (s: WorldSnapshot) => {
      const profiles = await load<Record<number, LandProfile>>('profiles', 30_000)
      return Object.fromEntries(s.lands.map(land => {
        const p = profiles[land.id]
        return [land.id, p?.controller.toLowerCase() === land.controller.toLowerCase() && p.epoch === land.epoch ? p :
          { status: 'unavailable', valid: false, controller: land.controller, epoch: land.epoch, name: '', logoURI: '', website: '' }]
      })) as Record<number, LandProfile>
    },
    leaderboard: () => cache.read('leaderboard', LEADERBOARD_TTL, async () => {
      const response = await request(new URL('/api/leaderboard', origin), { signal: AbortSignal.timeout(25_000) })
      if (!response.ok) throw new Error(t('leaderboardUnavailable'))
      return { data: validateLeaderboard(parseData(await response.text()) as LeaderboardSnapshot, reader.config.chainId, reader.config.coreAddress),
        stale: response.headers.get('x-world-stale') === 'true' }
    }),
  }
}
