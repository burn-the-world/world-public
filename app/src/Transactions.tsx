import { visibleLands, visiblePending } from './readView'
import { t, useI18n, localizeMessage } from './i18n'
import { worldErrorMessage } from './chain'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { attackPreview, defendPreview, byteLength, formatNative, formatNumerator, formatWorld, formatResistance, isNeutral, numeratorToWei, parseWorld, pendingNumerator, MAX_WAR_ATOMS, shortAddress, type Land } from './domain'
import type { AppProps } from './uiTypes'
import { transactionsEnabled } from './config'
import { compactAmount, compactReward, Empty, Icon, Metric, sameAddress } from './ui'

function parseInput(text: string) { try { return { amount: parseWorld(text), error: undefined } } catch (error) { return { amount: undefined, error: text ? (error as Error).message : undefined } } }
export function canTransact(p: AppProps) { return transactionsEnabled(p.config) && !!p.snapshot && !!p.account && sameAddress(p.snapshot.wallet?.address, p.account) && p.walletChainId === p.config.chainId && !p.busy && !p.stale }
export function WalletGate({ p }: { p: AppProps }) { useI18n();
  if (!p.account) return <button className="button secondary full" onClick={() => void p.connect()}><Icon name="wallet"/>{t('copy430')}</button>
  if (p.walletChainId !== p.config.chainId) return <button className="button secondary full" onClick={() => void p.switchChain()}>{t('copy431')}</button>
  return null
}
function ActionFeedback({ p }: { p: AppProps }) { useI18n();
  const message = p.error ?? p.status
  return message ? <div className={`action-feedback ${p.error?'error':''}`} role={p.error?'alert':'status'}>{localizeMessage(message)}</div> : null
}
export function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) { useI18n();
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; ref.current?.focus()
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const list = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],textarea:not(:disabled),select:not(:disabled)')
        if (!list?.length) return
        const first = list[0], last = list[list.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus() }
  }, [onClose])
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}><div className="transaction-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}><div className="section-top"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button className="icon-button" aria-label={t('copy432')} onClick={onClose}><Icon name="close"/></button></div>{children}</div></div>
}
export function BuyForm({ p }: { p: AppProps }) { useI18n();
  const [text, setText] = useState('1000'), [quote, setQuote] = useState<{ amount: bigint; cost: bigint }>(), [quoteError, setQuoteError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const { amount, error } = parseInput(text), s = p.snapshot
  useEffect(() => {
    let cancelled = false; setQuote(undefined); setQuoteError(undefined)
    if (!amount || !s) return
    const timer = setTimeout(() => { p.quoteBuy(amount).then(cost => { if (!cancelled) setQuote({ amount, cost }) }).catch(failure => { if (!cancelled) setQuoteError(worldErrorMessage(failure)) }) }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [amount, p.quoteBuy, s?.addresses.core, s?.addresses.token, p.account, p.walletChainId, !!s, retry])
  const ready = !!quote && quote.amount === amount
  return <div className="transaction-form"><label htmlFor="buy-amount">{t('copy433')} <span>WORLD</span></label><div className="amount-input"><input id="buy-amount" value={text} onChange={e => setText(e.target.value)} inputMode="decimal" autoComplete="off"/><span>WORLD</span></div>
    <div className="quick-amounts">{['100','1000','10000'].map(v => <button key={v} onClick={() => setText(v)}>{v}</button>)}</div>
    {error && <p className="form-error">{error}</p>}
    <div className="quote-card"><span>{t('copy434')} {p.config.nativeSymbol}</span><strong>{ready ? formatNative(quote.cost) : '—'} <small>{p.config.nativeSymbol}</small></strong><span>{t('copy435')}</span></div>
    <dl className="fact-list"><div><dt>{t('copy436')}</dt><dd>{s ? formatNative(s.parameters.worldPrice) : '—'} {p.config.nativeSymbol} / WORLD</dd></div><div><dt>{t('copy437')}</dt><dd>{amount ? formatWorld(amount) : '—'} WORLD</dd></div><div><dt>{t('copy438')}</dt><dd title={p.account}>{p.account ? shortAddress(p.account) : t('copy439')}</dd></div></dl>
    <p className="microcopy">{t('copy440')}</p>
    {quoteError && <p className="form-error">{t('copy441')}<button className="text-button" onClick={() => setRetry(v => v + 1)}>{t('copy021')}</button></p>}
    <button className="button primary full" disabled={!canTransact(p) || !ready} onClick={() => { if (ready) void p.onAction({ kind: 'buy', amount: quote.amount, quotedCost: quote.cost }) }}>{t('copy026')} <Icon name="arrow"/></button><WalletGate p={p}/><ActionFeedback p={p}/>
    {s?.wallet && ready && s.wallet.nativeBalance <= quote.cost && <p className="form-error">{p.config.nativeSymbol}{t('copy442')}</p>}
  </div>
}
export function WithdrawForm({ p, onLand }: { p: AppProps; onLand: (id: number) => void }) { useI18n();
  const s = p.snapshot, w = s?.wallet && sameAddress(s.wallet.address,p.account) ? s.wallet : undefined
  const denominator = s ? s.parameters.W * s.parameters.B : undefined
  const owned = visibleLands(p).filter(l => sameAddress(l.controller,p.account)) ?? []
  const pending = s ? owned.reduce((a,l) => a + visiblePending(p,l),0n) : 0n
  const claim = w ? numeratorToWei(w.claimable,denominator) : 0n
  return <div className="transaction-form"><div className="quote-card"><span>{t('copy443')}</span><strong>{w ? formatNative(claim) : '—'} <small>{p.config.nativeSymbol}</small></strong></div>
    <dl className="fact-list"><div><dt>{t('copy444')}</dt><dd>{s && w ? formatNumerator(pending,denominator) : '—'} {p.config.nativeSymbol}</dd></div><div><dt>{t('copy445')}</dt><dd>{w ? formatNative(claim) : '—'} {p.config.nativeSymbol}</dd></div><div><dt>{t('copy446')}</dt><dd title={p.account}>{p.account ? shortAddress(p.account) : '—'}</dd></div></dl>
    <p className="microcopy">{t('copy447')}</p>
    <button className="button primary full" disabled={!canTransact(p) || claim === 0n} onClick={() => void p.onAction({kind:'withdraw'})}>{t('copy448')} {p.config.nativeSymbol} <Icon name="arrow"/></button><WalletGate p={p}/><ActionFeedback p={p}/>
    {owned.length > 0 && <div className="settlement-list"><h3>{t('copy449')} <span>{t('copy450')}</span></h3>{owned.map(l => <div key={l.id}><button className="text-button" onClick={() => onLand(l.id)}>LAND #{l.id}</button><span>{s ? compactReward(visiblePending(p,l),denominator) : '—'} {p.config.nativeSymbol}</span><button className="button small secondary" disabled={!canTransact(p) || !s || visiblePending(p,l) === 0n} onClick={() => void p.onAction({kind:'settle',id:l.id})}>{t('copy451')}</button></div>)}</div>}
  </div>
}
export function LandDetail({ p, id, onClose, onWithdraw }: { p: AppProps; id: number; onClose: () => void; onWithdraw: () => void }) { useI18n();
  const [mode,setMode] = useState<'attack'|'defend'|'profile'>('attack'), [text,setText] = useState('100')
  const ref=useRef<HTMLElement>(null), s=p.snapshot, land=s?.lands.find(l=>l.id===id), profile=p.profiles[id]
  const effective=profile?.status==='available' && profile.valid && land && sameAddress(profile.controller,land.controller) && profile.epoch===land.epoch ? profile : undefined
  const owner=!!land && sameAddress(land.controller,p.account)
  useEffect(()=>{ if(mode==='profile'&&!owner)setMode('attack') },[owner,mode])
  useEffect(()=>{ const listener=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.querySelector('[role=dialog]'))onClose()};document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener)},[onClose])
  const {amount,error}=parseInput(text)
  const amountError = amount && amount >= MAX_WAR_ATOMS ? t('copy452') : error
  let preview: ReturnType<typeof attackPreview> | undefined, defense: ReturnType<typeof defendPreview> | undefined, previewError: string | undefined
  try { if (land && amount && !amountError) { if (mode === 'attack') preview=attackPreview(land,amount); else if (mode==='defend') defense=defendPreview(land,amount) } } catch (failure) { previewError=(failure as Error).message }
  const wallet=s?.wallet&&sameAddress(s.wallet.address,p.account)?s.wallet:undefined
  const ready=canTransact(p), enough=!!wallet&&!!amount&&wallet.balance>=amount, approved=!!wallet&&!!amount&&wallet.allowance>=amount
  const pending=s&&land?pendingNumerator(land,s.J):0n, denominator=s?s.parameters.W*s.parameters.B:undefined
  const title=effective?.name||`LAND #${id}`, tier=id===1?'CROWN':id<=6?'PREMIUM':'TERRITORY'
  return <aside className={`land-detail tier-${tier.toLowerCase()}`} aria-label={t('copy453', { v0: id })} ref={ref}>
    <div className="sheet-handle"/><div className="detail-top"><span className="eyebrow">LAND #{String(id).padStart(2,'0')} <b>· {tier}</b></span><button className="icon-button" onClick={onClose} aria-label={t('copy454')}><Icon name="close"/></button></div>
    <div className="land-identity"><span className="land-symbol"><Icon name={id===1?'crown':'shield'} size={26}/></span><div><h2 title={title}>{title}</h2><span>{land ? (isNeutral(land)?t('copy455'):owner?t('copy456'):t('copy457')):t('copy073')}</span></div></div>

    {!land||!s?<Empty title={t('copy459')}>{t('copy460')}</Empty>:<>
      <dl className="land-meta"><div><dt>{t('label016')}</dt><dd title={land.controller}>{isNeutral(land)?'—':shortAddress(land.controller)}</dd></div><div><dt>{t('label017')}</dt><dd>{land.epoch.toString()}</dd></div><div><dt>{t('label018')}</dt><dd>{land.weight.toString()} <span>/ {s.parameters.W.toString()}</span></dd></div></dl>
      <div className="battle-numbers resistance-numbers"><Metric label={t('copy461')} value={formatResistance(land.currentResistanceRaw)} unit="WORLD" accent/></div>
      <div className="resistance-caption"><span>{t('copy090')}</span><span>{t('copy462')}{s.blockNumber.toString()}</span></div>
      <details className="precise-values"><summary>{t('copy463')}</summary><dl className="fact-list"><div><dt>{t('copy464')}</dt><dd>{land.currentResistanceRaw.toString()}</dd></div><div><dt>{t('copy465')}</dt><dd>{land.resistanceRaw.toString()}</dd></div><div><dt>{t('copy466')}</dt><dd>{land.lastResistanceUpdate.toString()}</dd></div><div><dt>{t('copy467')}</dt><dd>{s.timestamp.toString()}</dd></div><div><dt>{t('copy468')}</dt><dd>{formatWorld(land.minimumAttackAtoms)} WORLD</dd></div></dl></details>
      <div className="land-reward"><div><span>{isNeutral(land)?t('copy469'):t('copy470')}</span><strong title={formatNumerator(pending,denominator)}>{compactReward(pending,denominator)} <small>{p.config.nativeSymbol}</small></strong></div>{owner&&<button className="text-button" disabled={!ready||pending===0n} onClick={()=>void p.onAction({kind:'settle',id})}>{t('copy451')} <Icon name="arrow" size={14}/></button>}</div>
      {owner&&<button className="text-button reward-link" onClick={onWithdraw}>{t('copy471')} <Icon name="chevron" size={13}/></button>}
      <div className="segmented" role="tablist" aria-label={t('copy472')}><button role="tab" aria-selected={mode==='attack'} className={mode==='attack'?'active':''} onClick={()=>setMode('attack')}><Icon name="swords" size={15}/>{t('copy473')}</button><button role="tab" aria-selected={mode==='defend'} className={mode==='defend'?'active':''} onClick={()=>setMode('defend')}><Icon name="shield" size={15}/>{t('copy474')}</button>{owner&&<button role="tab" aria-selected={mode==='profile'} className={mode==='profile'?'active':''} onClick={()=>setMode('profile')}>{t('profileNameTab')}</button>}</div>
      {mode==='profile'?<ProfileForm key={`${id}:${land.epoch}`} p={p} land={land}/>:<div className="transaction-form land-form">
        <label htmlFor="war-amount">{mode==='attack'?t('copy476'):t('copy477')}<span>{t('copy478')} {wallet?compactAmount(wallet.balance):'—'}</span></label><div className="amount-input"><input id="war-amount" inputMode="decimal" value={text} onChange={e=>setText(e.target.value)} autoComplete="off"/><span>WORLD</span></div>
        {mode==='attack'&&(land.minimumAttackAtoms >= MAX_WAR_ATOMS ? <p className="microcopy">{t('copy479')}</p> : <button className="text-button minimum-button" onClick={()=>setText(formatWorld(land.minimumAttackAtoms))}>{t('copy480')} <span>{formatWorld(land.minimumAttackAtoms)}</span></button>)}
        {(amountError||previewError)&&<p className="form-error">{amountError||previewError}</p>}
        {mode==='attack'&&preview?<div className={`outcome ${preview.taken?'takeover':'partial'}`}><span>{t('copy481')} {land.epoch.toString()}</span><strong>{preview.taken?(owner?t('copy482'):t('copy483')):preview.equal?t('copy484'):t('copy485')}</strong><dl className="fact-list"><div><dt>{preview.taken?t('copy486'):t('copy487')}</dt><dd>{formatResistance(preview.newResistanceRaw)} WORLD</dd></div><div><dt>{t('copy488')}</dt><dd>{formatWorld(amount!)} WORLD</dd></div></dl></div>:mode==='defend'&&defense?<div className="outcome"><span>{t('copy489')}</span><strong>{formatResistance(defense.newResistanceRaw)} WORLD</strong><p>{t('copy490')} {formatWorld(amount!)} WORLD</p></div>:null}
        <p className="transaction-fact">{mode==='attack'?t('copy491'):t('copy492')}</p>
        {mode==='defend'&&isNeutral(land)?<p className="form-error">{t('copy493')}</p>:<>
          {amount&&wallet&&!enough&&<p className="form-error">{t('copy494')}</p>}
          {!approved&&<button className="button secondary full" disabled={!ready||!amount||!enough||!!amountError||!!previewError} onClick={()=>{if(amount)void p.onAction({kind:'approve',amount})}}>{t('copy495')}</button>}
          <button className={`button full ${mode==='attack'?'danger':'primary'}`} disabled={!ready||!amount||!enough||!approved||!!amountError||!!previewError} onClick={()=>{if(amount)void p.onAction({kind:mode,id,amount,expectedEpoch:land.epoch,expectedResistanceRaw:land.resistanceRaw,expectedLastResistanceUpdate:land.lastResistanceUpdate})}}><Icon name={mode==='attack'?'swords':'shield'}/>{mode==='attack'?t('copy496'):t('copy497')}</button><p className="microcopy" title={s.addresses.core}>{t('copy498')} {shortAddress(s.addresses.core)}</p></>}
        <WalletGate p={p}/><ActionFeedback p={p}/>
      </div>}
      {(profile?.status==='unavailable'||p.profileError)&&<p className="microcopy">{t('copy503')}</p>}
    </>}
  </aside>
}
export function ProfileForm({ p, land }: { p: AppProps; land: Land }) { useI18n();
  const current=p.profiles[land.id], valid=current?.status==='available'&&current.valid&&current.epoch===land.epoch&&sameAddress(current.controller,land.controller)
  const [name,setName]=useState(valid?current.name:''), [dirty,setDirty]=useState(false)
  useEffect(()=>{if(!dirty)setName(valid?current.name:'')},[valid,current,dirty])
  const limits=p.profileLimits, tooLong=!!limits&&byteLength(name)>limits.name
  const unavailable=current?.status!=='available'
  return <div className="transaction-form profile-form"><label htmlFor="profile-name">{t('profileNameLabel')}<span className={tooLong?'text-red':''}>{byteLength(name)} / {limits?.name??'—'} bytes</span></label>
    <input id="profile-name" value={name} onChange={e=>{setDirty(true);setName(e.target.value)}} autoComplete="off" placeholder={`LAND #${land.id}`}/>
    {tooLong&&<p className="form-error">{t('copy509')}</p>}{unavailable&&<p className="form-error">{t('copy510')}</p>}
    <button className="button primary full" disabled={!canTransact(p)||!limits||tooLong||unavailable} onClick={()=>void p.onAction({kind:'profile',id:land.id,expectedEpoch:land.epoch,name})}>{t('profileNameSave')}</button><ActionFeedback p={p}/>
  </div>
}
