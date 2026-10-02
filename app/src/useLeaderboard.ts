import { useEffect, useState } from 'react'
import { t } from './i18n'
import type { LeaderboardView } from './leaderboard'
export function useLeaderboard(active: boolean, load?: () => Promise<Omit<LeaderboardView, 'loading'>>): LeaderboardView {
  const [view, setView] = useState<LeaderboardView>({ loading: false })
  useEffect(() => {
    if (!active || !load) return
    let cancelled = false
    const refresh = () => {
      setView(previous => ({ ...previous, loading: !previous.data }))
      void load().then(result => { if (!cancelled) setView({ ...result, loading: false }) })
        .catch(() => { if (!cancelled) setView(previous => ({ ...previous, loading: false, error: t('leaderboardUnavailable') })) })
    }
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [active, load])
  return view
}
