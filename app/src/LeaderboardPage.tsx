import { t, useI18n } from './i18n'
import { shortAddress, TOKEN_UNIT, type LandProfile } from './domain'
import { formatFraction, formatReturn, formatSettled, reignKey, type LeaderboardView } from './leaderboard'
import { Empty } from './ui'
import './leaderboard.css'
export function Leaderboard({ view, onLand, nativeSymbol, profiles = {} }: {
  view?: LeaderboardView; onLand: (id: number) => void; nativeSymbol: string; profiles?: Record<number, LandProfile>
}) {
  useI18n()
  const rows = view?.data?.leaders ?? []
  return <section className="leaderboard" aria-labelledby="leaderboard-title">
    <div className="page-heading"><span className="eyebrow">WORLD</span><h1 id="leaderboard-title">{t('returnLeaderboard')}</h1></div>
    {view?.error && <p className="microcopy" role="status">{t('leaderboardUnavailable')}</p>}
    {!view?.data ? <Empty title={view?.loading ? t('leaderboardLoading') : t('leaderboardUnavailable')}/> : !rows.length ? <Empty title={t('leaderboardEmpty')}/> :
      <ol className="ranking-list">{rows.map((row, i) => {
        const profile = profiles[row.landId]
        // A current name never labels a previous controller's reign.
        const name = row.status === 'LIVE' && profile?.valid && profile.epoch === row.epoch
          && profile.controller.toLowerCase() === row.controller.toLowerCase() ? profile.name : ''
        return <li className="ranking-row" key={reignKey(row)} data-reign-key={reignKey(row)}>
          <span className="ranking-position" aria-label={t('returnRank', { rank: i + 1 })}>{String(i + 1).padStart(2, '0')}</span>
          <div className="ranking-identity">
            <button className="ranking-land-link" onClick={() => onLand(row.landId)}><span>LAND #{row.landId}</span>{name && <strong>{name}</strong>}</button>
            <div className="ranking-controller"><span title={row.controller}>{shortAddress(row.controller)}</span><span>{t('returnEpoch', { epoch: row.epoch.toString() })}</span><span className={`reign-status ${row.status.toLowerCase()}`}>{row.status}</span></div>
            <dl className="ranking-amounts">
              <div><dt>{t('returnBurned')}</dt><dd title={formatFraction(row.controllerBurnAtoms, TOKEN_UNIT, 18) + ' WORLD'}>{formatFraction(row.controllerBurnAtoms, TOKEN_UNIT, 6)} <small>WORLD</small></dd></div>
              <div><dt>{t('returnSettled')}</dt><dd title={formatSettled(row.earnedScaled, 24) + ' ' + nativeSymbol}>{formatSettled(row.earnedScaled)} <small>{nativeSymbol}</small></dd></div>
            </dl>
          </div>
          <div className="ranking-return"><strong className="ranking-value">{formatReturn(row.returnMultiple)}</strong><span>{t(row.status === 'LIVE' ? 'returnSoFar' : 'returnFinal')}</span></div>
        </li>
      })}</ol>}
    {view?.data && <p className="ranking-reference-note">{t('leaderboardUpdated', { time: new Date(Number(view.data.updatedAt) * 1000).toLocaleString(), block: view.data.indexedThroughBlock.toString() })}{view.stale && ` · ${t('leaderboardStale')}`}</p>}
    <p className="microcopy">{t('leaderboardCacheNote')}</p>
  </section>
}
