import { i18n, setLanguage, t, useI18n } from './i18n'

export function LanguageSwitch() {
  useI18n()
  return <div className="language-switch" role="group" aria-label={t('languageLabel')}>
    <button lang="zh-CN" aria-pressed={i18n.language === 'zh-CN'} onClick={() => setLanguage('zh-CN')}>中文</button>
    <span aria-hidden="true">|</span>
    <button lang="en" aria-pressed={i18n.language === 'en'} onClick={() => setLanguage('en')}>EN</button>
  </div>
}
