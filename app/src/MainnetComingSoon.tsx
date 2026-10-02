import { t, useI18n } from './i18n'
import { LanguageSwitch } from './LanguageSwitch'

export function MainnetComingSoon() {
  useI18n()
  return <div className="app-shell"><header className="app-header"><a className="wordmark" href="#world">WORLD</a><div className="header-actions"><LanguageSwitch/><span className="network-label">BSC MAINNET · 56</span></div></header>
    <main className="main-content coming-soon"><span className="eyebrow">WORLD Mainnet</span><h1>Coming Soon</h1><p>{t('mainnetUnavailable')}</p>
      <div className="coming-soon-actions" aria-label={t('mainnetDisabledActions')}>{(['mainnetBuy', 'mainnetApprove', 'mainnetAttack', 'mainnetDefend', 'mainnetClaim', 'mainnetWithdraw', 'mainnetProfile', 'mainnetSettle'] as const).map(key => <button className="button secondary" disabled key={key}>{t(key)}</button>)}</div>
    </main></div>
}
