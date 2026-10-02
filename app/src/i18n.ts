import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import zh from './locales/zh-CN.json'
import en from './locales/en.json'

export type Language = 'zh-CN' | 'en'
export type CopyKey = keyof typeof en
export const LANGUAGE_STORAGE_KEY = 'world:ui:language'
export const resources = { 'zh-CN': { translation: zh }, en: { translation: en } }
export function supportedLanguage(value?: string | null): Language | undefined {
  return value === 'en' || value === 'zh-CN' ? value : undefined
}
export function detectLanguage(search: string, stored?: string | null, browserLanguage?: string): Language {
  return supportedLanguage(new URLSearchParams(search).get('lang')) ?? supportedLanguage(stored)
    ?? (/^zh(?:-|$)/i.test(browserLanguage ?? '') ? 'zh-CN' : 'en')
}
function browserChoice(): Language {
  let stored: string | null = null
  try { stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY) } catch { /* Storage may be disabled. */ }
  return detectLanguage(window.location.search, stored, navigator.language)
}
export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({
  resources, lng: typeof window === 'undefined' ? 'zh-CN' : browserChoice(),
  fallbackLng: 'en', supportedLngs: ['zh-CN', 'en'], load: 'currentOnly',
  initAsync: false, interpolation: { escapeValue: false }, react: { useSuspense: false },
})
export const t = (key: CopyKey, values?: Record<string, unknown>): string => String(i18n.t(key, values))
export function useI18n() { useTranslation(undefined, { i18n }); return t }
export function languageUrl(url: string, language: Language): string {
  const next = new URL(url); next.searchParams.set('lang', language); return next.href
}
export function setLanguage(language: Language): void {
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language) } catch { /* UI still switches. */ }
    window.history.replaceState(window.history.state, '', languageUrl(window.location.href, language))
  }
  void i18n.changeLanguage(language)
}
if (typeof window !== 'undefined') {
  const updateDocument = () => { document.documentElement.lang = i18n.language; document.querySelector('meta[name=description]')?.setAttribute('content', t('metaDescription')) }
  updateDocument(); i18n.on('languageChanged', updateDocument)
  window.addEventListener('popstate', () => { void i18n.changeLanguage(browserChoice()) })
}

// Cached presentation messages may have been produced before the language changed.
// Only known UI messages are matched. Addresses, numeric values and Profile data are untouched.
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const messages = Object.entries(resources).flatMap(([, bundle]) => Object.entries(bundle.translation).map(([key, text]) => {
  const names: string[] = []
  const parts = text.split(/(\{\{\w+\}\})/)
  const pattern = parts.map(part => {
    if (!part.startsWith('{{')) return escapeRegex(part)
    names.push(part.slice(2, -2)); return '([\\s\\S]*?)'
  }).join('')
  return { key: key as CopyKey, text, names, pattern: new RegExp('^' + pattern + '$') }
})).filter(item => item.text.trim()).sort((a, b) => b.text.length - a.text.length)
export function knownMessage(value: string): boolean { return messages.some(item => item.pattern.test(value)) }
export function localizeMessage(value?: string): string {
  if (!value) return value ?? ''
  for (const message of messages) {
    const match = value.match(message.pattern)
    if (match) return t(message.key, Object.fromEntries(message.names.map((name, index) => [name, knownMessage(match[index + 1]) ? localizeMessage(match[index + 1]) : match[index + 1]])))
  }
  const hashSuffix = value.match(/^(.*?)(\s*·\s*0x[\da-f]+|…)$/i)
  if (hashSuffix && knownMessage(hashSuffix[1])) return localizeMessage(hashSuffix[1]) + hashSuffix[2]
  return value
}
