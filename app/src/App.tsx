import { t, useI18n, localizeMessage } from './i18n'
import { visibleLands, visiblePending } from './readView'
import { LanguageSwitch } from './LanguageSwitch'
import { Leaderboard } from './LeaderboardPage'
import { transactionsEnabled } from './config'
import { MainnetComingSoon } from './MainnetComingSoon'
import { useCallback, useEffect, useMemo, useState } from 'react'
import WorldMap, { controllerColor } from './WorldMap'
import { formatResistance, formatWorld, isNeutral, numeratorToWei, pendingNumerator, shortAddress, type Land } from './domain'
import type { AppProps } from './uiTypes'
import { BuyForm, LandDetail, Modal, WithdrawForm } from './Transactions'
import { compactAmount, compactResistance, compactReward, Empty, Icon, Metric, sameAddress } from './ui'

type Page = 'world'|'wars'|'my'|'rankings'|'docs'
const nav = (): { key: Page; label: string; icon: string }[] => [{key:'world',label:t('copy001'),icon:'map'},{key:'wars',label:t('copy002'),icon:'swords'},{key:'my',label:t('copy003'),icon:'wallet'},{key:'rankings',label:t('copy005'),icon:'crown'}]
function profileName(p: AppProps,id: number) { const profile=p.profiles[id], land=visibleLands(p).find(l=>l.id===id); return profile?.status==='available'&&profile.valid&&land&&sameAddress(profile.controller,land.controller)&&profile.epoch===land.epoch&&profile.name?profile.name:`LAND #${id}` }

export default function App(p: AppProps) { useI18n();
  const [page,setPage]=useState<Page>('world'), [selected,setSelected]=useState<number>(), [modal,setModal]=useState<'buy'|'withdraw'>(), [find,setFind]=useState(''), [findError,setFindError]=useState(''), [showList,setShowList]=useState(false)
  useEffect(() => { p.onPageChange?.(page) }, [page])
  useEffect(() => { p.onSelectLand?.(selected) }, [selected])
  const closeModal=useCallback(()=>setModal(undefined),[]), closeLand=useCallback(()=>setSelected(undefined),[])
  const openLand=useCallback((id:number)=>{setSelected(id);setPage('world');setModal(undefined)},[])
  useEffect(()=>{
    if(selected&&page==='world'&&window.matchMedia('(max-width: 900px)').matches) {
      document.querySelector('.map-stage')?.scrollIntoView({block:'start',behavior:'instant'})
    }
  },[selected,page])
  const s=p.snapshot, wallet=s?.wallet&&sameAddress(s.wallet.address,p.account)?s.wallet:undefined
  const owned=visibleLands(p).filter(l=>sameAddress(l.controller,p.account))
  const controlled=visibleLands(p).filter(l=>!isNeutral(l))
  const local=![56,97].includes(p.config.chainId), configured=!!(p.config.deploymentAddress||(p.config.coreAddress&&p.config.tokenAddress))
  const denomination=s?s.parameters.W*s.parameters.B:undefined
  const findLand=(e: React.FormEvent)=>{e.preventDefault();const n=Number(find.replace(/^(LAND\s*)?#?/i,''));const id=Number.isInteger(n)&&n>=1&&n<=50?n:s?.lands.find(l=>profileName(p,l.id).toLowerCase()===find.trim().toLowerCase())?.id;if(id){openLand(id);setFindError('')}else setFindError(t('copy011'))}
  if (p.config.chainId === 56 && !transactionsEnabled(p.config)) return <MainnetComingSoon/>
  return <div className="app-shell">
    <header className="app-header"><a className="wordmark" href="#world" onClick={e=>{e.preventDefault();setPage('world')}} aria-label={t('copy012')}><span className="brand-symbol"><Icon name="world" size={29}/></span><span>WORLD<small>{t('label001')}</small></span></a>
      <nav className="main-nav" aria-label={t('copy013')}>{nav().map(n=><button key={n.key} className={page===n.key?'active':''} onClick={()=>setPage(n.key)}><Icon name={n.icon} size={16}/>{n.label}</button>)}</nav>
      <div className="header-actions"><LanguageSwitch/><span className={`network-label ${local?'local':''}`}><i/>{local?'LOCAL DEV':p.config.chainId===97?'BSC TESTNET':'BNB CHAIN'}</span>{p.account?<div className="wallet-connected"><button className="button wallet-button" onClick={()=>setPage('my')}><span style={{background:controllerColor(p.account)}} className="avatar-dot"/>{shortAddress(p.account)}</button><button className="disconnect" onClick={p.disconnect} aria-label={t('copy014')} title={t('copy015')}>×</button></div>:<button className="button wallet-button" onClick={()=>void p.connect()}><Icon name="wallet"/>{t('copy016')}</button>}</div>
    </header>
    {p.config.chainId===97&&<div className="environment-ribbon"><span>{t('copy017')}</span>{t('copy018')}</div>}{local&&<div className="environment-ribbon"><span>{t('copy019')}</span>{t('copy020')}</div>}
    <div className="notice-stack">{p.error&&<div className="notice error" role="alert"><span>{localizeMessage(p.error)}</span><button onClick={()=>void p.refresh()} disabled={p.loading}>{t('copy021')}</button></div>}{p.status&&<div className="notice status" role="status"><span className={p.busy?'status-dot loading':'status-dot'}/><span>{localizeMessage(p.status)}</span></div>}{p.account&&p.walletChainId!==p.config.chainId&&<div className="notice warning"><span>{t('copy022')}</span><button onClick={()=>void p.switchChain()}>{t('copy023')}</button></div>}</div>
    <main className="main-content">
      {page==='world'&&<>
        <div className="world-heading"><div><span className="eyebrow">{t('label002')}</span><h1>{t('copy024')}<span> / BSC V2 · 50 LAND</span></h1></div><div className="world-heading-actions"><button className="text-button" onClick={()=>setPage('docs')}>{t('copy025')} <Icon name="external" size={13}/></button><button className="button primary" onClick={()=>setModal('buy')}>{t('copy026')} <Icon name="arrow"/></button></div></div>
        <section className="global-metrics" aria-label={t('copy027')}><Metric label={t('copy028')} value={s?compactAmount((p.liveStats?.U ?? s.U)/s.parameters.B,18,6):'—'} unit={p.config.nativeSymbol} detail={t('copy029')}/><Metric label={t('copy030')} value={compactAmount(p.liveStats?.totalSupply ?? s?.totalSupply)} unit="WORLD" detail={t('copy031')}/></section>
        <div className={`world-layout ${selected?'has-selection':''}`}><section className="map-stage" aria-label={t('copy032')}><div className="map-toolbar"><div className="live-indicator"><i className={s?'online':''}/>{s?t('copy033'):t('copy034')}<span>{s?`#${s.blockNumber}`:t('copy035')}</span></div><form className="map-search" onSubmit={findLand}><input aria-label={t('copy036')} placeholder={t('copy037')} value={find} onChange={e=>{setFind(e.target.value);setFindError('')}}/><button aria-label={t('copy038')} type="submit"><Icon name="arrow" size={16}/></button></form><button className={`icon-button ${p.loading?'is-refreshing':''}`} onClick={()=>void p.refresh()} disabled={p.loading||!configured} aria-label={t('copy039')}><Icon name="refresh" size={17}/></button></div>
          {findError&&<div className="map-find-error">{localizeMessage(findError)}</div>}
          <div className="map-canvas"><WorldMap lands={visibleLands(p).map(land => selected && land.id === selected ? p.liveSnapshot?.lands[land.id - 1] ?? land : land)} profiles={p.profiles} selectedLandId={selected} account={p.account} maxWarAtoms={s?.parameters.maxWarAtoms} onSelect={openLand}/></div>
          <div className="map-directory"><button className="text-button" aria-expanded={showList} aria-controls="land-directory" onClick={()=>setShowList(v=>!v)}><Icon name="map" size={14}/>{showList?t('copy040'):t('copy041')}<Icon name="chevron" size={12}/></button><span>{s?t('copy042', { v0: controlled.length }):t('copy043')}  {t('copy044')}</span></div>
          {showList&&<div id="land-directory" className="land-directory" aria-label={t('copy045')}>{Array.from({length:50},(_,i)=>{const id=i+1;const land=s?.lands.find(l=>l.id===id);return <button key={id} onClick={()=>openLand(id)} className={selected===id?'selected':''} aria-pressed={selected===id}><b>#{id}</b><span title={profileName(p,id)}>{profileName(p,id)}</span><small>{land?isNeutral(land)?t('copy046'):shortAddress(land.controller):t('copy047')}</small></button>})}</div>}
          {!configured&&<div className="map-configuration"><Icon name="world"/><div><strong>{t('copy048')}</strong><p>{t('copy049')}</p></div><button className="button secondary small" onClick={()=>setPage('docs')}>{t('copy050')}</button></div>}
        </section>
          {selected?<LandDetail key={`${selected}:${p.account||'read'}`} p={p.liveSnapshot ? { ...p, snapshot: p.liveSnapshot } : p} id={selected} onClose={closeLand} onWithdraw={()=>setModal('withdraw')}/>:<WorldAside p={p} openLand={openLand} onWars={()=>setPage('wars')}/>}
        </div>
        <div className="world-underbar"><span><Icon name="shield" size={15}/>{t('copy051')}</span><div><span>{t('copy052')} {s?.parameters.W.toString()??'65'}</span><span>{t('copy053')}</span><span>{t('copy054')}</span></div><button className="text-button" onClick={()=>setPage('rankings')}>{t('copy005')} <Icon name="arrow" size={14}/></button></div>
      </>}
      {page==='wars'&&<Wars p={p} openLand={openLand}/>}
      {page==='my'&&<><PageHeading eyebrow={t('label003')} title={t('copy003')} detail={p.account?shortAddress(p.account):t('copy056')}/>{!p.account?<div className="panel connect-panel"><Empty title={t('copy057')}>{t('copy058')}</Empty><button className="button primary" onClick={()=>void p.connect()}><Icon name="wallet"/>{t('copy016')}</button></div>:<>
        <div className="asset-grid"><Metric label={t('label004')} value={compactAmount(wallet?.balance)} unit="WORLD"/><Metric label={t('label005')} value={compactAmount(wallet?.nativeBalance,18,6)} unit={p.config.nativeSymbol}/><Metric label={t('copy059')} value={wallet?compactAmount(numeratorToWei(wallet.claimable,denomination),18,8):'—'} unit={p.config.nativeSymbol} accent/><Metric label={t('label006')} value={s?owned.length:'—'} unit="/ 50"/></div>
        <div className="asset-actions"><button className="button primary" onClick={()=>setModal('buy')}>{t('copy026')} <Icon name="arrow"/></button><button className="button secondary" onClick={()=>setModal('withdraw')}>{t('copy060')} <Icon name="drop"/></button><span>{t('copy061')}{s&&wallet?compactReward(owned.reduce((sum,l)=>sum+visiblePending(p,l),0n),denomination):'—'} BNB</span></div>
        <section className="panel"><div className="section-top"><h2>{t('copy062')}</h2><span className="eyebrow">{t('label007')}</span></div>{owned.length?<div className="territory-grid">{owned.map(l=><LandCard key={l.id} p={p} land={l} onSelect={openLand}/>)}</div>:<Empty title={s?t('copy063'):t('copy064')}>{s?t('copy065'):t('copy066')}</Empty>}</section>
      </>}</>}
      {page==='rankings'&&<Leaderboard view={p.leaderboard} onLand={openLand} nativeSymbol={p.config.nativeSymbol} profiles={p.profiles}/>}
      {page==='docs'&&<Docs p={p}/>}
    </main>
    <footer className="app-footer"><span>WORLD V2 <i>·</i> {t('label008')}</span><div><button onClick={()=>setPage('docs')}>{t('copy069')}</button><span>{s?t('copy070', { v0: s.blockNumber }):t('copy071')}</span></div></footer>
    {modal&&<Modal title={modal==='buy'?t('copy026'):t('copy060')} eyebrow={modal==='buy'?'FUEL YOUR NEXT MOVE':'YOUR BNB REWARDS'} onClose={closeModal}>{modal==='buy'?<BuyForm p={p}/>:<WithdrawForm p={p} onLand={openLand}/>}</Modal>}
  </div>
}
function PageHeading({eyebrow,title,detail}:{eyebrow:string;title:string;detail?:string}) { useI18n();return <div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{detail&&<p>{detail}</p>}</div>}
function WorldAside({p,openLand,onWars}:{p:AppProps;openLand:(id:number)=>void;onWars:()=>void}) { useI18n();
  const crown=p.snapshot?.lands.find(l=>l.id===1)
  const blocked=crown&&p.snapshot&&crown.minimumAttackAtoms>=p.snapshot.parameters.maxWarAtoms
  return <aside className="world-aside"><section className="crown-card"><div className="section-top"><span className="eyebrow">{t('label009')}</span><span className="weight-pill">{t('label010')}</span></div><div className="crown-emblem"><Icon name="crown" size={46}/><span>01</span></div><h2>{profileName(p,1)}</h2><p>{crown?(isNeutral(crown)?t('copy072'):shortAddress(crown.controller)):t('copy073')}</p><div className="crown-stats"><div><span>{t('label011')}</span><strong title={crown?formatResistance(crown.currentResistanceRaw):undefined}>{compactResistance(crown?.currentResistanceRaw)}</strong></div><div><span>{t('copy074')}</span><strong className="strict-quote" title={crown?formatWorld(crown.minimumAttackAtoms):undefined}>{blocked?t('copy075'):crown?formatWorld(crown.minimumAttackAtoms):'—'}</strong></div></div><button className="button gold-outline full" onClick={()=>openLand(1)}>{t('copy076')} <Icon name="arrow"/></button></section>
    <section className="frontline-card"><button className="button secondary full" onClick={onWars}>{t('copy002')} <Icon name="arrow" size={14}/></button></section>
  </aside>
}
function LandCard({p,land,onSelect}:{p:AppProps;land:Land;onSelect:(id:number)=>void}) { useI18n();return <button className={`territory-card ${land.id===1?'crown':''}`} onClick={()=>onSelect(land.id)}><div className="territory-card-head"><span className="eyebrow">LAND #{String(land.id).padStart(2,'0')}</span><span className="weight-pill">×{land.weight.toString()}</span></div><h3>{profileName(p,land.id)}</h3><span className="controller-label"><i style={{background:isNeutral(land)?'#687878':controllerColor(land.controller)}}/>{isNeutral(land)?t('label051'):shortAddress(land.controller)}</span><div className="card-pairs"><span>{t('label011')}<strong title={formatResistance(land.currentResistanceRaw)}>{compactResistance(land.currentResistanceRaw)}</strong></span><span>{t('copy084')}<strong>#{land.epoch.toString()}</strong></span></div><span className="card-open">{t('copy085')} <Icon name="arrow" size={14}/></span></button>}
function Wars({p,openLand}:{p:AppProps;openLand:(id:number)=>void}) { useI18n();
  const [sort,setSort]=useState<'id'|'resistance'>('id'), s=p.snapshot
  const lands=useMemo(()=>[...(visibleLands(p).filter(l=>!isNeutral(l))??[])].sort((a,b)=>{
    if(sort==='id')return a.id-b.id
    const va=a.currentResistanceRaw,vb=b.currentResistanceRaw
    return va===vb?a.id-b.id:va<vb?-1:1
  }),[s,sort])
  return <><PageHeading eyebrow={t('label012')} title={t('copy002')} detail={t('currentBattleState')}/><div className="section-top wars-filters"><div className="segmented">{([['resistance',t('copy088')],['id',t('copy089')]] as const).map(([key,label])=><button key={key} className={sort===key?'active':''} onClick={()=>setSort(key)}>{label}</button>)}</div><button className="button gold-outline small" onClick={()=>openLand(1)}><Icon name="crown" size={16}/>{t('label013')}</button></div><div className="territory-grid war-grid">{lands.map(l=><div key={l.id}><LandCard p={p} land={l} onSelect={openLand}/></div>)}</div>{!lands.length&&<Empty title={s?t('copy093'):t('copy094')}>{t('copy095')}</Empty>}</>
}
function Docs({p}:{p:AppProps}) { useI18n();
  const s=p.snapshot
  const addresses=[['Deployment',p.config.deploymentAddress],['Core',s?.addresses.core],['Token',s?.addresses.token],['Land Profile',s?.addresses.profile]]
  return <><PageHeading eyebrow={t('label015')} title={t('copy025')} detail={t('copy122')}/><div className="docs-grid"><a className="doc-card" href="./docs/V2_UI_RULES.md" target="_blank" rel="noopener noreferrer"><Icon name="book" size={29}/><h2>{t('copy123')}</h2><p>{t('copy124')}</p><span>{t('copy125')} <Icon name="external" size={15}/></span></a><a className="doc-card" href="./docs/V2_CONTRACT_INTEGRATION.md" target="_blank" rel="noopener noreferrer"><Icon name="history" size={29}/><h2>{t('copy126')}</h2><p>{t('copy127')}</p><span>{t('copy128')} <Icon name="external" size={15}/></span></a>{import.meta.env.WORLD_WHITEPAPER_ENABLED&&<a className="doc-card" href="/whitepaper"><Icon name="book" size={29}/><h2>Whitepaper</h2><p>Economics, immutability, risks, and on-chain verification</p><span>Read the whitepaper <Icon name="arrow" size={15}/></span></a>}</div>
    <section className="panel"><div className="section-top"><h2>{t('copy129')}</h2><span className="tag">Chain {p.config.chainId}</span></div><p className="microcopy">{s?t('copy130'):t('copy131')}</p><dl className="contract-list">{addresses.map(([label,address])=><div key={label}><dt>{label}</dt><dd>{address||t('copy132')}</dd></div>)}</dl><div className="abi-links">{['WorldCoreBSCV2','WorldTokenBSCV2','WorldLandProfileBSCV2','WorldDeploymentBSCV2'].map(n=><a href={`./abi/${n}.json`} target="_blank" rel="noopener noreferrer" key={n}>{n.replace('World','').replace('BSC','')} ABI <Icon name="external" size={12}/></a>)}</div></section>
    <section className="panel concise-faq"><h2>{t('copy133')}</h2><details><summary>{t('copy134')}</summary><p>{t('copy135')}</p><a className="text-button" href="./docs/REIGN_PERFORMANCE.md" target="_blank" rel="noopener noreferrer">{t('copy136')} <Icon name="external" size={12}/></a></details><details><summary>{t('copy137')}</summary><p>{t('copy138')}</p></details><details><summary>{t('copy139')}</summary><p>{t('copy140')}</p></details><details><summary>{t('copy141')}</summary><p>{t('copy142')}</p></details><details><summary>{t('copy143')}</summary><p>{t('copy144')}</p></details><details><summary>{t('copy145')}</summary><p>{t('copy146')}</p></details><details><summary>{t('copy147')}</summary><p>{t('copy148')}</p><a className="text-button historical-link" href="./docs/WORLD_WHITEPAPER_V1.0_DRAFT.md" target="_blank" rel="noopener noreferrer">{t('copy149')} <Icon name="external" size={12}/></a></details></section>
  </>
}
