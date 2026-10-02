import type { Address } from 'viem'
import type { WorldConfig } from './config'
import type { WorldAction } from './chain'
import type { WorldSnapshot, LandProfile } from './domain'
import type { LeaderboardView } from './leaderboard'
export interface AppProps {
  landObservations?: Record<number, import('./readView').LandObservation>
  liveSnapshot?: WorldSnapshot; liveStats?: WorldSnapshot
  onSelectLand?: (id?: number) => void; onPageChange?: (page: string) => void
  snapshot?: WorldSnapshot; profiles: Record<number, LandProfile>
  profileLimits?: { name: number; logoURI: number; website: number }; profileError?: string
  leaderboard?: LeaderboardView
  account?: Address; walletChainId?: number; config: WorldConfig
  loading: boolean; busy: boolean; error?: string; status?: string
  stale?: boolean
  connect: () => Promise<void>; disconnect: () => void; switchChain: () => Promise<void>
  refresh: () => Promise<void>; quoteBuy: (q: bigint) => Promise<bigint>
  onAction: (action: WorldAction) => Promise<boolean>
}
