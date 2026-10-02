// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { zeroAddress, type Address } from 'viem'
import App from '../src/App'
import { LandDetail, WalletGate, WithdrawForm } from '../src/Transactions'
import { Leaderboard } from '../src/LeaderboardPage'
import { B, W, TOKEN_UNIT, RESISTANCE_Q, RESISTANCE_LIMIT, MAX_WAR_ATOMS, weightOf } from '../src/domain'
import { worldErrorMessage, type WorldAction } from '../src/chain'
import type { AppProps } from '../src/uiTypes'
import { detectLanguage, i18n, LANGUAGE_STORAGE_KEY, languageUrl, localizeMessage, resources, setLanguage, t } from '../src/i18n'

const alice = '0x1111111111111111111111111111111111111111' as Address
const core = '0x2222222222222222222222222222222222222222' as Address
const token = '0x3333333333333333333333333333333333333333' as Address
const profile = '0x4444444444444444444444444444444444444444' as Address
function fixture(): AppProps {
  return {
    account: alice, walletChainId: 97, loading: false, busy: false,
    config: { chainId: 97, rpcUrl: '/rpc', nativeSymbol: 'tBNB', deploymentAddress: core, deploymentBlock: 1n, recentBlockWindow: 5000n },
    snapshot: {
      blockNumber: 42n, timestamp: 1700000000n, U: 0n, J: B * TOKEN_UNIT, accountedBNB: TOKEN_UNIT, coreNativeBalance: TOKEN_UNIT,
      totalSupply: 10000n * TOKEN_UNIT, coreWorldBalance: 0n,
      parameters: { N: 50, W, B, T: 5184000n, worldPrice: 10n ** 12n, tokenUnit: TOKEN_UNIT, resistanceHalfLife: 3888000n, maxWarAtoms: MAX_WAR_ATOMS, resistanceLimit: RESISTANCE_LIMIT },
      addresses: { core, token, profile, deployment: core },
      lands: Array.from({ length: 50 }, (_, index) => ({ id: index + 1, weight: weightOf(index + 1), controller: index ? zeroAddress : alice,
        resistanceRaw: index ? 0n : 100n * TOKEN_UNIT * RESISTANCE_Q, currentResistanceRaw: index ? 0n : 100n * TOKEN_UNIT * RESISTANCE_Q,
        minimumAttackAtoms: index ? 1n : 100n * TOKEN_UNIT + 1n, lastResistanceUpdate: 1699999999n, epoch: index ? 0n : 7n, j: 0n })),
      wallet: { address: alice, balance: 10000n * TOKEN_UNIT, allowance: 10000n * TOKEN_UNIT, nativeBalance: 10n * TOKEN_UNIT, claimable: TOKEN_UNIT * W * B },
    },
    profiles: { 1: { status: 'available', valid: true, controller: alice, epoch: 7n, name: '玩家中文 PEPE', logoURI: '', website: '' } },
    profileLimits: { name: 64, logoURI: 256, website: 256 },
    connect: vi.fn(async () => {}), disconnect: vi.fn(), switchChain: vi.fn(async () => {}), refresh: vi.fn(async () => {}),
    quoteBuy: vi.fn(async amount => amount * 10n ** 12n / TOKEN_UNIT), onAction: vi.fn(async (_action: WorldAction) => true),
  }
}
let root: Root | undefined, host: HTMLDivElement | undefined
beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); history.replaceState(null, '', '/')
  await i18n.changeLanguage('zh-CN')
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { if (root) await act(() => root!.unmount()); host?.remove(); root = undefined; host = undefined; await i18n.changeLanguage('zh-CN') })
async function mount(element: React.ReactNode) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(() => root!.render(element)) }
async function click(label: string, selector = 'button') {
  const target = Array.from(host!.querySelectorAll<HTMLElement>(selector)).find(node => node.textContent?.trim() === label)
  expect(target, `Control ${label}`).toBeTruthy(); await act(() => target!.click())
}

describe('language selection and resources', () => {
  it.each(['zh-CN', 'zh-TW', 'zh-HK', 'zh'])('defaults Chinese browser %s to zh-CN', browser => expect(detectLanguage('', null, browser)).toBe('zh-CN'))
  it.each(['en-US', 'fr-FR', 'ja-JP', ''])('defaults other browser %s to English', browser => expect(detectLanguage('', null, browser)).toBe('en'))
  it('stored choice overrides browser language', () => expect(detectLanguage('', 'en', 'zh-CN')).toBe('en'))
  it('lang=en overrides a Chinese stored choice', () => expect(detectLanguage('?foo=1&lang=en', 'zh-CN', 'zh-CN')).toBe('en'))
  it('lang=zh-CN overrides an English stored choice', () => expect(detectLanguage('?lang=zh-CN', 'en', 'en-US')).toBe('zh-CN'))
  it('invalid URL and stored languages fall back to the browser', () => expect(detectLanguage('?lang=de', 'xx', 'zh-CN')).toBe('zh-CN'))
  it('keeps unrelated query values and the hash', () => expect(languageUrl('https://world.example/?land=17&x=a%2Bb#map', 'en')).toBe('https://world.example/?land=17&x=a%2Bb&lang=en#map'))
  it('resources have equal keys and identical interpolation variables', () => {
    const zh = resources['zh-CN'].translation, en = resources.en.translation
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(en[key].match(/\{\{\w+\}\}/g)?.sort() ?? []).toEqual(zh[key].match(/\{\{\w+\}\}/g)?.sort() ?? [])
  })
  it('English contains no Chinese except the native language control', () => {
    for (const [key, value] of Object.entries(resources.en.translation)) if (key !== 'languageChinese') expect(value, key).not.toMatch(/[\u3400-\u9fff]/)
  })
  it('keeps exact bigint data in interpolated copy', () => { const value = (1n << 255n).toString(); expect(t('copy315', { v0: value })).toContain(value) })
})

describe('React switching and transaction UI', () => {
  it('renders Chinese labels and the unchanged player Profile', async () => { await mount(<App {...fixture()}/>); expect(host!.textContent).toContain('世界战场'); expect(host!.textContent).toContain('玩家中文 PEPE') })
  it('switches all navigation and dialogs to English without RPC refresh', async () => {
    const p = fixture(); await mount(<App {...p}/>); await click('EN')
    expect(host!.textContent).toContain('World Battlefield'); expect(host!.querySelector('.main-nav')!.textContent).toContain('My World')
    expect(host!.textContent).toContain('玩家中文 PEPE'); expect(p.refresh).not.toHaveBeenCalled(); expect(p.onAction).not.toHaveBeenCalled()
    expect(document.documentElement.lang).toBe('en'); expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
    expect(location.search).toBe('?lang=en'); await click('Buy WORLD'); expect(host!.querySelector('[role=dialog]')!.getAttribute('aria-label')).toBe('Buy WORLD')
  })
  it('switches back and keeps URL parameters', async () => { history.replaceState(null, '', '/?land=3#map'); await mount(<App {...fixture()}/>); await click('EN'); await click('中文'); expect(location.search).toContain('land=3'); expect(location.search).toContain('lang=zh-CN'); expect(location.hash).toBe('#map'); expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh-CN') })
  it('persists the manual choice for the next detection', async () => { await act(() => setLanguage('en')); expect(detectLanguage('', localStorage.getItem(LANGUAGE_STORAGE_KEY), 'zh-CN')).toBe('en') })
  it('responds to URL popstate without remounting gameplay', async () => { await mount(<App {...fixture()}/>); history.replaceState(null, '', '/?lang=en'); await act(() => window.dispatchEvent(new PopStateEvent('popstate'))); expect(host!.textContent).toContain('World Battlefield') })
  it.each(['zh-CN', 'en'] as const)('Buy WORLD in %s keeps the exact quote and transaction amount', async lang => {
    await i18n.changeLanguage(lang); const p = fixture(); await mount(<App {...p}/>); await click(t('copy026')); await act(async () => { await new Promise(resolve => setTimeout(resolve, 280)) })
    const modal = host!.querySelector('[role=dialog]')!; const buy = Array.from(modal.querySelectorAll('button')).find(node => node.textContent?.includes(t('copy026')))!
    expect(buy.disabled).toBe(false); await act(() => buy.click()); expect(p.onAction).toHaveBeenCalledWith({ kind: 'buy', amount: 1000n * TOKEN_UNIT, quotedCost: 10n ** 15n })
  })
  it.each(['zh-CN', 'en'] as const)('Attack and Defend in %s keep amounts and expectedEpoch', async lang => {
    await i18n.changeLanguage(lang); const p = fixture(); await mount(<LandDetail p={p} id={1} onClose={() => {}} onWithdraw={() => {}}/>);
    const before = host!.textContent!; expect(before).toContain(t('copy484')); await click(t('copy496'))
    expect(p.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'attack', amount: 100n * TOKEN_UNIT, expectedEpoch: 7n, expectedResistanceRaw: 100n * TOKEN_UNIT * RESISTANCE_Q, expectedLastResistanceUpdate: 1699999999n }))
    await click(t('copy474')); await click(t('copy497')); expect(p.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'defend', amount: 100n * TOKEN_UNIT, expectedEpoch: 7n }))
  })
  it.each(['zh-CN', 'en'] as const)('Claim settlement and withdrawal in %s retain their separate actions', async lang => {
    await i18n.changeLanguage(lang); const p = fixture(); await mount(<WithdrawForm p={p} onLand={() => {}}/>); await click(t('copy451')); expect(p.onAction).toHaveBeenLastCalledWith({ kind: 'settle', id: 1 })
    await click(t('copy448') + ' tBNB'); expect(p.onAction).toHaveBeenLastCalledWith({ kind: 'withdraw' })
  })
  it('English Wallet gate connects the same provider', async () => { await i18n.changeLanguage('en'); const p = fixture(); p.account = undefined; await mount(<WalletGate p={p}/>); await click('Connect Wallet to Play'); expect(p.connect).toHaveBeenCalledOnce() })
  it('English wrong-network gate uses the existing switch callback', async () => { await i18n.changeLanguage('en'); const p = fixture(); p.walletChainId = 56; await mount(<WalletGate p={p}/>); await click("Switch to This World's Network"); expect(p.switchChain).toHaveBeenCalledOnce(); expect(p.onAction).not.toHaveBeenCalled() })
  it('Profile edits preserve user text and the epoch across switching', async () => {
    const p = fixture(); await mount(<LandDetail p={p} id={1} onClose={() => {}} onWithdraw={() => {}}/>); await click(t('profileNameTab')); await act(() => setLanguage('en'))
    expect((host!.querySelector('#profile-name') as HTMLInputElement).value).toBe('玩家中文 PEPE'); await click('Save')
    expect(p.onAction).toHaveBeenCalledWith({ kind: 'profile', id: 1, expectedEpoch: 7n, name: '玩家中文 PEPE' })
  })
})

describe('friendly states, cached messages and safe errors', () => {
  it.each(['zh-CN', 'en'] as const)('loading and unavailable leaderboard in %s use resources', async lang => {
    await i18n.changeLanguage(lang)
    expect(renderToStaticMarkup(<Leaderboard onLand={() => {}} nativeSymbol="tBNB" view={{loading:true}}/>)).toContain(t('leaderboardLoading'))
    expect(renderToStaticMarkup(<Leaderboard onLand={() => {}} nativeSymbol="tBNB" view={{loading:false,error:'unavailable'}}/>)).toContain(t('leaderboardUnavailable'))
  })
  it('relocalizes a cached error, pending Tx Hash without retaining event-feed translations', async () => {
    const error = worldErrorMessage(new Error('IncorrectPayment()'))
    const pending = t('copy307') + ' · 0x' + 'ab'.repeat(32)
    await i18n.changeLanguage('en')
    expect(localizeMessage(error)).toContain('Payment amount does not match'); expect(localizeMessage(pending)).toContain('Waiting for chain confirmation · 0x')
  })
  it.each(['IncorrectPayment', 'NotController', 'ERC20InsufficientBalance', 'ERC20InsufficientAllowance', 'StaleEpoch'])('maps %s into a friendly English error', async name => {
    await i18n.changeLanguage('en'); const text = worldErrorMessage(new Error(`execution reverted: ${name}()`)); expect(text).not.toContain(name); expect(text).not.toMatch(/[\u3400-\u9fff]/)
  })
  it('maps MetaMask rejection and pending authorization codes', async () => { await i18n.changeLanguage('en'); expect(worldErrorMessage(Object.assign(new Error('User rejected request'), { code: 4001 }))).toContain('cancelled'); expect(worldErrorMessage({ code: -32002 })).toContain('already pending') })
  it('never shows raw RPC credentials or raw contract failures', async () => {
    await i18n.changeLanguage('en'); const text = worldErrorMessage(new Error('HTTP request failed: https://rpc.invalid/private/example-secret-only'))
    expect(text).not.toContain('example-secret-only'); expect(text).not.toContain('https://'); expect(worldErrorMessage(new Error('execution reverted at raw address'))).toBe(t('contractFailure'))
  })
})
