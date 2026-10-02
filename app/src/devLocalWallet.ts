import { t, i18n } from './i18n'
import type { Address } from 'viem'
import type { WorldConfig } from './config'

/** Vite development only. Uses unlocked disposable Anvil accounts; holds NO keys. */
/** Vite development only. Uses unlocked disposable Anvil accounts; holds NO keys. */
export async function installLocalWallet(config: WorldConfig) {
  if (!import.meta.env.DEV) throw new Error(t('copy215'))
  const url = new URL(config.rpcUrl)
  if (config.chainId !== 31359 || url.hostname !== '127.0.0.1' || url.protocol !== 'http:'
    || !['127.0.0.1','localhost'].includes(location.hostname)) throw new Error(t('copy216'))
  if (window.ethereum) return // An explicitly installed wallet remains the wallet.
  let sequence=0, connected=false, selected=0
  const listeners=new Map<string,Set<(...args:unknown[])=>void>>()
  const rpc=async(method:string,params:unknown[]=[])=>{
    const response=await fetch(config.rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})})
    const data=await response.json()
    if(data.error) throw Object.assign(new Error(data.error.message),{code:data.error.code})
    return data.result
  }
  if(Number(await rpc('eth_chainId'))!==config.chainId) throw new Error(t('copy217'))
  const accounts=await rpc('eth_accounts') as Address[]
  if(accounts.length<2)throw new Error(t('copy218'))
  const emit=(event:string,value:unknown)=>listeners.get(event)?.forEach(fn=>fn(value))
  const provider={
    async request({method,params}:{method:string;params?:unknown[]}) {
      if(method==='eth_accounts')return connected?[accounts[selected]]:[]
      if(method==='eth_requestAccounts'){connected=true;emit('accountsChanged',[accounts[selected]]);return [accounts[selected]]}
      if(method==='wallet_switchEthereumChain'){
        if(Number((params?.[0] as {chainId:string})?.chainId)!==31359)throw new Error(t('copy219'))
        emit('chainChanged','0x7a7f'); return null
      }
      if(method==='eth_sendTransaction'){
        if(!connected)throw new Error(t('copy220'))
        const tx=params?.[0] as {from?:string;to?:string;value?:string;data?:string}
        if(!tx?.from || tx.from.toLowerCase()!==accounts[selected].toLowerCase())throw new Error(t('copy221'))
        const allowed=[config.coreAddress,config.tokenAddress,config.profileAddress].filter(Boolean).map(a=>a!.toLowerCase())
        if(!tx.to||!allowed.includes(tx.to.toLowerCase()))throw new Error(t('copy222'))
        if(Number(await rpc('eth_chainId'))!==31359)throw new Error(t('copy223'))
        if(!confirm(t('copy224', { v0: accounts[selected], v1: tx.to, v2: BigInt(tx.value||'0x0') })))throw Object.assign(new Error('User rejected the request'),{code:4001})
      }
      if(!['eth_chainId','eth_sendTransaction','eth_getTransactionReceipt','eth_getTransactionByHash','eth_blockNumber','eth_getBlockByNumber','eth_getBalance','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount','eth_call','eth_getCode'].includes(method))throw new Error(t('copy225', { v0: method }))
      return rpc(method,params)
    },
    on(event:string,fn:(...args:unknown[])=>void){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn)},
    removeListener(event:string,fn:(...args:unknown[])=>void){listeners.get(event)?.delete(fn)},
  }
  window.ethereum=provider as unknown as NonNullable<typeof window.ethereum>
  const bar=document.createElement('div');bar.className='local-test-controls';bar.setAttribute('aria-label',t('copy226'))
  const label=document.createElement('span');label.textContent=t('copy227')
  const select=document.createElement('select');select.setAttribute('aria-label',t('copy228'))
  accounts.slice(0,3).forEach((account,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=t('copy229', { v0: String.fromCharCode(65+index), v1: account.slice(0,6), v2: account.slice(-4) });select.append(option)})
  select.onchange=()=>{selected=Number(select.value);if(connected)emit('accountsChanged',[accounts[selected]])}
  const advance=(days:number)=>{const button=document.createElement('button');button.textContent=t('copy230', { v0: days });button.onclick=async()=>{
    if(!confirm(t('copy231', { v0: days })))return
    button.disabled=true
    try{if(Number(await rpc('eth_chainId'))!==31359)throw new Error('Chain changed');await rpc('evm_increaseTime',[days*86400]);await rpc('evm_mine');location.reload()}catch(e){alert((e as Error).message)}finally{button.disabled=false}
  };return button}
  const hint=document.createElement('small');hint.textContent=t('copy232')
  const controls=[advance(45),advance(60)];bar.append(label,select,...controls,hint);document.body.prepend(bar)
  i18n.on('languageChanged',()=>{
    bar.setAttribute('aria-label',t('copy226'));label.textContent=t('copy227');select.setAttribute('aria-label',t('copy228'));hint.textContent=t('copy232')
    Array.from(select.options).forEach((option,index)=>{const account=accounts[index];option.textContent=t('copy229',{v0:String.fromCharCode(65+index),v1:account.slice(0,6),v2:account.slice(-4)})})
    controls.forEach((button,index)=>{button.textContent=t('copy230',{v0:index===0?45:60})})
  })
  const style=document.createElement('style');style.textContent='.local-test-controls{display:flex;align-items:center;gap:12px;padding:8px 20px;background:#142624;color:#bdd6bd;border-bottom:1px solid #31483c;font:11px system-ui;flex-wrap:wrap}.local-test-controls select,.local-test-controls button{font:inherit;background:#21372d;color:#dbe9cb;border:1px solid #44624b;border-radius:5px;padding:5px 8px}.local-test-controls select{width:auto;max-width:100%}.local-test-controls small{opacity:.7}@media(max-width:700px){.local-test-controls{gap:6px;padding:6px 12px}.local-test-controls small{display:none}}';document.head.append(style)
}
