import { useI18n } from './i18n'
import type { ReactNode } from 'react'
import { formatUnits } from 'viem'
import { numeratorToWei, RESISTANCE_Q, TOKEN_UNIT } from './domain'
export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export function compactAmount(value?: bigint, decimals = 18, fraction = 4) {
  if (value === undefined) return '—'
  if (value === 0n) return '0'
  const [whole, tail = ''] = formatUnits(value, decimals).split('.')
  const trimmed = tail.slice(0, fraction).replace(/0+$/, '')
  if (whole === '0' && !trimmed) return `<0.${'0'.repeat(fraction - 1)}1`
  return BigInt(whole).toLocaleString('en-US') + (trimmed ? `.${trimmed}` : '')
}
export function compactReward(numerator: bigint, denominator?: bigint) {
  const wei = numeratorToWei(numerator, denominator)
  return numerator > 0n && wei === 0n ? '<0.000000000000000001' : compactAmount(wei, 18, 8)
}
/** Presentation only. Never converts a positive Q64 fraction into a displayed zero. */
/** Presentation only. Never converts a positive Q64 fraction into a displayed zero. */
export function compactResistance(raw?: bigint, fraction = 4) {
  if (raw === undefined) return '—'
  if (raw === 0n) return '0'
  if (raw < RESISTANCE_Q) return '<1 atom'
  const shown = compactAmount(raw * 10n ** BigInt(fraction) / (RESISTANCE_Q * TOKEN_UNIT), fraction, fraction)
  return shown === '0' ? `<0.${'0'.repeat(fraction - 1)}1` : shown
}
export function Icon({ name, size = 18 }: { name: string; size?: number }) { useI18n();
  const paths: Record<string, ReactNode> = {
    world: <><path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5M12 12v10M7.5 4.5l9 5"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></>,
    swords: <><path d="m4 3 5 1 11 13-3 3L4 8Z M14 5l6-2-2 6M4 20l6-7M2 16l6 6M16 14l6 6"/></>,
    wallet: <><path d="M20 7H5a2 2 0 0 1 0-4h13v4M4 7v13h17V7M21 12h-6v5h6"/><path d="M17 14.5h.1"/></>,
    history: <><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></>,
    book: <><path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1ZM12 5v15"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, external: <><path d="M14 3h7v7M21 3 10 14M10 4H4v16h16v-6"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    refresh: <path d="M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>,
    crown: <path d="m3 6 5 5 4-8 4 8 5-5-3 13H6ZM6 22h12"/>,
    shield: <><path d="m12 2 9 4v6c0 5-6 9-9 10-3-1-9-5-9-10V6Z"/><path d="m8 12 3 3 5-6"/></>,
    drop: <path d="M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13Z"/>,
    chevron: <path d="m8 5 7 7-7 7"/>, check: <path d="m4 12 5 5L20 6"/>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.world}</svg>
}
export function Metric({ label, value, unit, detail, accent = false }: { label: string; value: ReactNode; unit?: string; detail?: string; accent?: boolean }) { useI18n();
  return <div className={`metric ${accent ? 'metric-accent' : ''}`}><span className="metric-label">{label}</span><div className="metric-value">{value}<small>{unit}</small></div>{detail && <span className="metric-detail">{detail}</span>}</div>
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) { useI18n(); return <div className="empty-state"><Icon name="world" size={30}/><h3>{title}</h3>{children && <p>{children}</p>}</div> }
