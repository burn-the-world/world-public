import { t, useI18n } from './i18n'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createWalletClient, custom, defineChain, getAddress, parseEventLogs, type Address, type EIP1193Provider } from 'viem'
import App from './App'
import { createWorldReader, executeWorldAction, worldErrorMessage, type WorldAction } from './chain'
import { coreAbi } from './abi'
import { loadConfig, networkConfig, deploymentConfigured, transactionsEnabled } from './config'
import activeNetwork from '@world-network'
import type { LandProfile, WorldSnapshot } from './domain'
import type { AppProps } from './uiTypes'
import { useLeaderboard } from './useLeaderboard'
import './styles.css'
import { createSharedWorld } from './sharedWorld'
import { readLiveView, readLiveProfile } from './liveView'
import { observedRollback } from './readView'
import { createReadMetrics } from './readMetrics'
type Injected = EIP1193Provider & { on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void }
declare global { interface Window { ethereum?: Injected; worldReadMetrics?: Pick<ReturnType<typeof createReadMetrics>, 'snapshot' | 'reset'> } }
function bootstrap() {
  const env = import.meta.env as unknown as Record<string, string | undefined>
  if (import.meta.env.DEV && env.VITE_CHAIN_ID && !['56', '97'].includes(env.VITE_CHAIN_ID)) {
    try { return { config: loadConfig(env), error: undefined as string | undefined } }
    catch (error) { return { config: networkConfig(activeNetwork, new URL('/rpc', location.origin).href), error: worldErrorMessage(error) } }
  }
  return { config: networkConfig(activeNetwork, new URL('/rpc', location.origin).href), error: undefined as string | undefined }
}
const initial = bootstrap(), config = initial.config
const configured = config.network ? deploymentConfigured(config) && transactionsEnabled(config) : !!config.deploymentAddress
let activeReadProvider: Injected | undefined
const readMetrics = createReadMetrics(), observedFetch = readMetrics.fetch()
window.worldReadMetrics = { snapshot: readMetrics.snapshot, reset: readMetrics.reset }
const reader = createWorldReader(config, { walletProvider: () => activeReadProvider,
  fetchFn: observedFetch, observeWalletRead: readMetrics.wallet })
const shared = config.network ? createSharedWorld(location.origin, reader, observedFetch) : undefined
const loadLeaderboard = (shared ?? createSharedWorld(location.origin, reader, observedFetch)).leaderboard
const walletChain = defineChain({ id: config.chainId, name: config.networkName ?? 'WORLD Local BSC Candidate', nativeCurrency: { name: config.nativeSymbol, symbol: config.nativeSymbol, decimals: 18 }, rpcUrls: { default: { http: [config.walletRpcUrl ?? config.rpcUrl] } }, ...(config.explorerUrl ? { blockExplorers: { default: { name: 'BscScan', url: config.explorerUrl } } } : {}) })
function WorldApplication() { useI18n();
  const [account, setAccount] = useState<Address>(), [walletChainId, setWalletChainId] = useState<number>()
  const [snapshot, setSnapshot] = useState<WorldSnapshot>()
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const leaderboard = useLeaderboard(leaderboardOpen, loadLeaderboard)
  const [landObservations, setLandObservations] = useState<Record<number, import('./readView').LandObservation>>({})
  const [liveSnapshot, setLiveSnapshot] = useState<WorldSnapshot>()
  const [liveStats, setLiveStats] = useState<WorldSnapshot>()
  const selectedRef = useRef<number | undefined>(undefined)
  const liveVersion = useRef(0)
  const [profiles, setProfiles] = useState<Record<number, LandProfile>>({})
  const [profileLimits, setProfileLimits] = useState<AppProps['profileLimits']>()
  const [profileReadError, setProfileReadError] = useState<string>(), [profileLimitError, setProfileLimitError] = useState<string>()
  const profileError = profileLimitError ?? profileReadError
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
  const [lastReadAt, setLastReadAt] = useState(0), [nowMs,setNowMs] = useState(Date.now())
  const stale = !!snapshot && nowMs - lastReadAt > 45_000
  const [error, setError] = useState(initial.error), [actionError, setActionError] = useState<string>(), [status, setStatus] = useState<string>()
  const accountRef = useRef(account)
  const walletChainRef = useRef(walletChainId)
  // Events invalidate older provider reads; explicit user actions invalidate older connect/switch flows.
  const walletRevision = useRef(0), walletIntent = useRef(0)
  const inFlight = useRef(false), activeReads = useRef(0), version = useRef(0), ignoreAccounts = useRef(false)
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot
  const refresh = useCallback(async (affectedIds?: number[]) => {
    if (!configured || initial.error || account !== accountRef.current) return
    const request = ++version.current; ++activeReads.current; setLoading(true)
    const current = () => request === version.current && account === accountRef.current
    try {
      const publicSnapshot = shared ? await shared.snapshot().catch(() => reader.readSnapshot())
        : await reader.readSnapshot(undefined, snapshotRef.current, affectedIds)
      const next = account ? { ...publicSnapshot, wallet: (await readLiveView(reader, publicSnapshot, account)).wallet } : publicSnapshot
      if (!current()) return
      const rollback = observedRollback(snapshotRef.current, publicSnapshot)
      if (rollback) { ++liveVersion.current; setLiveSnapshot(undefined) }
      setLandObservations(previous => rollback ? {} : Object.fromEntries(Object.entries(previous).filter(([, observation]) => observation.blockNumber > publicSnapshot.blockNumber)))
      setLiveStats(previous => !rollback && previous && previous.blockNumber > publicSnapshot.blockNumber ? previous : undefined)
      snapshotRef.current = next; setSnapshot(next); performance.mark('world:snapshot-ready'); setLoading(false); setLastReadAt(Date.now()); setError(undefined)
      setProfileReadError(undefined); setProfileLimitError(undefined)
      // Metadata and Profile limits load independently of the leaderboard.
      await Promise.allSettled([
        (shared ? shared.profiles(next).catch(() => reader.readProfiles(next)) : reader.readProfiles(next)).then(value => {
          if (current()) { performance.mark('world:profiles-ready'); setProfiles(value); setProfileReadError(undefined) }
        }).catch(failure => {
          if (current()) { setProfiles({}); setProfileReadError(worldErrorMessage(failure)) }
        }),
        (shared ? shared.constants().catch(() => reader.readProfileLimits(next)) : reader.readProfileLimits(next)).then(value => {
          if (current()) { setProfileLimits(value); setProfileLimitError(undefined) }
        }).catch(failure => {
          if (current()) { setProfileLimits(undefined); setProfileLimitError(worldErrorMessage(failure)) }
        }),
      ])
      if (!current()) return
      if (selectedRef.current !== undefined) void refreshLive(selectedRef.current)

    } catch (failure) {
      if (current()) { snapshotRef.current = undefined; setSnapshot(undefined); setProfiles({}); setError(worldErrorMessage(failure)) }
    } finally { --activeReads.current; if (request === version.current) setLoading(false) }
  }, [account])
  const refreshRef = useRef(refresh); refreshRef.current = refresh
  useEffect(() => { const timer=setInterval(()=>setNowMs(Date.now()),5000); return ()=>clearInterval(timer) },[])
  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => { if (!inFlight.current && !activeReads.current && document.visibilityState === 'visible') void refresh() }, 15000)
    return () => { clearInterval(interval); ++version.current }
  }, [refresh])
  function clearView() {
    ++version.current; ++liveVersion.current; setLiveSnapshot(undefined); setLiveStats(undefined); setLandObservations({}); snapshotRef.current = undefined; setSnapshot(undefined); setProfiles({})
    setProfileLimits(undefined); setProfileReadError(undefined); setProfileLimitError(undefined)
    setActionError(undefined); setLoading(false)
  }
  function parseAccounts(value: unknown): Address | undefined {
    const addresses = Array.isArray(value) ? value : []
    try { return typeof addresses[0] === 'string' ? getAddress(addresses[0]) : undefined } catch { return undefined }
  }
  function parseChainId(value: unknown): number | undefined {
    const id = typeof value === 'string' ? Number.parseInt(value, 16) : undefined
    return id && Number.isSafeInteger(id) && id > 0 ? id : undefined
  }
  function commitWalletContext(nextAccount: Address | undefined, nextChain: number | undefined) {
    const accountChanged = nextAccount !== accountRef.current
    const chainChanged = nextChain !== walletChainRef.current
    if (!accountChanged && !chainChanged) return
    activeReadProvider = nextAccount && nextChain === config.chainId ? window.ethereum : undefined
    accountRef.current = nextAccount; walletChainRef.current = nextChain
    clearView(); setAccount(nextAccount); setWalletChainId(nextChain)
    if (!inFlight.current) setStatus(undefined)
    // Account changes trigger the account-dependent effect after React commits.
    if (!accountChanged) void refreshRef.current()
  }
  async function readWalletContext(provider: Injected, stillCurrent: () => boolean) {
    const revision = walletRevision.current
    const [addresses, chainId] = await Promise.all([
      provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
    ])
    if (!stillCurrent() || revision !== walletRevision.current || provider !== window.ethereum) return
    commitWalletContext(ignoreAccounts.current ? undefined : parseAccounts(addresses), parseChainId(chainId))
  }
  useEffect(() => {
    const provider = window.ethereum
    if (!provider) return
    let active = true
    const accountsChanged = (value: unknown) => {
      ++walletRevision.current
      if (ignoreAccounts.current) return
      commitWalletContext(parseAccounts(value), walletChainRef.current)
      // An event may arrive before the initial chain/account pair was known.
      void readWalletContext(provider, () => active).catch(() => {})
    }
    const chainChanged = (value: unknown) => {
      ++walletRevision.current
      commitWalletContext(accountRef.current, parseChainId(value))
      void readWalletContext(provider, () => active).catch(() => {})
    }
    const disconnected = () => { ++walletRevision.current; ++walletIntent.current; commitWalletContext(undefined, undefined) }
    provider.on?.('accountsChanged', accountsChanged); provider.on?.('chainChanged', chainChanged); provider.on?.('disconnect', disconnected)
    void readWalletContext(provider, () => active).catch(() => {})
    return () => { active = false; provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged); provider.removeListener?.('disconnect', disconnected) }
  }, [])
  async function connect() {
    const intent = ++walletIntent.current; ++walletRevision.current
    try {
      const provider = window.ethereum
      if (!provider) throw new Error(t('copy300'))
      ignoreAccounts.current = false
      await provider.request({ method: 'eth_requestAccounts' })
      if (intent !== walletIntent.current) return
      // Permission responses can be stale after a wallet event; read the selected context afresh.
      await readWalletContext(provider, () => intent === walletIntent.current)
      if (intent === walletIntent.current) setActionError(undefined)
    } catch (failure) { if (intent === walletIntent.current) setActionError(worldErrorMessage(failure)) }
  }
  function disconnect() {
    ++walletIntent.current; ++walletRevision.current; ignoreAccounts.current = true
    commitWalletContext(undefined, undefined)
  }
  async function switchChain() {
    const intent = ++walletIntent.current; ++walletRevision.current
    try {
      const provider = window.ethereum
      if (!provider) throw new Error(t('copy301'))
      try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${config.chainId.toString(16)}` }] }) }
      catch (failure) {
        if (intent !== walletIntent.current) return
        if ((failure as { code?: number }).code !== 4902) throw failure
        await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${config.chainId.toString(16)}`, chainName: walletChain.name, nativeCurrency: walletChain.nativeCurrency, rpcUrls: walletChain.rpcUrls.default.http, ...(config.explorerUrl ? { blockExplorerUrls: [config.explorerUrl] } : {}) }] })
        if (intent !== walletIntent.current) return
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${config.chainId.toString(16)}` }] })
      }
      if (intent !== walletIntent.current) return
      await readWalletContext(provider, () => intent === walletIntent.current)
      if (intent === walletIntent.current) await refreshRef.current()
    } catch (failure) { if (intent === walletIntent.current) setActionError(worldErrorMessage(failure)) }
  }
  async function refreshLive(id: number | undefined = selectedRef.current, globals = false) {
    const base = snapshotRef.current, walletAccount = accountRef.current
    if (!base || (!walletAccount && id === undefined && !globals)) return
    const request = ++liveVersion.current
    try {
      const next = await readLiveView(reader, base, walletAccount, id, globals)
      if (request !== liveVersion.current || walletAccount !== accountRef.current) return
      if (id === selectedRef.current) setLiveSnapshot(next)
      if (id !== undefined) setLandObservations(previous => ({ ...previous, [id]: { land: next.lands[id - 1], J: next.J, blockNumber: next.blockNumber } }))
      if (globals) setLiveStats(next)
      if (walletAccount && next.wallet) {
        const publicView = { ...snapshotRef.current!, wallet: next.wallet }
        snapshotRef.current = publicView; setSnapshot(publicView)
      }
      if (id !== undefined) {
        const profile = await readLiveProfile(reader, next, id)
        if (request === liveVersion.current) setProfiles(previous => ({ ...previous, [id]: profile }))
      }
    } catch (failure) { if (request === liveVersion.current) setActionError(worldErrorMessage(failure)) }
  }
  function selectLand(id?: number) { selectedRef.current = id; setLiveSnapshot(undefined); if (id !== undefined) void refreshLive(id) }
  function pageChanged(page: string) { setLeaderboardOpen(page === 'rankings') }
  async function onAction(action: WorldAction): Promise<boolean> {
    if (!transactionsEnabled(config)) { setActionError(t('mainnetUnavailable')); return false }
    if (inFlight.current) return false
    if (!account || !window.ethereum || !snapshot || initial.error || stale) { setActionError(t('copy302')); return false }
    inFlight.current = true; setBusy(true); setActionError(undefined); setStatus(t('copy303'))
    let submittedHash: string | undefined
    try {
      const wallet = createWalletClient({ account, chain: walletChain, transport: custom(window.ethereum) })
      const receipt = await executeWorldAction(reader, wallet, account, action, (stage, hash) => {
        if (hash) submittedHash = hash
        const labels = { checking: t('copy304'), simulating: t('copy305'), confirm: t('copy306'), pending: t('copy307'), success: t('copy308') }
        setStatus(`${labels[stage]}${hash ? ` · ${hash}` : '…'}`)
      })
      let label = action.kind === 'profile' ? t('copy309') : action.kind === 'withdraw' ? t('copy310') : action.kind === 'buy' ? t('copy311') : action.kind === 'approve' ? t('copy312') : action.kind === 'settle' ? t('copy313') : action.kind === 'defend' ? t('copy314') : t('copy308')
      if (action.kind === 'attack') {
        const logs = receipt.logs.filter(log => log.address.toLowerCase() === snapshot.addresses.core.toLowerCase())
        const taken = parseEventLogs({ abi: coreAbi, logs, eventName: 'Taken' })
        const progress = parseEventLogs({ abi: coreAbi, logs, eventName: 'AttackProgress' })
        label = taken.length ? t('copy315', { v0: action.id }) : progress.length ? t('copy316', { v0: action.id }) : t('copy317')
      }
      setStatus(`${label} · ${receipt.transactionHash}`)
      // Receipt-confirmed local refresh only. The shared world poll runs independently.
      await refreshLive('id' in action ? action.id : selectedRef.current, ['buy', 'attack', 'settle', 'sync'].includes(action.kind))
      return true
    } catch (failure) {
      setStatus(submittedHash ? t('copy318', { v0: submittedHash }) : undefined)
      setActionError(worldErrorMessage(failure)); if ('id' in action && worldErrorMessage(failure) === t('copy190')) await refreshLive(action.id); return false
    } finally { inFlight.current = false; setBusy(false) }
  }
  return <>{stale&&<div className="notice warning" role="alert">{t('copy319')}</div>}<App key={`${config.chainId}:${config.deploymentAddress}:${account}:${walletChainId}`} {...{ snapshot, profiles, profileLimits, profileError, leaderboard, landObservations, liveSnapshot, liveStats, account, walletChainId, config, loading, busy, stale, status, connect, disconnect, switchChain, refresh, onAction }} onSelectLand={selectLand} onPageChange={pageChanged} error={actionError ?? error} quoteBuy={reader.quoteBuy}/></>
}
class ErrorBoundary extends React.Component<React.PropsWithChildren, { message?: string }> {
  state: { message?: string } = {}
  static getDerivedStateFromError(error: Error) { return { message: error.message } }
  render() { return this.state.message ? <main className="fatal"><h1>WORLD</h1><p role="alert">{t('pageFailure')}</p><button onClick={() => location.reload()}>{t('copy321')}</button></main> : this.props.children }
}
async function start() {
  if (import.meta.env.WORLD_WHITEPAPER_ENABLED && location.pathname.replace(/\/$/, '') === '/whitepaper') {
    const { default: WhitepaperPage } = await import('./WhitepaperPage')
    createRoot(document.getElementById('root')!).render(<ErrorBoundary><WhitepaperPage/></ErrorBoundary>)
    return
  }
  // The development signer has no private keys and is removed from production builds.
  if (import.meta.env.DEV && import.meta.env.VITE_LOCAL_TEST_WALLET === 'true' && !config.network) {
    const local = await import('./devLocalWallet')
    // An unavailable optional test signer must not hide the map or RPC retry UI.
    try { await local.installLocalWallet(config) }
    catch (failure) { console.warn('Local test wallet unavailable:', worldErrorMessage(failure)) }
  }
  createRoot(document.getElementById('root')!).render(<ErrorBoundary><WorldApplication/></ErrorBoundary>)
}
void start().catch(failure => {
  document.getElementById('root')!.textContent=t('copy322', { v0: worldErrorMessage(failure) })
})
